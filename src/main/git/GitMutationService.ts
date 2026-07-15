import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { SnapshotCache } from '../projects/SnapshotCache';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { OperationRegistry } from '../operations/OperationRegistry';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import type { GitStatusService } from './GitStatusService';
import type { BureauErrorCode } from '@shared/contracts/errors';
import type { CommitRequest, BranchSwitchRequest, BranchCreateRequest, BranchDeleteRequest, FileMutationRequest, MutationResult, RepoMutationRequest, StashPushRequest, StashIndexRequest } from '@shared/contracts/operations';
import type { PullStrategy } from '@shared/contracts/settings';
import { assertGitSuccess } from './gitResult';
import { toBureauError } from '../ipc/errors';
import { isBureauError } from '../ipc/errors';

const MUTATION_TIMEOUT_MS = 60_000;
const PULL_PUSH_TIMEOUT_MS = 300_000;

export type GitMutationService = {
  listBranches(input: { projectId: string }): Promise<string[]>;
  switchBranch(input: BranchSwitchRequest): Promise<MutationResult>;
  createBranch(input: BranchCreateRequest): Promise<MutationResult>;
  deleteBranch(input: BranchDeleteRequest): Promise<MutationResult>;
  fetch(input: RepoMutationRequest): Promise<MutationResult>;
  stageFile(input: FileMutationRequest): Promise<MutationResult>;
  unstageFile(input: FileMutationRequest): Promise<MutationResult>;
  stageAll(input: RepoMutationRequest): Promise<MutationResult>;
  unstageAll(input: RepoMutationRequest): Promise<MutationResult>;
  discardFile(input: FileMutationRequest): Promise<MutationResult>;
  discardAll(input: RepoMutationRequest): Promise<MutationResult>;
  commit(input: CommitRequest): Promise<MutationResult>;
  pullFastForward(input: RepoMutationRequest): Promise<MutationResult>;
  push(input: RepoMutationRequest): Promise<MutationResult>;
  stashPush(input: StashPushRequest): Promise<MutationResult>;
  stashPop(input: StashIndexRequest): Promise<MutationResult>;
  stashDrop(input: StashIndexRequest): Promise<MutationResult>;
};

