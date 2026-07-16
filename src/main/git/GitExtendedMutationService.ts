import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { SnapshotCache } from '../projects/SnapshotCache';
import type { OperationCoordinator } from '../operations/OperationCoordinator';
import type { GitExecutableResolver } from './GitExecutableResolver';
import type { GitRunner } from './GitRunner';
import type { GitStatusService } from './GitStatusService';
import type {
  BranchCheckoutTrackingRequest,
  BranchDeleteRemoteRequest,
  BranchPublishRequest,
  BranchRenameRequest,
  BranchSetUpstreamRequest,
  MergeBranchRequest,
  RebaseBranchRequest,
} from '@shared/contracts/branches';
import type {
  CheckoutCommitRequest,
  CherryPickRequest,
  CreateBranchFromCommitRequest,
  CreateTagRequest,
  DeleteRemoteTagRequest,
  DeleteTagRequest,
  PushTagRequest,
  ResetToCommitRequest,
  RevertCommitRequest,
} from '@shared/contracts/history';
import type {
  AddRemoteRequest,
  RemoveRemoteRequest,
  RenameRemoteRequest,
  SetRemoteUrlRequest,
} from '@shared/contracts/remotes';
import type {
  StashApplyRequest,
  StashBranchRequest,
  StashRestoreFilesRequest,
} from '@shared/contracts/stashDetail';
import type { CommitRequest, MutationResult } from '@shared/contracts/operations';
import { checkRefNameBasics } from '@shared/git/refChecks';
import { detectBlockedOperations } from './GitOperationDetector';
import { toBureauError } from '../ipc/errors';

const TIMEOUT_MS = 60_000;
const NON_INTERACTIVE = ['-c', 'core.editor=true'];

export type GitExtendedMutationService = {
  publishBranch(input: BranchPublishRequest): Promise<MutationResult>;
  setUpstream(input: BranchSetUpstreamRequest): Promise<MutationResult>;
  renameBranch(input: BranchRenameRequest): Promise<MutationResult>;
  checkoutTracking(input: BranchCheckoutTrackingRequest): Promise<MutationResult>;
  deleteRemoteBranch(input: BranchDeleteRemoteRequest): Promise<MutationResult>;
  mergeBranch(input: MergeBranchRequest): Promise<MutationResult>;
  rebaseBranch(input: RebaseBranchRequest): Promise<MutationResult>;
  resetToCommit(input: ResetToCommitRequest): Promise<MutationResult>;
  checkoutCommit(input: CheckoutCommitRequest): Promise<MutationResult>;
  cherryPick(input: CherryPickRequest): Promise<MutationResult>;
  revertCommit(input: RevertCommitRequest): Promise<MutationResult>;
  addRemote(input: AddRemoteRequest): Promise<MutationResult>;
  renameRemote(input: RenameRemoteRequest): Promise<MutationResult>;
  removeRemote(input: RemoveRemoteRequest): Promise<MutationResult>;
  setRemoteUrl(input: SetRemoteUrlRequest): Promise<MutationResult>;
  createBranchFromCommit(input: CreateBranchFromCommitRequest): Promise<MutationResult>;
  createTag(input: CreateTagRequest): Promise<MutationResult>;
  deleteTag(input: DeleteTagRequest): Promise<MutationResult>;
  pushTag(input: PushTagRequest): Promise<MutationResult>;
  deleteRemoteTag(input: DeleteRemoteTagRequest): Promise<MutationResult>;
  stashApply(input: StashApplyRequest): Promise<MutationResult>;
  stashBranch(input: StashBranchRequest): Promise<MutationResult>;
  stashRestoreFiles(input: StashRestoreFilesRequest): Promise<MutationResult>;
  commitEnhanced(input: CommitRequest): Promise<MutationResult>;
};

