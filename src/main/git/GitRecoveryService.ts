import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { SnapshotCache } from '../projects/SnapshotCache';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import type { GitStatusService } from './GitStatusService';
import { detectBlockedOperations } from './GitOperationDetector';
import type {
  BisectState,
  ConflictResolveRequest,
  ConflictVersionRequest,
  ConflictVersionResult,
  GetBisectStateRequest,
  GetOperationStateRequest,
  OperationStateDetails,
  RecoveryActionRequest,
  RecoveryOperationKind,
} from '@shared/contracts/recovery';
import type { MutationResult } from '@shared/contracts/operations';
import { toBureauError } from '../ipc/errors';
import { assertGitSuccess } from './gitResult';

const TIMEOUT_MS = 60_000;
const NON_INTERACTIVE = ['-c', 'core.editor=true'];

function gitArgs(repoPath: string, subcommand: string[]): string[] {
  return ['-C', repoPath, ...NON_INTERACTIVE, ...subcommand];
}

export type GitRecoveryService = {
  getOperationState(input: GetOperationStateRequest): Promise<OperationStateDetails>;
  getBisectState(input: GetBisectStateRequest): Promise<BisectState>;
  getConflictVersion(input: ConflictVersionRequest): Promise<ConflictVersionResult>;
  resolveConflict(input: ConflictResolveRequest): Promise<MutationResult>;
  mergeContinue(input: RecoveryActionRequest): Promise<MutationResult>;
  mergeAbort(input: RecoveryActionRequest): Promise<MutationResult>;
  rebaseContinue(input: RecoveryActionRequest): Promise<MutationResult>;
  rebaseSkip(input: RecoveryActionRequest): Promise<MutationResult>;
  rebaseAbort(input: RecoveryActionRequest): Promise<MutationResult>;
  cherryPickContinue(input: RecoveryActionRequest): Promise<MutationResult>;
  cherryPickSkip(input: RecoveryActionRequest): Promise<MutationResult>;
  cherryPickAbort(input: RecoveryActionRequest): Promise<MutationResult>;
  revertContinue(input: RecoveryActionRequest): Promise<MutationResult>;
  revertSkip(input: RecoveryActionRequest): Promise<MutationResult>;
  revertAbort(input: RecoveryActionRequest): Promise<MutationResult>;
  bisectReset(input: RecoveryActionRequest): Promise<MutationResult>;
};

