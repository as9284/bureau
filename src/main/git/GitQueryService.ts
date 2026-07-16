import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import { assertGitSuccess } from './gitResult';
import type { BureauError } from '@shared/contracts/errors';
import type { CommitFileChange, CommitFileChangeKind, DiffRequest, DiffResult, ListCommitFilesRequest, ListCommitFilesResult, StashEntry } from '@shared/contracts/operations';
import type { ListRemotesRequest, RemoteEntry } from '@shared/contracts/remotes';
import { toBureauError } from '../ipc/errors';

const QUERY_TIMEOUT_MS = 30_000;

export type GitQueryService = {
  getDiff(input: DiffRequest): Promise<DiffResult>;
  listCommitFiles(input: ListCommitFilesRequest): Promise<ListCommitFilesResult>;
  stashList(input: { projectId: string }): Promise<StashEntry[]>;
  listRemotes(input: ListRemotesRequest): Promise<RemoteEntry[]>;
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

  async function listRemotes(input: ListRemotesRequest): Promise<RemoteEntry[]> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw new Error(`Repository ${input.projectId} not found.`);
      const executablePath = await resolveExecutable(input.projectId);

      const result = await runner.run(executablePath, {
        args: ['-C', repo.canonicalPath, 'remote', '--verbose'],
        timeoutMs: QUERY_TIMEOUT_MS,
      });
      // A repo with no remotes exits 0 with empty stdout; a hard failure here is not
      // worth an error state for what is a list panel, so it degrades to "none".
      if (result.exitCode !== 0) return [];

      return parseRemoteVerbose(result.stdout);
    });
  }

  return { getDiff, listCommitFiles, stashList, listRemotes };
}

/**
 * `git remote -v` emits two lines per remote — `<name>\t<url> (fetch)` and the same
 * for `(push)` — and the push URL genuinely differs when `remote.<name>.pushurl` is
 * set. Split on the tab rather than whitespace: URLs cannot contain a tab, but local
 * path remotes ("C:\My Repos\x") certainly contain spaces.
 */
export function parseRemoteVerbose(stdout: string): RemoteEntry[] {
  const byName = new Map<string, RemoteEntry>();

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;

    const name = line.slice(0, tab).trim();
    const rest = line.slice(tab + 1);
    const match = /^(.*)\s+\((fetch|push)\)$/.exec(rest);
    if (!name || !match) continue;

    const url = match[1].trim();
    const kind = match[2];
    const existing = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '' };
    if (kind === 'fetch') existing.fetchUrl = url;
    else existing.pushUrl = url;
    byName.set(name, existing);
  }

  // A remote is always listed with both lines, but tolerate a missing one rather than
  // rendering a blank URL cell.
  return [...byName.values()].map((entry) => ({
    ...entry,
    fetchUrl: entry.fetchUrl || entry.pushUrl,
    pushUrl: entry.pushUrl || entry.fetchUrl,
  }));
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