export function createGitExtendedMutationService(params: {
  catalogue: ProjectCatalogue;
  snapshotCache: SnapshotCache;
  resolver: GitExecutableResolver;
  runner: GitRunner;
  statusService: GitStatusService;
  coordinator: OperationCoordinator;
}): GitExtendedMutationService {
  const { catalogue, snapshotCache, resolver, runner, statusService, coordinator } = params;

  async function runMutation(
    projectId: string,
    operation: string,
    fn: (executablePath: string, repoPath: string) => Promise<void>
  ): Promise<MutationResult> {
    return coordinator.runMutation(projectId, async () => {
      const repo = catalogue.get(projectId);
      if (!repo) return err('PROJECT_NOT_FOUND', 'Repository not found.', operation, projectId);

      const capability = await resolver.resolve();
      if (capability.kind !== 'available') {
        return err('GIT_NOT_FOUND', 'Git is not available.', operation, projectId);
      }

      try {
        await fn(capability.executablePath, repo.canonicalPath);
      } catch (error) {
        return err(
          'COMMAND_FAILED',
          error instanceof Error ? error.message : String(error),
          operation,
          projectId
        );
      }

      const snapshot = await statusService.collectSnapshot(projectId, repo.canonicalPath);
      snapshotCache.set(projectId, snapshot);
      return { ok: true, snapshot };
    });
  }

  function checkEligible(
    projectId: string,
    revision: string,
    operation: string
  ): MutationResult | undefined {
    const snapshot = snapshotCache.get(projectId);
    if (!snapshot || snapshot.revision !== revision) {
      return err('SNAPSHOT_STALE', 'Repository snapshot is stale.', operation, projectId);
    }
    if (snapshot.blockedOperation) {
      return err('REPOSITORY_BLOCKED', 'Repository is blocked.', operation, projectId);
    }
    return undefined;
  }

  async function publishBranch(input: BranchPublishRequest): Promise<MutationResult> {
    const branchName = input.branchName?.trim();
    if (branchName) {
      const refErr = checkRefNameBasics(branchName);
      if (refErr) return err('INVALID_REQUEST', refErr.message, 'publishBranch', input.projectId);
    }
    const e = checkEligible(input.projectId, input.snapshotRevision, 'publishBranch');
    if (e) return e;
    const remote = input.remoteName ?? 'origin';
    return runMutation(input.projectId, 'publishBranch', async (exe, repoPath) => {
      const remoteResult = await runner.run(exe, {
        args: ['-C', repoPath, 'remote', 'get-url', remote],
        timeoutMs: TIMEOUT_MS,
      });
      if (remoteResult.exitCode !== 0) {
        if (!input.remoteUrl) {
          throw new Error(`Remote "${remote}" is not configured. Enter a remote URL to publish.`);
        }
        const addResult = await runner.run(exe, {
          args: ['-C', repoPath, 'remote', 'add', remote, input.remoteUrl],
          timeoutMs: TIMEOUT_MS,
        });
        if (addResult.exitCode !== 0) throw new Error(addResult.stderr);
      } else if (input.remoteUrl && remoteResult.stdout.trim() !== input.remoteUrl.trim()) {
        // Still refuses to silently repoint an existing remote, but the remedy is now
        // in the app (Git → Remotes) rather than "go use a terminal".
        throw new Error(
          `Remote "${remote}" already points to a different URL. Change it in the Remotes panel before publishing.`
        );
      }

      const sourceBranch = branchName ?? 'HEAD';
      const destinationBranch = branchName ? `${branchName}:${branchName}` : 'HEAD';
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'push', '-u', remote, destinationBranch],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `Failed to publish ${sourceBranch}.`);
      }
    });
  }

  async function setUpstream(input: BranchSetUpstreamRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'setUpstream');
    if (e) return e;
    return runMutation(input.projectId, 'setUpstream', async (exe, repoPath) => {
      const args = input.upstreamRef
        ? ['branch', '--set-upstream-to', input.upstreamRef]
        : ['branch', '--unset-upstream'];
      const result = await runner.run(exe, {
        args: ['-C', repoPath, ...args],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function renameBranch(input: BranchRenameRequest): Promise<MutationResult> {
    const refErr = checkRefNameBasics(input.newName);
    if (refErr) return err('INVALID_REQUEST', refErr.message, 'renameBranch', input.projectId);
    const e = checkEligible(input.projectId, input.snapshotRevision, 'renameBranch');
    if (e) return e;
    return runMutation(input.projectId, 'renameBranch', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'branch', '-m', input.newName],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function checkoutTracking(input: BranchCheckoutTrackingRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'checkoutTracking');
    if (e) return e;
    const localName = input.localName ?? input.remoteRef.split('/').slice(1).join('/');
    return runMutation(input.projectId, 'checkoutTracking', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'switch', '-c', localName, '--track', input.remoteRef],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function deleteRemoteBranch(input: BranchDeleteRemoteRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'deleteRemoteBranch');
    if (e) return e;
    return runMutation(input.projectId, 'deleteRemoteBranch', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'push', input.remoteName, '--delete', input.branchName],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  /**
   * A conflicting merge/rebase/cherry-pick/revert exits non-zero, but it is not a
   * failure: git has left the repository mid-operation for the user to resolve, which
   * is exactly what GitOperationDetector reports and the recovery banner drives.
   * Detect that state instead of matching git's (localised) stderr text, and only
   * surface a real error when the command failed *without* starting anything — which
   * is what still reports e.g. revert's "-m option was given" on a merge commit,
   * since that leaves no REVERT_HEAD behind.
   */
  async function tolerateConflict(
    repoPath: string,
    kind: 'merge' | 'rebase' | 'cherryPick' | 'revert',
    stderr: string,
    fallbackMessage: string
  ): Promise<void> {
    const detection = await detectBlockedOperations(repoPath);
    if (detection.kinds.includes(kind)) return;
    throw new Error(stderr.trim() || fallbackMessage);
  }

  async function mergeBranch(input: MergeBranchRequest): Promise<MutationResult> {
    const refErr = checkRefNameBasics(input.branchName);
    if (refErr) return err('INVALID_REQUEST', refErr.message, 'mergeBranch', input.projectId);
    const e = checkEligible(input.projectId, input.snapshotRevision, 'mergeBranch');
    if (e) return e;
    return runMutation(input.projectId, 'mergeBranch', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, ...NON_INTERACTIVE, 'merge', '--no-edit', input.branchName],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode === 0) return;
      await tolerateConflict(
        repoPath,
        'merge',
        result.stderr,
        `Could not merge ${input.branchName}.`
      );
    });
  }

  async function rebaseBranch(input: RebaseBranchRequest): Promise<MutationResult> {
    const refErr = checkRefNameBasics(input.ontoRef);
    if (refErr) return err('INVALID_REQUEST', refErr.message, 'rebaseBranch', input.projectId);
    const e = checkEligible(input.projectId, input.snapshotRevision, 'rebaseBranch');
    if (e) return e;
    return runMutation(input.projectId, 'rebaseBranch', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, ...NON_INTERACTIVE, 'rebase', input.ontoRef],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode === 0) return;
      await tolerateConflict(
        repoPath,
        'rebase',
        result.stderr,
        `Could not rebase onto ${input.ontoRef}.`
      );
    });
  }

  /**
   * `mode` is a closed union in the contract and Zod-checked at the handler, so
   * `--${mode}` cannot become an attacker-chosen option; `commitOid` is oid-validated
   * (hex only), which is what stops a dash-leading target being parsed as a flag.
   * No conflict tolerance here: reset either moves HEAD or fails outright.
   */
  async function resetToCommit(input: ResetToCommitRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'resetToCommit');
    if (e) return e;
    return runMutation(input.projectId, 'resetToCommit', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'reset', `--${input.mode}`, input.commitOid],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `Could not reset to ${input.commitOid}.`);
      }
    });
  }

  /**
   * `git checkout <oid>` with no branch — HEAD ends up detached. Deliberately not
   * routed through `switch`, whose `--detach` is the same thing with a worse error
   * when the working tree is dirty. Nothing is destroyed: git refuses to detach over
   * uncommitted changes, so a failure here is git's own guard, not data loss.
   */
  async function checkoutCommit(input: CheckoutCommitRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'checkoutCommit');
    if (e) return e;
    return runMutation(input.projectId, 'checkoutCommit', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'checkout', '--detach', input.commitOid],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `Could not check out ${input.commitOid}.`);
      }
    });
  }

  /**
   * `-m <n>` is mandatory for a merge commit and rejected for an ordinary one, so it is
   * passed through exactly as the caller set it rather than defaulted: guessing `-m 1`
   * would silently pick a side of the merge and produce a wrong-but-successful commit.
   * The value is Zod-bounded to a small int, so it cannot become an attacker-chosen option.
   */
  function mainlineArgs(mainline?: number): string[] {
    return mainline === undefined ? [] : ['-m', String(mainline)];
  }

  async function cherryPick(input: CherryPickRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'cherryPick');
    if (e) return e;
    return runMutation(input.projectId, 'cherryPick', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: [
          '-C',
          repoPath,
          ...NON_INTERACTIVE,
          'cherry-pick',
          ...mainlineArgs(input.mainline),
          input.commitOid,
        ],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode === 0) return;
      // A conflicting cherry-pick/revert leaves the repo mid-operation for the user to
      // resolve — the same "not a failure" case merge/rebase handle above.
      await tolerateConflict(
        repoPath,
        'cherryPick',
        result.stderr,
        `Could not cherry-pick ${input.commitOid}.`
      );
    });
  }

  async function revertCommit(input: RevertCommitRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'revertCommit');
    if (e) return e;
    return runMutation(input.projectId, 'revertCommit', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: [
          '-C',
          repoPath,
          ...NON_INTERACTIVE,
          'revert',
          '--no-edit',
          ...mainlineArgs(input.mainline),
          input.commitOid,
        ],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode === 0) return;
      await tolerateConflict(
        repoPath,
        'revert',
        result.stderr,
        `Could not revert ${input.commitOid}.`
      );
    });
  }

  async function addRemote(input: AddRemoteRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'addRemote');
    if (e) return e;
    return runMutation(input.projectId, 'addRemote', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'remote', 'add', input.name, input.url],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `Could not add remote "${input.name}".`);
      }
    });
  }

  async function renameRemote(input: RenameRemoteRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'renameRemote');
    if (e) return e;
    return runMutation(input.projectId, 'renameRemote', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'remote', 'rename', input.name, input.newName],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `Could not rename remote "${input.name}".`);
      }
    });
  }

  async function removeRemote(input: RemoveRemoteRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'removeRemote');
    if (e) return e;
    return runMutation(input.projectId, 'removeRemote', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'remote', 'remove', input.name],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `Could not remove remote "${input.name}".`);
      }
    });
  }

  async function setRemoteUrl(input: SetRemoteUrlRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'setRemoteUrl');
    if (e) return e;
    return runMutation(input.projectId, 'setRemoteUrl', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'remote', 'set-url', input.name, input.url],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `Could not change the URL for "${input.name}".`);
      }
    });
  }

  async function createBranchFromCommit(
    input: CreateBranchFromCommitRequest
  ): Promise<MutationResult> {
    const refErr = checkRefNameBasics(input.branchName);
    if (refErr)
      return err('INVALID_REQUEST', refErr.message, 'createBranchFromCommit', input.projectId);
    const e = checkEligible(input.projectId, input.snapshotRevision, 'createBranchFromCommit');
    if (e) return e;
    return runMutation(input.projectId, 'createBranchFromCommit', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'branch', input.branchName, input.commitOid],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function createTag(input: CreateTagRequest): Promise<MutationResult> {
    const refErr = checkRefNameBasics(input.name);
    if (refErr) return err('INVALID_REQUEST', refErr.message, 'createTag', input.projectId);
    const e = checkEligible(input.projectId, input.snapshotRevision, 'createTag');
    if (e) return e;
    return runMutation(input.projectId, 'createTag', async (exe, repoPath) => {
      const args =
        input.annotated && input.message
          ? ['tag', '-a', input.name, input.targetOid, '-m', input.message]
          : ['tag', input.name, input.targetOid];
      const result = await runner.run(exe, {
        args: ['-C', repoPath, ...args],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function deleteTag(input: DeleteTagRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'deleteTag');
    if (e) return e;
    return runMutation(input.projectId, 'deleteTag', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'tag', '-d', input.name],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function pushTag(input: PushTagRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'pushTag');
    if (e) return e;
    return runMutation(input.projectId, 'pushTag', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'push', 'origin', input.name],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function deleteRemoteTag(input: DeleteRemoteTagRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'deleteRemoteTag');
    if (e) return e;
    return runMutation(input.projectId, 'deleteRemoteTag', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'push', input.remoteName, '--delete', `refs/tags/${input.name}`],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function stashApply(input: StashApplyRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'stashApply');
    if (e) return e;
    return runMutation(input.projectId, 'stashApply', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'stash', 'apply', `stash@{${input.index}}`],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function stashBranch(input: StashBranchRequest): Promise<MutationResult> {
    const refErr = checkRefNameBasics(input.branchName);
    if (refErr) return err('INVALID_REQUEST', refErr.message, 'stashBranch', input.projectId);
    const e = checkEligible(input.projectId, input.snapshotRevision, 'stashBranch');
    if (e) return e;
    return runMutation(input.projectId, 'stashBranch', async (exe, repoPath) => {
      const result = await runner.run(exe, {
        args: ['-C', repoPath, 'stash', 'branch', input.branchName, `stash@{${input.index}}`],
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  async function stashRestoreFiles(input: StashRestoreFilesRequest): Promise<MutationResult> {
    const e = checkEligible(input.projectId, input.snapshotRevision, 'stashRestoreFiles');
    if (e) return e;
    return runMutation(input.projectId, 'stashRestoreFiles', async (exe, repoPath) => {
      for (const filePath of input.paths) {
        const result = await runner.run(exe, {
          args: ['-C', repoPath, 'checkout', `stash@{${input.index}}`, '--', filePath],
          timeoutMs: TIMEOUT_MS,
        });
        if (result.exitCode !== 0) throw new Error(result.stderr);
      }
    });
  }

  async function commitEnhanced(input: CommitRequest): Promise<MutationResult> {
    // These guards used to live in GitMutationService.commit, which this method
    // shadows in the composition root — so they were unreachable in the shipped
    // app and INVALID_COMMIT_MESSAGE/NO_STAGED_CHANGES could never be returned.
    // Main is the trust boundary; the renderer's own checks are not a substitute.
    if (input.message.trim().length === 0) {
      return err('INVALID_COMMIT_MESSAGE', 'Commit message cannot be empty.', 'commit', input.projectId);
    }
    if (Buffer.byteLength(input.message, 'utf8') > 10000) {
      return err('INVALID_COMMIT_MESSAGE', 'Commit message is too long.', 'commit', input.projectId);
    }
    const e = checkEligible(input.projectId, input.snapshotRevision, 'commit');
    if (e) return e;
    // `--amend` with nothing staged is legitimate (it rewrites the message only),
    // so the staged-changes guard applies to ordinary commits alone.
    if (!input.amend && !snapshotCache.get(input.projectId)?.changedFiles.some((f) => f.staged)) {
      return err('NO_STAGED_CHANGES', 'No staged changes to commit.', 'commit', input.projectId);
    }
    return runMutation(input.projectId, 'commit', async (exe, repoPath) => {
      const args = ['-C', repoPath, 'commit', '--file=-'];
      if (input.amend) args.push('--amend');
      if (input.signOff) args.push('--signoff');
      if (input.signing === 'config') args.push('-S');
      const result = await runner.run(exe, {
        args,
        stdin: Buffer.from(input.message, 'utf8'),
        timeoutMs: TIMEOUT_MS,
      });
      if (result.exitCode !== 0) throw new Error(result.stderr);
    });
  }

  return {
    publishBranch,
    setUpstream,
    renameBranch,
    checkoutTracking,
    deleteRemoteBranch,
    mergeBranch,
    rebaseBranch,
    resetToCommit,
    checkoutCommit,
    cherryPick,
    revertCommit,
    addRemote,
    renameRemote,
    removeRemote,
    setRemoteUrl,
    createBranchFromCommit,
    createTag,
    deleteTag,
    pushTag,
    deleteRemoteTag,
    stashApply,
    stashBranch,
    stashRestoreFiles,
    commitEnhanced,
  };
}

function err(
  code:
    | 'PROJECT_NOT_FOUND'
    | 'GIT_NOT_FOUND'
    | 'SNAPSHOT_STALE'
    | 'REPOSITORY_BLOCKED'
    | 'INVALID_REQUEST'
    | 'INVALID_COMMIT_MESSAGE'
    | 'NO_STAGED_CHANGES'
    | 'COMMAND_FAILED',
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
      retryable: code !== 'INVALID_REQUEST',
    }),
  };
}
