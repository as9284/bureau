import path from 'node:path';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { SnapshotCache } from '../projects/SnapshotCache';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import type { GitStatusService } from './GitStatusService';
import type {
  SubmoduleEntry,
  WorktreeEntry,
  BlameResult,
  AddWorktreeRequest,
  RemoveWorktreeRequest,
  WorktreeLockRequest,
} from '@shared/contracts/advanced';
import type { MutationResult } from '@shared/contracts/operations';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@shared/contracts/pagination';
import { checkRefNameBasics } from '@shared/git/refChecks';
import { toBureauError } from '../ipc/errors';

const TIMEOUT_MS = 60_000;

export type GitAdvancedService = {
  listWorktrees(input: { projectId: string }): Promise<WorktreeEntry[]>;
  addWorktree(input: AddWorktreeRequest): Promise<MutationResult>;
  removeWorktree(input: RemoveWorktreeRequest): Promise<MutationResult>;
  lockWorktree(input: WorktreeLockRequest): Promise<MutationResult>;
  unlockWorktree(input: WorktreeLockRequest): Promise<MutationResult>;
  pruneWorktrees(input: { projectId: string; snapshotRevision: string }): Promise<MutationResult>;
  listSubmodules(input: { projectId: string }): Promise<SubmoduleEntry[]>;
  blame(input: {
    projectId: string;
    path: string;
    commitOid: string;
    offset?: number;
    limit?: number;
  }): Promise<BlameResult>;
  submoduleInit(input: {
    projectId: string;
    snapshotRevision: string;
    path: string;
  }): Promise<MutationResult>;
  submoduleUpdate(input: {
    projectId: string;
    snapshotRevision: string;
    path: string;
  }): Promise<MutationResult>;
};