export function createGitRecoveryService(params: {
  catalogue: ProjectCatalogue;
  snapshotCache: SnapshotCache;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  statusService: GitStatusService;
  coordinator: OperationCoordinator;
}): GitRecoveryService {
  const { catalogue, snapshotCache, resolver, runner, statusService, coordinator } = params;

  async function resolveGit(projectId: string): Promise<{ executablePath: string; repoPath: string }> {
    const repo = catalogue.get(projectId);
    if (!repo) throw notFound(projectId);
    const capability = await resolver.resolve();
    if (capability.kind !== 'available') {
      throw toBureauError({
        code:
          capability.kind === 'unsupportedVersion' ? 'GIT_UNSUPPORTED_VERSION' : 'GIT_NOT_FOUND',
        message: 'Git is not available.',
        operation: 'recovery',
        subjectId: projectId,
        retryable: true,
      });
    }
    return { executablePath: capability.executablePath, repoPath: repo.canonicalPath };
  }

  async function getOperationState(
    input: GetOperationStateRequest
  ): Promise<OperationStateDetails> {
    const repo = catalogue.get(input.projectId);
    if (!repo) {
      return emptyState('Repository not found.');
    }
    const snapshot = snapshotCache.get(input.projectId);
    const blocked = snapshot?.blockedOperation;
    if (!blocked?.kinds.length) {
      return emptyState('No interrupted operation.');
    }

    const detection = await detectBlockedOperations(repo.canonicalPath);
    const activeKind = pickActiveKind(detection.kinds);
    const conflictedFiles = (snapshot?.changedFiles ?? [])
      .filter((f) => f.unmerged)
      .map((f) => ({
        path: f.path,
        stages: parseConflictStages(f.indexCode, f.worktreeCode),
        binary: f.indexCode === 'C' || f.worktreeCode === 'C',
        resolved: f.indexCode !== 'U' && f.worktreeCode !== 'U',
      }));

    const steps = activeKind ? await readRebaseSteps(repo.canonicalPath, activeKind) : undefined;

    return {
      activeKind,
      summary: summarizeOperation(activeKind, blocked.kinds),
      canContinue: canContinue(activeKind),
      canSkip: canSkip(activeKind),
      canAbort: canAbort(activeKind),
      currentStep: steps?.current,
      totalSteps: steps?.total,
      conflictedFiles,
      instructions: instructionsFor(activeKind),
    };
  }

  async function getBisectState(input: GetBisectStateRequest): Promise<BisectState> {
    const repo = catalogue.get(input.projectId);
    if (!repo) return { active: false, summary: '' };
    const logPath = path.join(repo.canonicalPath, '.git', 'BISECT_LOG');
    const active = await fileExists(logPath);
    return {
      active,
      summary: active ? 'Bisect in progress. Use Reset bisect to end.' : '',
    };
  }

  async function getConflictVersion(input: ConflictVersionRequest): Promise<ConflictVersionResult> {
    try {
      const { executablePath, repoPath } = await resolveGit(input.projectId);
      const snapshot = snapshotCache.get(input.projectId);
      if (!snapshot?.changedFiles.some((file) => file.unmerged && file.path === input.path)) {
        return {
          ok: false,
          error: toBureauError({
            code: 'PATH_NOT_IN_SNAPSHOT',
            message: 'Path is not a conflict in the current snapshot.',
            operation: 'recovery.getConflictVersion',
            subjectId: input.projectId,
            retryable: false,
          }),
        };
      }
      const stageNum = stageNumber(input.stage);
      if (input.stage === 'working') {
        const targetPath = path.resolve(repoPath, input.path);
        const repoRoot = path.resolve(repoPath);
        if (!targetPath.startsWith(`${repoRoot}${path.sep}`)) {
          return {
            ok: false,
            error: toBureauError({
              code: 'PATH_NOT_IN_SNAPSHOT',
              message: 'Conflict path is outside the repository.',
              operation: 'recovery.getConflictVersion',
              subjectId: input.projectId,
              retryable: false,
            }),
          };
        }
        const content = await fs.readFile(targetPath, 'utf8').catch(() => '');
        return { ok: true, content, binary: content.includes('\0') };
      }
      const result = await runner.run(executablePath, {
        args: ['-C', repoPath, 'show', `:${stageNum}:${input.path}`],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return {
          ok: false,
          error: toBureauError({
            code: 'COMMAND_FAILED',
            message: result.stderr.trim() || 'Could not read conflict version.',
            operation: 'recovery.getConflictVersion',
            subjectId: input.projectId,
            retryable: true,
          }),
        };
      }
      const content = result.stdout;
      return { ok: true, content, binary: content.includes('\0') };
    } catch (error) {
      return {
        ok: false,
        error: toBureauError({
          code: 'COMMAND_FAILED',
          message: error instanceof Error ? error.message : String(error),
          operation: 'recovery.getConflictVersion',
          subjectId: input.projectId,
          retryable: true,
        }),
      };
    }
  }

  async function resolveConflict(input: ConflictResolveRequest): Promise<MutationResult> {
    const eligibility = checkRecoveryEligibility(
      input.projectId,
      input.snapshotRevision,
      'resolveConflict'
    );
    if (eligibility) return eligibility;

    return runRecoveryMutation(
      input.projectId,
      'conflictResolve',
      async (executablePath, repoPath) => {
        if (input.resolution === 'ours') {
          await gitCheckout(executablePath, repoPath, '--ours', input.path);
          await gitAdd(executablePath, repoPath, input.path);
        } else if (input.resolution === 'theirs') {
          await gitCheckout(executablePath, repoPath, '--theirs', input.path);
          await gitAdd(executablePath, repoPath, input.path);
        } else {
          await gitAdd(executablePath, repoPath, input.path);
        }
      }
    );
  }

  async function mergeContinue(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'merge', 'mergeContinue', ['commit', '--no-edit']);
  }

  async function mergeAbort(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'merge', 'mergeAbort', ['merge', '--abort']);
  }

  async function rebaseContinue(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'rebase', 'rebaseContinue', ['rebase', '--continue']);
  }

  async function rebaseSkip(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'rebase', 'rebaseSkip', ['rebase', '--skip']);
  }

  async function rebaseAbort(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'rebase', 'rebaseAbort', ['rebase', '--abort']);
  }

  async function cherryPickContinue(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'cherryPick', 'cherryPickContinue', [
      'cherry-pick',
      '--continue',
    ]);
  }

  async function cherryPickSkip(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'cherryPick', 'cherryPickSkip', ['cherry-pick', '--skip']);
  }

  async function cherryPickAbort(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'cherryPick', 'cherryPickAbort', ['cherry-pick', '--abort']);
  }

  async function revertContinue(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'revert', 'revertContinue', ['revert', '--continue']);
  }

  async function revertSkip(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'revert', 'revertSkip', ['revert', '--skip']);
  }

  async function revertAbort(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'revert', 'revertAbort', ['revert', '--abort']);
  }

  async function bisectReset(input: RecoveryActionRequest): Promise<MutationResult> {
    return recoveryCommand(input, 'bisect', 'bisectReset', ['bisect', 'reset']);
  }

  async function recoveryCommand(
    input: RecoveryActionRequest,
    expectedKind: RecoveryOperationKind,
    operation: string,
    args: string[]
  ): Promise<MutationResult> {
    const eligibility = checkRecoveryEligibility(input.projectId, input.snapshotRevision, operation);
    if (eligibility) return eligibility;

    const repo = catalogue.get(input.projectId)!;
    const detection = await detectBlockedOperations(repo.canonicalPath);
    if (!detection.kinds.includes(expectedKind)) {
      return errorResult(
        'INVALID_REQUEST',
        `No active ${expectedKind} operation.`,
        operation,
        input.projectId
      );
    }

    return runRecoveryMutation(input.projectId, operation, async (executablePath, repoPath) => {
      const result = await runner.run(executablePath, {
        args: gitArgs(repoPath, args),
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `git ${args[0]} failed.`);
      }
    });
  }

  async function runRecoveryMutation(
    projectId: string,
    operation: string,
    fn: (executablePath: string, repoPath: string) => Promise<void>
  ): Promise<MutationResult> {
    return coordinator.runMutation(projectId, async () => {
      const repo = catalogue.get(projectId);
      if (!repo)
        return errorResult('PROJECT_NOT_FOUND', 'Repository not found.', operation, projectId);

      try {
        const { executablePath, repoPath } = await resolveGit(projectId);
        await fn(executablePath, repoPath);
      } catch (error) {
        return errorResult(
          'COMMAND_FAILED',
          error instanceof Error ? error.message : String(error),
          operation,
          projectId
        );
      }

      try {
        const snapshot = await statusService.collectSnapshot(projectId, repo.canonicalPath);
        snapshotCache.set(projectId, snapshot);
        return { ok: true, snapshot };
      } catch (error) {
        const previous = snapshotCache.get(projectId);
        if (previous) return { ok: true, snapshot: { ...previous, stale: true } };
        return errorResult(
          'COMMAND_FAILED',
          error instanceof Error ? error.message : String(error),
          `${operation}.refresh`,
          projectId
        );
      }
    });
  }

  async function gitCheckout(
    executablePath: string,
    repoPath: string,
    side: '--ours' | '--theirs',
    filePath: string
  ): Promise<void> {
    const result = await runner.run(executablePath, {
      args: ['-C', repoPath, 'checkout', side, '--', filePath],
      timeoutMs: TIMEOUT_MS,
    });
    assertGitSuccess(result, 'recovery.checkout', undefined);
  }

  async function gitAdd(executablePath: string, repoPath: string, filePath: string): Promise<void> {
    const result = await runner.run(executablePath, {
      args: [
        '-C',
        repoPath,
        '--literal-pathspecs',
        'add',
        '--pathspec-from-file=-',
        '--pathspec-file-nul',
      ],
      stdin: Buffer.from(`${filePath}\0`),
      timeoutMs: TIMEOUT_MS,
    });
    assertGitSuccess(result, 'recovery.add', undefined);
  }

  function checkRecoveryEligibility(
    projectId: string,
    snapshotRevision: string,
    operation: string
  ): MutationResult | undefined {
    const snapshot = snapshotCache.get(projectId);
    if (!snapshot || snapshot.revision !== snapshotRevision) {
      return errorResult('SNAPSHOT_STALE', 'Repository snapshot is stale.', operation, projectId);
    }
    return undefined;
  }

  return {
    getOperationState,
    getBisectState,
    getConflictVersion,
    resolveConflict,
    mergeContinue,
    mergeAbort,
    rebaseContinue,
    rebaseSkip,
    rebaseAbort,
    cherryPickContinue,
    cherryPickSkip,
    cherryPickAbort,
    revertContinue,
    revertSkip,
    revertAbort,
    bisectReset,
  };
}

