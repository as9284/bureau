import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { SnapshotCache } from '../projects/SnapshotCache';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import type { GitStatusService } from './GitStatusService';
import type { HunkMutationRequest, MutationResult } from '@shared/contracts/operations';
import { toBureauError } from '../ipc/errors';

const MAX_PATCH_BYTES = 512_000;
const TIMEOUT_MS = 60_000;

export type GitHunkService = {
  applyHunk(input: HunkMutationRequest): Promise<MutationResult>;
};

export function createGitHunkService(params: {
  catalogue: ProjectCatalogue;
  snapshotCache: SnapshotCache;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  statusService: GitStatusService;
  coordinator: OperationCoordinator;
}): GitHunkService {
  const { catalogue, snapshotCache, resolver, runner, statusService, coordinator } = params;

  async function applyHunk(input: HunkMutationRequest): Promise<MutationResult> {
    const snapshot = snapshotCache.get(input.projectId);
    if (!snapshot || snapshot.revision !== input.snapshotRevision) return stale(input.projectId);
    if (snapshot.blockedOperation) return blocked(input.projectId);
    if (!snapshot.changedFiles.some((file) => file.path === input.path)) {
      return pathMissing(input.projectId);
    }
    if (Buffer.byteLength(input.patch, 'utf8') > MAX_PATCH_BYTES) {
      return invalidPatch(input.projectId, 'Patch is too large.');
    }
    if (!isPatchForPath(input.patch, input.path)) {
      return invalidPatch(input.projectId, 'Patch path does not match requested file.');
    }

    return coordinator.runMutation(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) return notFound(input.projectId);

      const capability = await resolver.resolve();
      if (capability.kind !== 'available') return gitUnavailable(input.projectId);

      const applyArgs =
        input.action === 'stage'
          ? ['apply', '--cached', '--unidiff-zero']
          : input.action === 'unstage'
            ? ['apply', '--cached', '--reverse', '--unidiff-zero']
            : ['apply', '--reverse', '--unidiff-zero'];

      const result = await runner.run(capability.executablePath, {
        args: ['-C', repo.canonicalPath, ...applyArgs],
        stdin: Buffer.from(input.patch, 'utf8'),
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return {
          ok: false,
          error: toBureauError({
            code: 'SNAPSHOT_STALE',
            message: result.stderr.trim() || 'Patch could not be applied. Refresh and try again.',
            operation: 'git.applyHunk',
            subjectId: input.projectId,
            retryable: true,
          }),
        };
      }

      const refreshed = await statusService.collectSnapshot(input.projectId, repo.canonicalPath);
      snapshotCache.set(input.projectId, refreshed);
      return { ok: true, snapshot: refreshed };
    });
  }

  return { applyHunk };
}

function isPatchForPath(patch: string, requestedPath: string): boolean {
  if (requestedPath.includes('\r') || requestedPath.includes('\n')) return false;
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== `--- a/${requestedPath}` || lines[1] !== `+++ b/${requestedPath}`) {
    return false;
  }
  if (!lines[2]?.startsWith('@@ ')) return false;
  return !lines
    .slice(2)
    .some(
      (line) => line.startsWith('diff --git ') || line.startsWith('--- ') || line.startsWith('+++ ')
    );
}

function invalidPatch(projectId: string, message: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'INVALID_REQUEST',
      message,
      operation: 'git.applyHunk',
      subjectId: projectId,
      retryable: false,
    }),
  };
}

function stale(projectId: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'SNAPSHOT_STALE',
      message: 'Repository snapshot is stale.',
      operation: 'git.applyHunk',
      subjectId: projectId,
      retryable: true,
    }),
  };
}

function blocked(projectId: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'REPOSITORY_BLOCKED',
      message: 'Repository is blocked.',
      operation: 'git.applyHunk',
      subjectId: projectId,
      retryable: false,
    }),
  };
}

function pathMissing(projectId: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'PATH_NOT_IN_SNAPSHOT',
      message: 'Path is not in the current snapshot.',
      operation: 'git.applyHunk',
      subjectId: projectId,
      retryable: false,
    }),
  };
}

function notFound(projectId: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Repository not found.',
      operation: 'git.applyHunk',
      subjectId: projectId,
      retryable: false,
    }),
  };
}

function gitUnavailable(projectId: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'GIT_NOT_FOUND',
      message: 'Git is not available.',
      operation: 'git.applyHunk',
      subjectId: projectId,
      retryable: true,
    }),
  };
}