export function createGitAdvancedService(params: {
  catalogue: ProjectCatalogue;
  snapshotCache: SnapshotCache;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  statusService: GitStatusService;
  coordinator: OperationCoordinator;
}): GitAdvancedService {
  const { catalogue, snapshotCache, resolver, runner, coordinator, statusService } = params;

  async function listWorktrees(input: { projectId: string }): Promise<WorktreeEntry[]> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw notFound(input.projectId);
      const executablePath = await resolveExecutable(input.projectId);

      const result = await runner.run(executablePath, {
        args: ['-C', repo.canonicalPath, 'worktree', 'list', '--porcelain'],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) return [];

      return parseWorktreeOutput(result.stdout, repo.canonicalPath);
    });
  }

  async function addWorktree(input: AddWorktreeRequest): Promise<MutationResult> {
    const staleResult = checkStale(input.projectId, input.snapshotRevision);
    if (staleResult) return staleResult;

    const pathError = validateAbsolutePath(input.path);
    if (pathError) return pathError;

    if (input.branch) {
      const refErr = checkRefNameBasics(input.branch);
      if (refErr) return invalidRequest(refErr.message, input.projectId);
    }
    if (input.newBranch) {
      const refErr = checkRefNameBasics(input.newBranch);
      if (refErr) return invalidRequest(refErr.message, input.projectId);
    }

    return coordinator.runMutation(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) return notFoundMutation(input.projectId);
      const executablePath = await resolveExecutable(input.projectId);
      const wtPath = path.resolve(input.path);

      const args = ['-C', repo.canonicalPath, 'worktree', 'add'];
      if (input.newBranch) {
        args.push('-b', input.newBranch, wtPath);
        if (input.branch) args.push(input.branch);
      } else if (input.branch) {
        args.push(wtPath, input.branch);
      } else {
        args.push(wtPath);
      }

      const result = await runner.run(executablePath, {
        args,
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return commandFailed(result.stderr.trim() || 'Failed to add worktree.', input.projectId);
      }

      const refreshed = await statusService.collectSnapshot(input.projectId, repo.canonicalPath);
      snapshotCache.set(input.projectId, refreshed);
      return { ok: true, snapshot: refreshed };
    });
  }

  async function removeWorktree(input: RemoveWorktreeRequest): Promise<MutationResult> {
    const staleResult = checkStale(input.projectId, input.snapshotRevision);
    if (staleResult) return staleResult;

    const pathError = validateAbsolutePath(input.path);
    if (pathError) return pathError;

    return coordinator.runMutation(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) return notFoundMutation(input.projectId);
      const executablePath = await resolveExecutable(input.projectId);
      const wtPath = path.resolve(input.path);

      const known = await queryWorktrees(executablePath, repo.canonicalPath);
      if (!known.some((w) => path.resolve(w.path) === wtPath)) {
        return invalidRequest('Worktree path is not registered for this repository.', input.projectId);
      }
      if (known.find((w) => path.resolve(w.path) === wtPath)?.isCurrent) {
        return invalidRequest('Cannot remove the current worktree.', input.projectId);
      }

      const args = ['-C', repo.canonicalPath, 'worktree', 'remove', wtPath];

      const result = await runner.run(executablePath, { args, timeoutMs: TIMEOUT_MS });
      if (result.exitCode !== 0) {
        return commandFailed(result.stderr.trim() || 'Failed to remove worktree.', input.projectId);
      }

      const refreshed = await statusService.collectSnapshot(input.projectId, repo.canonicalPath);
      snapshotCache.set(input.projectId, refreshed);
      return { ok: true, snapshot: refreshed };
    });
  }

  async function lockWorktree(input: WorktreeLockRequest): Promise<MutationResult> {
    const staleResult = checkStale(input.projectId, input.snapshotRevision);
    if (staleResult) return staleResult;

    const pathError = validateAbsolutePath(input.path);
    if (pathError) return pathError;

    return worktreeSimpleMutation(input, [
      'worktree',
      'lock',
      ...(input.reason ? ['--reason', input.reason] : []),
      path.resolve(input.path),
    ]);
  }

  async function unlockWorktree(input: WorktreeLockRequest): Promise<MutationResult> {
    const staleResult = checkStale(input.projectId, input.snapshotRevision);
    if (staleResult) return staleResult;

    const pathError = validateAbsolutePath(input.path);
    if (pathError) return pathError;

    return worktreeSimpleMutation(input, ['worktree', 'unlock', path.resolve(input.path)]);
  }

  async function pruneWorktrees(input: {
    projectId: string;
    snapshotRevision: string;
  }): Promise<MutationResult> {
    const staleResult = checkStale(input.projectId, input.snapshotRevision);
    if (staleResult) return staleResult;

    return coordinator.runMutation(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) return notFoundMutation(input.projectId);
      const executablePath = await resolveExecutable(input.projectId);

      const result = await runner.run(executablePath, {
        args: ['-C', repo.canonicalPath, 'worktree', 'prune'],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return commandFailed(result.stderr.trim() || 'Failed to prune worktrees.', input.projectId);
      }

      const refreshed = await statusService.collectSnapshot(input.projectId, repo.canonicalPath);
      snapshotCache.set(input.projectId, refreshed);
      return { ok: true, snapshot: refreshed };
    });
  }

  async function worktreeSimpleMutation(
    input: WorktreeLockRequest,
    args: string[]
  ): Promise<MutationResult> {
    return coordinator.runMutation(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) return notFoundMutation(input.projectId);
      const executablePath = await resolveExecutable(input.projectId);
      const wtPath = path.resolve(input.path);

      const known = await queryWorktrees(executablePath, repo.canonicalPath);
      if (!known.some((w) => path.resolve(w.path) === wtPath)) {
        return invalidRequest('Worktree path is not registered for this repository.', input.projectId);
      }

      const result = await runner.run(executablePath, {
        args: ['-C', repo.canonicalPath, ...args],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return commandFailed(result.stderr.trim() || 'Worktree command failed.', input.projectId);
      }

      const refreshed = await statusService.collectSnapshot(input.projectId, repo.canonicalPath);
      snapshotCache.set(input.projectId, refreshed);
      return { ok: true, snapshot: refreshed };
    });
  }

  async function listSubmodules(input: { projectId: string }): Promise<SubmoduleEntry[]> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw notFound(input.projectId);
      const executablePath = await resolveExecutable(input.projectId);

      const result = await runner.run(executablePath, {
        args: ['-C', repo.canonicalPath, 'submodule', 'status', '--recursive'],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) return [];

      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const initialized = !line.startsWith('-');
          const dirty = line.startsWith('+');
          const parts = line.replace(/^[-+U ]/, '').split(' ');
          const [oid, submodulePath] = parts;
          return {
            path: submodulePath ?? '',
            expectedOid: oid,
            checkedOutOid: initialized ? oid : undefined,
            initialized,
            dirty,
          };
        });
    });
  }

  async function blame(input: {
    projectId: string;
    path: string;
    commitOid: string;
    offset?: number;
    limit?: number;
  }): Promise<BlameResult> {
    const pageLimit = Math.min(input.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const skip = input.offset ?? 0;

    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw notFound(input.projectId);
      const executablePath = await resolveExecutable(input.projectId);

      const result = await runner.run(executablePath, {
        args: [
          '-C',
          repo.canonicalPath,
          'blame',
          '-l',
          '-L',
          `${skip + 1},+${pageLimit}`,
          input.commitOid,
          '--',
          input.path,
        ],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return { items: [], hasMore: false };
      }

      const items = result.stdout
        .split('\n')
        .filter(Boolean)
        .map((line, idx) => {
          const match = /^([0-9a-f]+)\s+\((.+)\s+(\d{4}-\d{2}-\d{2}[^)]*)\s*(\d+)\)\s(.*)$/.exec(
            line
          );
          if (!match) {
            return {
              oid: '',
              abbreviatedOid: '',
              lineNumber: skip + idx + 1,
              authorName: '',
              committedAt: '',
              subject: '',
              content: line,
            };
          }
          const [, oid, authorName, committedAt, , content] = match;
          return {
            oid,
            abbreviatedOid: oid.slice(0, 7),
            lineNumber: skip + idx + 1,
            authorName,
            committedAt,
            subject: '',
            content,
          };
        });

      return { items, hasMore: items.length >= pageLimit };
    });
  }

  async function submoduleInit(input: {
    projectId: string;
    snapshotRevision: string;
    path: string;
  }): Promise<MutationResult> {
    return submoduleCommand(input, ['submodule', 'init', '--', input.path]);
  }

  async function submoduleUpdate(input: {
    projectId: string;
    snapshotRevision: string;
    path: string;
  }): Promise<MutationResult> {
    return submoduleCommand(input, ['submodule', 'update', '--', input.path]);
  }

  async function submoduleCommand(
    input: { projectId: string; snapshotRevision: string; path: string },
    args: string[]
  ): Promise<MutationResult> {
    const staleResult = checkStale(input.projectId, input.snapshotRevision);
    if (staleResult) return staleResult;

    return coordinator.runMutation(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) return notFoundMutation(input.projectId);
      const executablePath = await resolveExecutable(input.projectId);
      const result = await runner.run(executablePath, {
        args: ['-C', repo.canonicalPath, ...args],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return commandFailed(result.stderr.trim() || 'Submodule command failed.', input.projectId);
      }
      const refreshed = await statusService.collectSnapshot(input.projectId, repo.canonicalPath);
      snapshotCache.set(input.projectId, refreshed);
      return { ok: true, snapshot: refreshed };
    });
  }

  async function resolveExecutable(projectId: string): Promise<string> {
    const capability = await resolver.resolve();
    if (capability.kind !== 'available') throw gitUnavailable(projectId);
    return capability.executablePath;
  }

  async function queryWorktrees(
    executablePath: string,
    repoPath: string
  ): Promise<WorktreeEntry[]> {
    const result = await runner.run(executablePath, {
      args: ['-C', repoPath, 'worktree', 'list', '--porcelain'],
      timeoutMs: TIMEOUT_MS,
    });
    if (result.exitCode !== 0) return [];
    return parseWorktreeOutput(result.stdout, repoPath);
  }

  function checkStale(projectId: string, snapshotRevision: string): MutationResult | undefined {
    const snapshot = snapshotCache.get(projectId);
    if (!snapshot || snapshot.revision !== snapshotRevision) {
      return stale(projectId);
    }
    return undefined;
  }

  return {
    listWorktrees,
    addWorktree,
    removeWorktree,
    lockWorktree,
    unlockWorktree,
    pruneWorktrees,
    listSubmodules,
    blame,
    submoduleInit,
    submoduleUpdate,
  };
}

