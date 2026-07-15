import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import { assertGitSuccess } from './gitResult';
import type { BureauError } from '@shared/contracts/errors';
import type { CommitFileChange, CommitFileChangeKind, DiffRequest, DiffResult, ListCommitFilesRequest, ListCommitFilesResult, RecentCommit, StashEntry } from '@shared/contracts/operations';
import { toBureauError } from '../ipc/errors';

const QUERY_TIMEOUT_MS = 30_000;

export type GitQueryService = {
  getDiff(input: DiffRequest): Promise<DiffResult>;
  listCommitFiles(input: ListCommitFilesRequest): Promise<ListCommitFilesResult>;
  listRecentCommits(input: { projectId: string; limit?: number }): Promise<RecentCommit[]>;
  stashList(input: { projectId: string }): Promise<StashEntry[]>;
};

export function createGitQueryService(params: {
  catalogue: ProjectCatalogue;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  coordinator: OperationCoordinator;
}): GitQueryService {
  const { catalogue, resolver, runner, coordinator } = params;

  async function resolveExecutable(projectId: string): Promise<string> {
    const capability = await resolver.resolve();
    if (capability.kind !== 'available') {
      throw toBureauError({
        code:
          capability.kind === 'unsupportedVersion' ? 'GIT_UNSUPPORTED_VERSION' : 'GIT_NOT_FOUND',
        message: 'Git is not available or unsupported.',
        operation: 'git.query',
        subjectId: projectId,
        retryable: true,
      });
    }
    return capability.executablePath;
  }

  async function getDiff(input: DiffRequest): Promise<DiffResult> {
    try {
      return await coordinator.runProjectRead(input.projectId, async () => {
        const repo = catalogue.get(input.projectId);
        if (!repo) {
          return errorDiff(
            'PROJECT_NOT_FOUND',
            `Repository ${input.projectId} not found.`,
            input.projectId
          );
        }

        const executablePath = await resolveExecutable(input.projectId);
        let args: string[];

        if (input.area === 'commit') {
          if (!input.commitOid) {
            return errorDiff(
              'INVALID_REQUEST',
              'commitOid is required for commit diffs.',
              input.projectId
            );
          }
          args = [
            '-C',
            repo.canonicalPath,
            'show',
            '--format=',
            '--find-renames',
            input.commitOid,
            '--',
            input.path,
          ];
        } else if (input.area === 'staged') {
          args = ['-C', repo.canonicalPath, 'diff', '--cached', '--', input.path];
        } else {
          args = ['-C', repo.canonicalPath, 'diff', '--', input.path];
        }

        let result = await runner.run(executablePath, {
          args,
          timeoutMs: QUERY_TIMEOUT_MS,
          stdoutLimitBytes: 8 * 1024 * 1024,
        });

        if (input.area === 'unstaged' && result.exitCode === 0 && result.stdout.trim() === '') {
          const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
          result = await runner.run(executablePath, {
            args: ['-C', repo.canonicalPath, 'diff', '--no-index', '--', nullDevice, input.path],
            timeoutMs: QUERY_TIMEOUT_MS,
            stdoutLimitBytes: 8 * 1024 * 1024,
          });
        }

        // `git diff --no-index` deliberately returns 1 when the files differ. We use that
        // command for untracked files so they receive the same unified-diff treatment as
        // tracked files; its expected exit status must not be surfaced as an error.
        const expectedNoIndexDifference =
          input.area === 'unstaged' &&
          result.exitCode === 1 &&
          !result.killed &&
          result.stderr.trim() === '' &&
          result.stdout.trim() !== '';
        if (!expectedNoIndexDifference) {
          assertGitSuccess(result, 'git.getDiff', input.projectId);
        }
        return { ok: true, diff: result.stdout };
      });
    } catch (error) {
      if (isBureauError(error)) {
        return { ok: false, error };
      }
      return errorDiff(
        'COMMAND_FAILED',
        error instanceof Error ? error.message : String(error),
        input.projectId
      );
    }
  }

  async function listCommitFiles(input: ListCommitFilesRequest): Promise<ListCommitFilesResult> {
    try {
      return await coordinator.runProjectRead(input.projectId, async () => {
        const repo = catalogue.get(input.projectId);
        if (!repo) {
          return errorCommitFiles(
            'PROJECT_NOT_FOUND',
            `Repository ${input.projectId} not found.`,
            input.projectId
          );
        }

        const executablePath = await resolveExecutable(input.projectId);
        const result = await runner.run(executablePath, {
          args: [
            '-C',
            repo.canonicalPath,
            'show',
            '--name-status',
            '--format=',
            '--find-renames',
            input.commitOid,
          ],
          timeoutMs: QUERY_TIMEOUT_MS,
          stdoutLimitBytes: 4 * 1024 * 1024,
        });
        assertGitSuccess(result, 'git.listCommitFiles', input.projectId);

        return { ok: true, files: parseNameStatus(result.stdout) };
      });
    } catch (error) {
      if (isBureauError(error)) {
        return { ok: false, error };
      }
      return errorCommitFiles(
        'COMMAND_FAILED',
        error instanceof Error ? error.message : String(error),
        input.projectId
      );
    }
  }

  async function listRecentCommits(input: {
    projectId: string;
    limit?: number;
  }): Promise<RecentCommit[]> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw new Error(`Repository ${input.projectId} not found.`);

      const executablePath = await resolveExecutable(input.projectId);
      const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
      const result = await runner.run(executablePath, {
        args: [
          '-C',
          repo.canonicalPath,
          'log',
          `-n`,
          String(limit),
          '--format=%H%x00%h%x00%an%x00%cI%x00%s',
          '-z',
        ],
        timeoutMs: QUERY_TIMEOUT_MS,
        stdoutLimitBytes: 4 * 1024 * 1024,
      });
      assertGitSuccess(result, 'git.listRecentCommits', input.projectId);

      // No filter(Boolean): an empty commit subject occupies its own field slot; dropping it
      // would shift every following field. The loop ignores any lone trailing token.
      const records = result.stdout.split('\0');
      const commits: RecentCommit[] = [];
      for (let i = 0; i + 4 < records.length; i += 5) {
        commits.push({
          oid: records[i]!,
          abbreviatedOid: records[i + 1]!,
          authorName: records[i + 2]!,
          committedAt: records[i + 3]!,
          subject: records[i + 4]!,
        });
      }
      return commits;
    });
  }

  async function stashList(input: { projectId: string }): Promise<StashEntry[]> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw new Error(`Repository ${input.projectId} not found.`);

      const executablePath = await resolveExecutable(input.projectId);
      const result = await runner.run(executablePath, {
        args: ['-C', repo.canonicalPath, 'stash', 'list', '--format=%gd%x00%gs%x00'],
        timeoutMs: QUERY_TIMEOUT_MS,
        stdoutLimitBytes: 1024 * 1024,
      });
      assertGitSuccess(result, 'git.stashList', input.projectId);

      const records = result.stdout.split('\0').filter(Boolean);
      const entries: StashEntry[] = [];
      for (let i = 0; i + 1 < records.length; i += 2) {
        const ref = records[i]!;
        const message = records[i + 1]!;
        const indexMatch = ref.match(/stash@\{(\d+)\}/);
        if (!indexMatch) continue;
        entries.push({
          index: Number.parseInt(indexMatch[1]!, 10),
          message,
          branch: message.match(/^On ([^:]+):/)?.[1],
        });
      }
      return entries;
    });
  }

  return { getDiff, listCommitFiles, listRecentCommits, stashList };
}

