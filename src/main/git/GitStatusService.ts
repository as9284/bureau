import { v4 as uuidv4 } from 'uuid';
import type { GitRunner } from './GitRunner';
import type { GitExecutableResolver } from './GitExecutableResolver';
import { parseLatestCommit, parsePorcelainV2Status } from './PorcelainV2Parser';
import { detectBlockedOperations } from './GitOperationDetector';
import { assertGitSuccess, isNotAGitRepository } from './gitResult';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { toBureauError } from '../ipc/errors';

const STATUS_TIMEOUT_MS = 15000;
const LATEST_COMMIT_TIMEOUT_MS = 15000;

export type GitStatusService = {
  collectSnapshot(projectId: string, repositoryRoot: string): Promise<RepositorySnapshot>;
};

export function createUnavailableSnapshot(projectId: string, durationMs = 0): RepositorySnapshot {
  return {
    projectId,
    revision: uuidv4().replace(/-/g, ''),
    observedAt: new Date().toISOString(),
    durationMs,
    stale: false,
    availability: 'unavailable',
    branch: { kind: 'unborn' },
    upstream: { kind: 'notApplicable' },
    dirty: false,
    changedFileCount: 0,
    changedFiles: [],
  };
}

export function createGitStatusService(
  resolver: GitExecutableResolver,
  runner: GitRunner
): GitStatusService {
  async function collectSnapshot(
    projectId: string,
    repositoryRoot: string
  ): Promise<RepositorySnapshot> {
    const capability = await resolver.resolve();
    if (capability.kind === 'notFound') {
      throw toBureauError({
        code: 'GIT_NOT_FOUND',
        message: 'Git executable not found.',
        operation: 'status.collectSnapshot',
        subjectId: projectId,
        retryable: true,
      });
    }
    if (capability.kind === 'unsupportedVersion') {
      throw toBureauError({
        code: 'GIT_UNSUPPORTED_VERSION',
        message: `Git ${capability.version.major}.${capability.version.minor}.${capability.version.patch} is not supported.`,
        operation: 'status.collectSnapshot',
        subjectId: projectId,
        retryable: true,
      });
    }

    const executablePath = capability.executablePath;
    const startedAt = Date.now();

    const statusResult = await collectStatusWithRetry(executablePath, repositoryRoot, runner);

    // Non-repo projects are first-class: return an unavailable snapshot instead of failing refresh.
    if (statusResult.exitCode !== 0 && isNotAGitRepository(statusResult.stderr)) {
      return createUnavailableSnapshot(projectId, Date.now() - startedAt);
    }

    assertGitSuccess(statusResult, 'status.collectSnapshot', projectId);

    const parsed = parsePorcelainV2Status(statusResult.stdout);
    const blocked = await detectBlockedOperations(repositoryRoot);

    let latestCommit = undefined;
    if (parsed.branch.kind === 'named' && parsed.branch.headOid) {
      latestCommit = await fetchLatestCommit(executablePath, repositoryRoot, runner);
    } else if (parsed.branch.kind === 'detached' && parsed.branch.headOid) {
      latestCommit = await fetchLatestCommit(executablePath, repositoryRoot, runner);
    }

    const uniqueChangedPaths = new Set(parsed.changedFiles.map((f) => f.path));

    return {
      projectId,
      revision: uuidv4().replace(/-/g, ''),
      observedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      stale: false,
      availability: 'available',
      branch: parsed.branch,
      upstream: parsed.upstream,
      dirty: parsed.changedFiles.length > 0,
      changedFileCount: uniqueChangedPaths.size,
      changedFiles: parsed.changedFiles,
      latestCommit,
      blockedOperation: blocked.blocked ? { kinds: blocked.kinds } : undefined,
    };
  }

  return { collectSnapshot };
}

async function collectStatusWithRetry(
  executablePath: string,
  repositoryRoot: string,
  runner: GitRunner
) {
  const command = {
    args: [
      '-C',
      repositoryRoot,
      '-c',
      'core.quotepath=false',
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=all',
    ],
    timeoutMs: STATUS_TIMEOUT_MS,
    stdoutLimitBytes: 16 * 1024 * 1024,
    stderrLimitBytes: 1024 * 1024,
  };

  let result = await runner.run(executablePath, command);
  if (result.exitCode !== 0 && isTransientLockError(result.stderr)) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    result = await runner.run(executablePath, command);
  }
  return result;
}

function isTransientLockError(stderr: string): boolean {
  return /index\.lock|another git process|unable to create '.+\.lock'/i.test(stderr);
}

async function fetchLatestCommit(
  executablePath: string,
  repositoryRoot: string,
  runner: GitRunner
) {
  const result = await runner.run(executablePath, {
    args: ['-C', repositoryRoot, 'log', '-1', '--format=%H%x00%h%x00%an%x00%cI%x00%s'],
    timeoutMs: LATEST_COMMIT_TIMEOUT_MS,
    stdoutLimitBytes: 1024 * 1024,
    stderrLimitBytes: 64 * 1024,
  });

  if (result.exitCode !== 0) {
    return undefined;
  }

  return parseLatestCommit(result.stdout);
}