function parseWorktreeOutput(stdout: string, currentPath: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const blocks = stdout.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    let wtPath = '';
    let headOid = '';
    let branch: string | undefined;
    let locked = false;
    let prunable = false;
    for (const line of lines) {
      if (line.startsWith('worktree ')) wtPath = line.slice(9);
      if (line.startsWith('HEAD ')) headOid = line.slice(5);
      if (line.startsWith('branch ')) branch = line.slice(7).replace('refs/heads/', '');
      if (line === 'locked') locked = true;
      if (line === 'prunable') prunable = true;
    }
    if (wtPath) {
      entries.push({
        path: wtPath,
        headOid,
        branch,
        detached: !branch,
        locked,
        prunable,
        isCurrent: path.resolve(wtPath) === path.resolve(currentPath),
      });
    }
  }
  return entries;
}

function validateAbsolutePath(wtPath: string): MutationResult | undefined {
  if (!path.isAbsolute(wtPath)) {
    return invalidRequest('Worktree path must be absolute.', undefined);
  }
  if (wtPath.includes('\0')) {
    return invalidRequest('Worktree path is invalid.', undefined);
  }
  return undefined;
}

function notFound(projectId: string): never {
  throw toBureauError({
    code: 'PROJECT_NOT_FOUND',
    message: `Repository ${projectId} not found.`,
    operation: 'git.advanced',
    subjectId: projectId,
    retryable: false,
  });
}

function gitUnavailable(projectId: string): never {
  throw toBureauError({
    code: 'GIT_NOT_FOUND',
    message: 'Git is not available.',
    operation: 'git.advanced',
    subjectId: projectId,
    retryable: true,
  });
}

function stale(projectId: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'SNAPSHOT_STALE',
      message: 'Repository snapshot is stale.',
      operation: 'git.worktree',
      subjectId: projectId,
      retryable: true,
    }),
  };
}

function notFoundMutation(projectId: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'PROJECT_NOT_FOUND',
      message: 'Repository not found.',
      operation: 'git.worktree',
      subjectId: projectId,
      retryable: false,
    }),
  };
}

function invalidRequest(message: string, projectId?: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'INVALID_REQUEST',
      message,
      operation: 'git.worktree',
      subjectId: projectId,
      retryable: false,
    }),
  };
}

function commandFailed(message: string, projectId: string): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code: 'COMMAND_FAILED',
      message,
      operation: 'git.worktree',
      subjectId: projectId,
      retryable: true,
    }),
  };
}