function emptyState(summary: string): OperationStateDetails {
  return {
    summary,
    canContinue: false,
    canSkip: false,
    canAbort: false,
    conflictedFiles: [],
  };
}

function pickActiveKind(
  kinds: Array<'unmerged' | RecoveryOperationKind>
): RecoveryOperationKind | undefined {
  const priority: RecoveryOperationKind[] = ['rebase', 'merge', 'cherryPick', 'revert', 'bisect'];
  for (const kind of priority) {
    if (kinds.includes(kind)) return kind;
  }
  return undefined;
}

function canContinue(kind?: RecoveryOperationKind): boolean {
  return kind === 'merge' || kind === 'rebase' || kind === 'cherryPick' || kind === 'revert';
}

function canSkip(kind?: RecoveryOperationKind): boolean {
  return kind === 'rebase' || kind === 'cherryPick' || kind === 'revert';
}

function canAbort(kind?: RecoveryOperationKind): boolean {
  return kind === 'merge' || kind === 'rebase' || kind === 'cherryPick' || kind === 'revert';
}

function summarizeOperation(
  activeKind: RecoveryOperationKind | undefined,
  kinds: string[]
): string {
  if (activeKind === 'merge') return 'Merge in progress';
  if (activeKind === 'rebase') return 'Rebase in progress';
  if (activeKind === 'cherryPick') return 'Cherry-pick in progress';
  if (activeKind === 'revert') return 'Revert in progress';
  if (activeKind === 'bisect') return 'Bisect in progress';
  if (kinds.includes('unmerged')) return 'Unresolved conflicts';
  return 'Repository blocked';
}