function parseNameStatus(stdout: string): CommitFileChange[] {
  const files: CommitFileChange[] = [];
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split(/\t/);
    const statusCode = parts[0] ?? '';
    if (!statusCode) continue;

    const code = statusCode[0] ?? '';
    if ((code === 'R' || code === 'C') && parts.length >= 3) {
      files.push({
        path: parts[2]!,
        originalPath: parts[1],
        kind: code === 'R' ? 'renamed' : 'copied',
        statusCode,
      });
      continue;
    }

    const pathValue = parts[1];
    if (!pathValue) continue;
    files.push({
      path: pathValue,
      kind: statusCodeToKind(code),
      statusCode,
    });
  }

  return files;
}

function statusCodeToKind(code: string): CommitFileChangeKind {
  switch (code) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'T':
      return 'typechange';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'unknown';
  }
}

function errorDiff(code: BureauError['code'], message: string, projectId: string): DiffResult {
  return {
    ok: false,
    error: toBureauError({
      code,
      message,
      operation: 'git.getDiff',
      subjectId: projectId,
      retryable: false,
    }),
  };
}

function errorCommitFiles(
  code: BureauError['code'],
  message: string,
  projectId: string
): ListCommitFilesResult {
  return {
    ok: false,
    error: toBureauError({
      code,
      message,
      operation: 'git.listCommitFiles',
      subjectId: projectId,
      retryable: false,
    }),
  };
}

function isBureauError(error: unknown): error is BureauError {
  return Boolean(error && typeof error === 'object' && 'code' in error && 'operation' in error);
}