export function createGitMutationService(params: {
  catalogue: ProjectCatalogue;
  snapshotCache: SnapshotCache;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  statusService: GitStatusService;
  coordinator: OperationCoordinator;
  operationRegistry?: OperationRegistry;
  getPullStrategy?: () => PullStrategy;
}): GitMutationService {
  const {
    catalogue,
    snapshotCache,
    resolver,
    runner,
    statusService,
    coordinator,
    operationRegistry,
    getPullStrategy = () => 'ff-only' as PullStrategy,
  } = params;

  async function runWithRefresh(
    projectId: string,
    operationName: string,
    fn: (executablePath: string, repoPath: string) => Promise<void>
  ): Promise<MutationResult> {
    return coordinator.runMutation(projectId, async () => {
      const repo = catalogue.get(projectId);
      if (!repo) {
        return errorResult(
          'PROJECT_NOT_FOUND',
          `Repository ${projectId} not found.`,
          operationName,
          projectId
        );
      }

      const capability = await resolver.resolve();
      if (capability.kind !== 'available') {
        return errorResult(
          capability.kind === 'unsupportedVersion' ? 'GIT_UNSUPPORTED_VERSION' : 'GIT_NOT_FOUND',
          'Git is not available or unsupported.',
          operationName,
          projectId
        );
      }

      try {
        await fn(capability.executablePath, repo.canonicalPath);
      } catch (error) {
        if (isBureauError(error)) {
          return errorResult(error.code, error.message, operationName, projectId);
        }
        return errorResult(
          'COMMAND_FAILED',
          error instanceof Error ? error.message : String(error),
          operationName,
          projectId
        );
      }

      try {
        const snapshot = await statusService.collectSnapshot(projectId, repo.canonicalPath);
        snapshotCache.set(projectId, snapshot);
        return { ok: true, snapshot };
      } catch (error) {
        const previousSnapshot = snapshotCache.get(projectId);
        if (previousSnapshot) {
          return { ok: true, snapshot: { ...previousSnapshot, stale: true } };
        }
        return errorResult(
          'COMMAND_FAILED',
          error instanceof Error ? error.message : String(error),
          `${operationName}.refresh`,
          projectId
        );
      }
    });
  }

  async function runTrackedSync(
    projectId: string,
    kind: 'fetch' | 'pull' | 'push',
    summary: string,
    fn: (operationId: string, executablePath: string, repoPath: string) => Promise<void>
  ): Promise<MutationResult> {
    const operationName = `git.${kind}`;
    const execute = async (operationId?: string) =>
      runWithRefresh(projectId, operationName, async (executablePath, repoPath) => {
        await fn(operationId ?? '', executablePath, repoPath);
      });

    if (!operationRegistry) {
      return execute();
    }

    try {
      return await operationRegistry.runTracked({
        kind,
        summary,
        projectId,
        cancellable: true,
        fn: async ({ operationId }) => execute(operationId),
      });
    } catch (error) {
      if (isBureauError(error)) {
        return errorResult(error.code, error.message, operationName, projectId);
      }
      return errorResult(
        'COMMAND_FAILED',
        error instanceof Error ? error.message : String(error),
        operationName,
        projectId
      );
    }
  }

  async function stageFile(input: FileMutationRequest): Promise<MutationResult> {
    const validationError = validatePathInSnapshot(
      input.projectId,
      input.snapshotRevision,
      input.path
    );
    if (validationError) return validationError;

    return runWithRefresh(input.projectId, 'git.stageFile', async (executablePath, repoPath) => {
      const result = await runner.run(executablePath, {
        args: [
          '-C',
          repoPath,
          '--literal-pathspecs',
          'add',
          '--pathspec-from-file=-',
          '--pathspec-file-nul',
        ],
        stdin: Buffer.from(`${input.path}\0`),
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr);
      }
    });
  }

  async function stageAll(input: RepoMutationRequest): Promise<MutationResult> {
    const eligibilityError = checkSnapshotEligibility(
      input.projectId,
      input.snapshotRevision,
      'stageAll'
    );
    if (eligibilityError) return eligibilityError;

    return runWithRefresh(input.projectId, 'git.stageAll', async (executablePath, repoPath) => {
      const result = await runner.run(executablePath, {
        args: ['-C', repoPath, 'add', '-A'],
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      assertGitSuccess(result, 'git.stageAll', input.projectId);
    });
  }

  async function unstageAll(input: RepoMutationRequest): Promise<MutationResult> {
    const eligibilityError = checkSnapshotEligibility(
      input.projectId,
      input.snapshotRevision,
      'unstageAll'
    );
    if (eligibilityError) return eligibilityError;

    return runWithRefresh(input.projectId, 'git.unstageAll', async (executablePath, repoPath) => {
      const snapshot = snapshotCache.get(input.projectId);
      const isUnborn = snapshot?.branch.kind === 'unborn';
      const args = isUnborn
        ? ['-C', repoPath, 'reset']
        : ['-C', repoPath, 'restore', '--staged', '.'];

      const result = await runner.run(executablePath, {
        args,
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      assertGitSuccess(result, 'git.unstageAll', input.projectId);
    });
  }

  async function discardFile(input: FileMutationRequest): Promise<MutationResult> {
    const validationError = validatePathInSnapshot(
      input.projectId,
      input.snapshotRevision,
      input.path
    );
    if (validationError) return validationError;

    const snapshot = snapshotCache.get(input.projectId);
    const file = snapshot?.changedFiles.find((f) => f.path === input.path);
    if (!file?.unstaged && !file?.untracked) {
      return errorResult(
        'INVALID_REQUEST',
        'Only unstaged or untracked changes can be discarded.',
        'git.discardFile',
        input.projectId
      );
    }

    return runWithRefresh(input.projectId, 'git.discardFile', async (executablePath, repoPath) => {
      if (file.untracked) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const target = path.resolve(repoPath, input.path);
        if (
          !target.startsWith(path.resolve(repoPath) + path.sep) &&
          target !== path.resolve(repoPath)
        ) {
          throw new Error('Refusing to discard path outside repository.');
        }
        await fs.rm(target, { force: true });
        return;
      }

      const result = await runner.run(executablePath, {
        args: [
          '-C',
          repoPath,
          '--literal-pathspecs',
          'restore',
          '--worktree',
          '--pathspec-from-file=-',
          '--pathspec-file-nul',
        ],
        stdin: Buffer.from(`${input.path}\0`),
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      assertGitSuccess(result, 'git.discardFile', input.projectId);
    });
  }

  async function discardAll(input: RepoMutationRequest): Promise<MutationResult> {
    const eligibilityError = checkSnapshotEligibility(
      input.projectId,
      input.snapshotRevision,
      'discardAll'
    );
    if (eligibilityError) return eligibilityError;

    const snapshot = snapshotCache.get(input.projectId)!;
    const discardable = snapshot.changedFiles.filter((f) => f.unstaged || f.untracked);
    if (discardable.length === 0) {
      return { ok: true, snapshot };
    }

    return runWithRefresh(input.projectId, 'git.discardAll', async (executablePath, repoPath) => {
      const tracked = discardable.filter((f) => !f.untracked).map((f) => f.path);
      const untracked = discardable.filter((f) => f.untracked);

      if (tracked.length > 0) {
        const result = await runner.run(executablePath, {
          args: [
            '-C',
            repoPath,
            '--literal-pathspecs',
            'restore',
            '--worktree',
            '--pathspec-from-file=-',
            '--pathspec-file-nul',
          ],
          stdin: Buffer.from(tracked.map((p) => `${p}\0`).join('')),
          timeoutMs: MUTATION_TIMEOUT_MS,
        });
        assertGitSuccess(result, 'git.discardAll', input.projectId);
      }

      if (untracked.length > 0) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const repoRoot = path.resolve(repoPath);
        for (const file of untracked) {
          const target = path.resolve(repoPath, file.path);
          if (!target.startsWith(repoRoot + path.sep) && target !== repoRoot) {
            throw new Error('Refusing to discard path outside repository.');
          }
          await fs.rm(target, { force: true, recursive: true });
        }
      }
    });
  }

  async function createBranch(input: BranchCreateRequest): Promise<MutationResult> {
    const eligibilityError = checkSnapshotEligibility(
      input.projectId,
      input.snapshotRevision,
      'createBranch'
    );
    if (eligibilityError) return eligibilityError;

    return runWithRefresh(input.projectId, 'git.createBranch', async (executablePath, repoPath) => {
      const args = input.startPoint
        ? ['-C', repoPath, 'branch', input.branchName, input.startPoint]
        : ['-C', repoPath, 'branch', input.branchName];

      const result = await runner.run(executablePath, {
        args,
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      assertGitSuccess(result, 'git.createBranch', input.projectId);
    });
  }

  async function deleteBranch(input: BranchDeleteRequest): Promise<MutationResult> {
    const eligibilityError = checkSnapshotEligibility(
      input.projectId,
      input.snapshotRevision,
      'deleteBranch'
    );
    if (eligibilityError) return eligibilityError;

    const snapshot = snapshotCache.get(input.projectId);
    if (snapshot?.branch.kind === 'named' && snapshot.branch.name === input.branchName) {
      return errorResult(
        'INVALID_REQUEST',
        'Cannot delete the currently checked-out branch.',
        'git.deleteBranch',
        input.projectId
      );
    }

    return runWithRefresh(input.projectId, 'git.deleteBranch', async (executablePath, repoPath) => {
      const result = await runner.run(executablePath, {
        args: ['-C', repoPath, 'branch', '-d', input.branchName],
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      assertGitSuccess(result, 'git.deleteBranch', input.projectId);
    });
  }

  async function stashPush(input: StashPushRequest): Promise<MutationResult> {
    const eligibilityError = checkSnapshotEligibility(
      input.projectId,
      input.snapshotRevision,
      'stashPush'
    );
    if (eligibilityError) return eligibilityError;

    return runWithRefresh(input.projectId, 'git.stashPush', async (executablePath, repoPath) => {
      const args = ['-C', repoPath, 'stash', 'push'];
      if (input.includeUntracked) args.push('-u');
      if (input.message?.trim()) {
        args.push('-m', input.message.trim());
      }

      const result = await runner.run(executablePath, {
        args,
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      assertGitSuccess(result, 'git.stashPush', input.projectId);
    });
  }

  async function stashPop(input: StashIndexRequest): Promise<MutationResult> {
    const eligibilityError = checkSnapshotEligibility(
      input.projectId,
      input.snapshotRevision,
      'stashPop'
    );
    if (eligibilityError) return eligibilityError;

    return runWithRefresh(input.projectId, 'git.stashPop', async (executablePath, repoPath) => {
      const result = await runner.run(executablePath, {
        args: ['-C', repoPath, 'stash', 'pop', `stash@{${input.index}}`],
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      assertGitSuccess(result, 'git.stashPop', input.projectId);
    });
  }

  async function stashDrop(input: StashIndexRequest): Promise<MutationResult> {
    const eligibilityError = checkSnapshotEligibility(
      input.projectId,
      input.snapshotRevision,
      'stashDrop'
    );
    if (eligibilityError) return eligibilityError;

    return runWithRefresh(input.projectId, 'git.stashDrop', async (executablePath, repoPath) => {
      const result = await runner.run(executablePath, {
        args: ['-C', repoPath, 'stash', 'drop', `stash@{${input.index}}`],
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      assertGitSuccess(result, 'git.stashDrop', input.projectId);
    });
  }

  async function listBranches(input: { projectId: string }): Promise<string[]> {
    return coordinator.runProjectRead(input.projectId, async () => {
      const repo = catalogue.get(input.projectId);
      if (!repo) throw new Error(`Repository ${input.projectId} not found.`);
      const capability = await resolver.resolve();
      if (capability.kind !== 'available') throw new Error('Git is not available or unsupported.');
      const result = await runner.run(capability.executablePath, {
        args: [
          '-C',
          repo.canonicalPath,
          'for-each-ref',
          '--format=%(refname:short)%00',
          'refs/heads',
        ],
        timeoutMs: MUTATION_TIMEOUT_MS,
        stdoutLimitBytes: 1024 * 1024,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr || 'Could not list branches.');
      return result.stdout
        .split('\0')
        .map((branch) => branch.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    });
  }

  async function switchBranch(input: BranchSwitchRequest): Promise<MutationResult> {
    const eligibilityError = checkBranchSwitchEligibility(input.projectId, input.snapshotRevision);
    if (eligibilityError) return eligibilityError;

    return runWithRefresh(input.projectId, 'git.switchBranch', async (executablePath, repoPath) => {
      const result = await runner.run(executablePath, {
        args: ['-C', repoPath, 'switch', '--no-guess', input.branchName],
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      if (result.exitCode !== 0)
        throw new Error(result.stderr || `Could not switch to ${input.branchName}.`);
    });
  }

  async function fetch(input: RepoMutationRequest): Promise<MutationResult> {
    const eligibilityError = checkSnapshotEligibility(
      input.projectId,
      input.snapshotRevision,
      'fetch'
    );
    if (eligibilityError) return eligibilityError;

    return runTrackedSync(
      input.projectId,
      'fetch',
      'Fetch remote',
      async (operationId, executablePath, repoPath) => {
        const result = await runner.run(executablePath, {
          args: ['-C', repoPath, 'fetch', '--prune'],
          timeoutMs: PULL_PUSH_TIMEOUT_MS,
          operationId,
        });
        if (result.killed === 'cancelled') throw new Error('Fetch cancelled.');
        if (result.exitCode !== 0) throw new Error(result.stderr || 'Git fetch failed.');
      }
    );
  }

  async function unstageFile(input: FileMutationRequest): Promise<MutationResult> {
    const validationError = validatePathInSnapshot(
      input.projectId,
      input.snapshotRevision,
      input.path
    );
    if (validationError) return validationError;

    return runWithRefresh(input.projectId, 'git.unstageFile', async (executablePath, repoPath) => {
      const snapshot = snapshotCache.get(input.projectId);
      const isUnborn = snapshot?.branch.kind === 'unborn';
      const args = isUnborn
        ? [
            '-C',
            repoPath,
            '--literal-pathspecs',
            'reset',
            '--pathspec-from-file=-',
            '--pathspec-file-nul',
          ]
        : [
            '-C',
            repoPath,
            '--literal-pathspecs',
            'restore',
            '--staged',
            '--pathspec-from-file=-',
            '--pathspec-file-nul',
          ];

      const result = await runner.run(executablePath, {
        args,
        stdin: Buffer.from(`${input.path}\0`),
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr);
      }
    });
  }

  async function commit(input: CommitRequest): Promise<MutationResult> {
    const trimmedMessage = input.message.trim();
    if (trimmedMessage.length === 0) {
      return errorResult(
        'INVALID_COMMIT_MESSAGE',
        'Commit message cannot be empty.',
        'git.commit',
        input.projectId
      );
    }
    if (Buffer.byteLength(input.message, 'utf8') > 10000) {
      return errorResult(
        'INVALID_COMMIT_MESSAGE',
        'Commit message is too long.',
        'git.commit',
        input.projectId
      );
    }

    const snapshot = snapshotCache.get(input.projectId);
    if (!snapshot || snapshot.revision !== input.snapshotRevision) {
      return errorResult(
        'SNAPSHOT_STALE',
        'Repository snapshot is stale. Refresh before committing.',
        'git.commit',
        input.projectId
      );
    }
    if (!snapshot.changedFiles.some((f) => f.staged)) {
      return errorResult(
        'NO_STAGED_CHANGES',
        'No staged changes to commit.',
        'git.commit',
        input.projectId
      );
    }
    if (snapshot.blockedOperation) {
      return errorResult(
        'REPOSITORY_BLOCKED',
        'Repository is blocked.',
        'git.commit',
        input.projectId
      );
    }

    return runWithRefresh(input.projectId, 'git.commit', async (executablePath, repoPath) => {
      const result = await runner.run(executablePath, {
        args: ['-C', repoPath, 'commit', '--file=-'],
        stdin: Buffer.from(input.message, 'utf8'),
        timeoutMs: MUTATION_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr);
      }
    });
  }

  async function pullFastForward(input: RepoMutationRequest): Promise<MutationResult> {
    const eligibilityError = checkSyncEligibility(input.projectId, input.snapshotRevision, 'pull');
    if (eligibilityError) return eligibilityError;

    const strategy = getPullStrategy();
    const pullArgs = pullArgsForStrategy(strategy);

    return runTrackedSync(
      input.projectId,
      'pull',
      'Pull remote',
      async (operationId, executablePath, repoPath) => {
        const result = await runner.run(executablePath, {
          args: ['-C', repoPath, 'pull', ...pullArgs],
          timeoutMs: PULL_PUSH_TIMEOUT_MS,
          operationId,
        });
        if (result.killed === 'cancelled') throw new Error('Pull cancelled.');
        if (result.exitCode !== 0) {
          throw toBureauError({
            code: 'COMMAND_FAILED',
            message: result.stderr.trim() || `git pull (${strategy}) failed.`,
            operation: 'git.pull',
            subjectId: input.projectId,
            retryable: true,
          });
        }
      }
    );
  }

  async function push(input: RepoMutationRequest): Promise<MutationResult> {
    const eligibilityError = checkSyncEligibility(input.projectId, input.snapshotRevision, 'push');
    if (eligibilityError) return eligibilityError;

    return runTrackedSync(
      input.projectId,
      'push',
      'Push to remote',
      async (operationId, executablePath, repoPath) => {
        const result = await runner.run(executablePath, {
          args: ['-C', repoPath, 'push', '--porcelain'],
          timeoutMs: PULL_PUSH_TIMEOUT_MS,
          operationId,
        });
        if (result.killed === 'cancelled') throw new Error('Push cancelled.');
        if (result.exitCode !== 0) {
          throw new Error(result.stderr);
        }
      }
    );
  }

  function validatePathInSnapshot(
    projectId: string,
    snapshotRevision: string,
    path: string
  ): MutationResult | undefined {
    const snapshot = snapshotCache.get(projectId);
    if (!snapshot || snapshot.revision !== snapshotRevision) {
      return errorResult(
        'SNAPSHOT_STALE',
        'Repository snapshot is stale.',
        'pathValidation',
        projectId
      );
    }
    const exists = snapshot.changedFiles.some((f) => f.path === path);
    if (!exists) {
      return errorResult(
        'PATH_NOT_IN_SNAPSHOT',
        'Path is not in the current snapshot.',
        'pathValidation',
        projectId
      );
    }
    return undefined;
  }

  function checkSyncEligibility(
    projectId: string,
    snapshotRevision: string,
    operation: 'pull' | 'push'
  ): MutationResult | undefined {
    const snapshot = snapshotCache.get(projectId);
    if (!snapshot || snapshot.revision !== snapshotRevision) {
      return errorResult('SNAPSHOT_STALE', 'Repository snapshot is stale.', operation, projectId);
    }
    if (snapshot.branch.kind === 'detached') {
      return errorResult('DETACHED_HEAD', 'Cannot sync in detached HEAD.', operation, projectId);
    }
    if (snapshot.branch.kind === 'unborn') {
      return errorResult('NO_COMMITS_YET', 'Cannot sync before first commit.', operation, projectId);
    }
    if (snapshot.upstream.kind !== 'tracking') {
      return errorResult('NO_UPSTREAM', 'Branch has no upstream.', operation, projectId);
    }
    if (snapshot.blockedOperation) {
      return errorResult('REPOSITORY_BLOCKED', 'Repository is blocked.', operation, projectId);
    }
    return undefined;
  }

  function checkBranchSwitchEligibility(
    projectId: string,
    snapshotRevision: string
  ): MutationResult | undefined {
    const base = checkSnapshotEligibility(projectId, snapshotRevision, 'switchBranch');
    if (base) return base;
    const snapshot = snapshotCache.get(projectId)!;
    if (snapshot.branch.kind === 'unborn') {
      return errorResult(
        'NO_COMMITS_YET',
        'Cannot switch branches before the first commit.',
        'switchBranch',
        projectId
      );
    }
    return undefined;
  }

  function checkSnapshotEligibility(
    projectId: string,
    snapshotRevision: string,
    operation: string
  ): MutationResult | undefined {
    const snapshot = snapshotCache.get(projectId);
    if (!snapshot || snapshot.revision !== snapshotRevision) {
      return errorResult(
        'SNAPSHOT_STALE',
        'Repository snapshot is stale. Refresh and try again.',
        operation,
        projectId
      );
    }
    if (snapshot.blockedOperation) {
      return errorResult('REPOSITORY_BLOCKED', 'Repository is blocked.', operation, projectId);
    }
    return undefined;
  }

  return {
    listBranches,
    switchBranch,
    createBranch,
    deleteBranch,
    fetch,
    stageFile,
    unstageFile,
    stageAll,
    unstageAll,
    discardFile,
    discardAll,
    commit,
    pullFastForward,
    push,
    stashPush,
    stashPop,
    stashDrop,
  };
}

function errorResult(
  code: BureauErrorCode,
  message: string,
  operation: string,
  projectId?: string
): MutationResult {
  return {
    ok: false,
    error: toBureauError({
      code,
      message,
      operation,
      subjectId: projectId,
      retryable: false,
    }),
  };
}

function pullArgsForStrategy(strategy: PullStrategy): string[] {
  switch (strategy) {
    case 'merge':
      return ['--no-rebase', '--no-edit'];
    case 'rebase':
      return ['--rebase', '--no-edit'];
    case 'ff-only':
    default:
      return ['--ff-only', '--no-edit'];
  }
}