function instructionsFor(kind?: RecoveryOperationKind): string | undefined {
  if (!kind) return 'Resolve conflicts before continuing normal work.';
  if (kind === 'merge') return 'Resolve conflicts, then continue or abort the merge.';
  if (kind === 'rebase') return 'Resolve conflicts, then continue, skip, or abort the rebase.';
  if (kind === 'cherryPick')
    return 'Resolve conflicts, then continue, skip, or abort the cherry-pick.';
  if (kind === 'revert') return 'Resolve conflicts, then continue, skip, or abort the revert.';
  if (kind === 'bisect') return 'Reset bisect when finished testing.';
  return undefined;
}

function parseConflictStages(
  indexCode: string,
  worktreeCode: string
): Array<'base' | 'ours' | 'theirs' | 'working'> {
  const stages: Array<'base' | 'ours' | 'theirs' | 'working'> = [];
  if (indexCode !== ' ' && indexCode !== '?') stages.push('ours');
  if (worktreeCode !== ' ' && worktreeCode !== '?') stages.push('working');
  if (indexCode === 'U' || worktreeCode === 'U') {
    stages.push('base', 'ours', 'theirs');
  }
  return [...new Set(stages)];
}

function stageNumber(stage: 'base' | 'ours' | 'theirs' | 'working'): number {
  if (stage === 'base') return 1;
  if (stage === 'ours') return 2;
  if (stage === 'theirs') return 3;
  return 0;
}

async function readRebaseSteps(
  repoPath: string,
  kind: RecoveryOperationKind
): Promise<{ current?: number; total?: number } | undefined> {
  if (kind !== 'rebase') return undefined;
  const gitDir = path.join(repoPath, '.git');
  for (const sub of ['rebase-merge', 'rebase-apply']) {
    const dir = path.join(gitDir, sub);
    if (!(await fileExists(dir))) continue;
    const [msgnum, end] = await Promise.all([
      fs.readFile(path.join(dir, 'msgnum'), 'utf8').catch(() => ''),
      fs.readFile(path.join(dir, 'end'), 'utf8').catch(() => ''),
    ]);
    const current = parseInt(msgnum.trim(), 10);
    const total = parseInt(end.trim(), 10);
    if (!Number.isNaN(current) && !Number.isNaN(total)) {
      return { current, total };
    }
  }
  return undefined;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function notFound(projectId: string): ReturnType<typeof toBureauError> {
  return toBureauError({
    code: 'PROJECT_NOT_FOUND',
    message: `Repository ${projectId} not found.`,
    operation: 'recovery',
    subjectId: projectId,
    retryable: false,
  });
}

function errorResult(
  code: 'INVALID_REQUEST' | 'PROJECT_NOT_FOUND' | 'SNAPSHOT_STALE' | 'COMMAND_FAILED',
  message: string,
  operation: string,
  projectId?: string
): MutationResult {
  return {
    ok: false,
    error: toBureauError({ code, message, operation, subjectId: projectId, retryable: false }),
  };
}
