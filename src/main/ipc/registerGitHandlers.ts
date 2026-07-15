import { shell } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/channels';
import {
  projectIdRequestSchema,
  fileMutationRequestSchema,
  repoMutationRequestSchema,
  commitRequestSchema,
  branchSwitchRequestSchema,
  branchCreateRequestSchema,
  branchDeleteRequestSchema,
  stashPushRequestSchema,
  stashIndexRequestSchema,
  diffRequestSchema,
  recentCommitsRequestSchema,
  listCommitFilesRequestSchema,
  operationCancelRequestSchema,
  hunkMutationRequestSchema,
  addWorktreeRequestSchema,
  removeWorktreeRequestSchema,
  lockWorktreeRequestSchema,
  historyRequestSchema,
  tagsRequestSchema,
  stashFilesRequestSchema,
  stashDiffRequestSchema,
  conflictVersionRequestSchema,
  conflictResolveRequestSchema,
  branchPublishRequestSchema,
  branchSetUpstreamRequestSchema,
  branchRenameRequestSchema,
  branchCheckoutTrackingRequestSchema,
  branchDeleteRemoteRequestSchema,
  commitOidMutationRequestSchema,
  branchFromCommitRequestSchema,
  createTagRequestSchema,
  tagMutationRequestSchema,
  remoteTagMutationRequestSchema,
  stashMutationRequestSchema,
  stashBranchRequestSchema,
  stashRestoreFilesRequestSchema,
  submoduleActionRequestSchema,
  blameRequestSchema,
  compareCommitsRequestSchema,
  cloneRequestSchema,
  initRepositoryRequestSchema,
  githubPublishRequestSchema,
  githubOpenUrlRequestSchema,
} from '@shared/validation/requests';
import type { AppServices } from './serviceContracts';

type RegisterFn = <T, R>(
  channel: string,
  operation: string,
  handler: (args: T) => Promise<R>
) => void;

/** Git + GitHub IPC handlers (ported from StarGit, projectId-scoped). */
export function registerGitHandlers(services: AppServices, register: RegisterFn): void {
  register(IPC_CHANNELS.GITHUB_GET_STATUS, 'github.getStatus', async () =>
    services.github.getStatus()
  );
  register(IPC_CHANNELS.GITHUB_SIGN_IN, 'github.signIn', async () => services.github.signIn());
  register(IPC_CHANNELS.GITHUB_PUBLISH, 'github.publish', async (args: unknown) =>
    services.github.publish(githubPublishRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GITHUB_OPEN_URL, 'github.openUrl', async (args: unknown) => {
    const input = githubOpenUrlRequestSchema.parse(args);
    await shell.openExternal(input.url);
  });

  register(IPC_CHANNELS.OPERATIONS_LIST, 'operations.list', async () => services.operations.list());
  register(IPC_CHANNELS.OPERATIONS_CANCEL, 'operations.cancel', async (args: unknown) =>
    services.operations.cancel(operationCancelRequestSchema.parse(args))
  );

  register(IPC_CHANNELS.GIT_REFRESH, 'git.refresh', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.git.refresh(input);
  });

  register(IPC_CHANNELS.GIT_SNAPSHOT, 'git.snapshot', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.git.snapshot(input);
  });

  register(IPC_CHANNELS.GIT_CLONE, 'git.clone', async (args: unknown) =>
    services.git.clone(cloneRequestSchema.parse(args))
  );

  register(IPC_CHANNELS.GIT_INIT, 'git.init', async (args: unknown) =>
    services.git.initRepository(initRepositoryRequestSchema.parse(args))
  );

  const projectId = (channel: string, op: string, fn: (id: string) => Promise<unknown>) => {
    register(channel, op, async (args: unknown) => {
      const input = projectIdRequestSchema.parse(args);
      return fn(input.projectId);
    });
  };

  const mutation = (
    channel: string,
    op: string,
    fn: (input: ReturnType<typeof repoMutationRequestSchema.parse>) => Promise<unknown>
  ) => {
    register(channel, op, async (args: unknown) => fn(repoMutationRequestSchema.parse(args)));
  };

  register(IPC_CHANNELS.GIT_STAGE_FILE, 'git.stageFile', async (args: unknown) =>
    services.git.stageFile(fileMutationRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_STAGE_ALL, 'git.stageAll', async (args: unknown) =>
    services.git.stageAll(repoMutationRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_UNSTAGE_ALL, 'git.unstageAll', async (args: unknown) =>
    services.git.unstageAll(repoMutationRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_DISCARD_FILE, 'git.discardFile', async (args: unknown) =>
    services.git.discardFile(fileMutationRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_DISCARD_ALL, 'git.discardAll', async (args: unknown) =>
    services.git.discardAll(repoMutationRequestSchema.parse(args))
  );
  projectId(IPC_CHANNELS.GIT_LIST_BRANCHES, 'git.listBranches', (id) =>
    services.git.listBranches({ projectId: id })
  );
  register(IPC_CHANNELS.GIT_SWITCH_BRANCH, 'git.switchBranch', async (args: unknown) =>
    services.git.switchBranch(branchSwitchRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_CREATE_BRANCH, 'git.createBranch', async (args: unknown) =>
    services.git.createBranch(branchCreateRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_DELETE_BRANCH, 'git.deleteBranch', async (args: unknown) =>
    services.git.deleteBranch(branchDeleteRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_FETCH, 'git.fetch', async (args: unknown) =>
    services.git.fetch(repoMutationRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_UNSTAGE_FILE, 'git.unstageFile', async (args: unknown) =>
    services.git.unstageFile(fileMutationRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_COMMIT, 'git.commit', async (args: unknown) =>
    services.git.commit(commitRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_PULL_FAST_FORWARD, 'git.pullFastForward', async (args: unknown) =>
    services.git.pullFastForward(repoMutationRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_PUSH, 'git.push', async (args: unknown) =>
    services.git.push(repoMutationRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_STASH_PUSH, 'git.stashPush', async (args: unknown) =>
    services.git.stashPush(stashPushRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_STASH_POP, 'git.stashPop', async (args: unknown) =>
    services.git.stashPop(stashIndexRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_STASH_DROP, 'git.stashDrop', async (args: unknown) =>
    services.git.stashDrop(stashIndexRequestSchema.parse(args))
  );
  projectId(IPC_CHANNELS.GIT_STASH_LIST, 'git.stashList', (id) =>
    services.git.stashList({ projectId: id })
  );
  register(IPC_CHANNELS.GIT_GET_DIFF, 'git.getDiff', async (args: unknown) =>
    services.git.getDiff(diffRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_LIST_COMMIT_FILES, 'git.listCommitFiles', async (args: unknown) =>
    services.git.listCommitFiles(listCommitFilesRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_LIST_RECENT_COMMITS, 'git.listRecentCommits', async (args: unknown) =>
    services.git.listRecentCommits(recentCommitsRequestSchema.parse(args))
  );

  projectId(IPC_CHANNELS.GIT_LIST_BRANCH_DETAILS, 'git.listBranchDetails', (id) =>
    services.git.listBranchDetails({ projectId: id })
  );
  projectId(IPC_CHANNELS.GIT_GET_OPERATION_STATE, 'git.getOperationState', (id) =>
    services.git.getOperationState({ projectId: id })
  );
  projectId(IPC_CHANNELS.GIT_GET_BISECT_STATE, 'git.getBisectState', (id) =>
    services.git.getBisectState({ projectId: id })
  );
  projectId(IPC_CHANNELS.GIT_LIST_WORKTREES, 'git.listWorktrees', (id) =>
    services.git.listWorktrees({ projectId: id })
  );
  register(IPC_CHANNELS.GIT_ADD_WORKTREE, 'git.addWorktree', async (args: unknown) =>
    services.git.addWorktree(addWorktreeRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_REMOVE_WORKTREE, 'git.removeWorktree', async (args: unknown) =>
    services.git.removeWorktree(removeWorktreeRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_LOCK_WORKTREE, 'git.lockWorktree', async (args: unknown) =>
    services.git.lockWorktree(lockWorktreeRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_UNLOCK_WORKTREE, 'git.unlockWorktree', async (args: unknown) =>
    services.git.unlockWorktree(lockWorktreeRequestSchema.parse(args))
  );
  mutation(IPC_CHANNELS.GIT_PRUNE_WORKTREES, 'git.pruneWorktrees', (i) =>
    services.git.pruneWorktrees(i)
  );
  projectId(IPC_CHANNELS.GIT_LIST_SUBMODULES, 'git.listSubmodules', (id) =>
    services.git.listSubmodules({ projectId: id })
  );
  register(IPC_CHANNELS.GIT_LIST_HISTORY, 'git.listHistory', async (args: unknown) =>
    services.git.listHistory(historyRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_LIST_TAGS, 'git.listTags', async (args: unknown) =>
    services.git.listTags(tagsRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_APPLY_HUNK, 'git.applyHunk', async (args: unknown) =>
    services.git.applyHunk(hunkMutationRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_STASH_LIST_FILES, 'git.listStashFiles', async (args: unknown) =>
    services.git.listStashFiles(stashFilesRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_STASH_DIFF, 'git.stashDiff', async (args: unknown) =>
    services.git.getStashDiff(stashDiffRequestSchema.parse(args))
  );

  mutation(IPC_CHANNELS.GIT_MERGE_CONTINUE, 'git.mergeContinue', (i) =>
    services.git.mergeContinue(i)
  );
  mutation(IPC_CHANNELS.GIT_MERGE_ABORT, 'git.mergeAbort', (i) => services.git.mergeAbort(i));
  mutation(IPC_CHANNELS.GIT_REBASE_CONTINUE, 'git.rebaseContinue', (i) =>
    services.git.rebaseContinue(i)
  );
  mutation(IPC_CHANNELS.GIT_REBASE_SKIP, 'git.rebaseSkip', (i) => services.git.rebaseSkip(i));
  mutation(IPC_CHANNELS.GIT_REBASE_ABORT, 'git.rebaseAbort', (i) => services.git.rebaseAbort(i));
  mutation(IPC_CHANNELS.GIT_CHERRY_PICK_CONTINUE, 'git.cherryPickContinue', (i) =>
    services.git.cherryPickContinue(i)
  );
  mutation(IPC_CHANNELS.GIT_CHERRY_PICK_SKIP, 'git.cherryPickSkip', (i) =>
    services.git.cherryPickSkip(i)
  );
  mutation(IPC_CHANNELS.GIT_CHERRY_PICK_ABORT, 'git.cherryPickAbort', (i) =>
    services.git.cherryPickAbort(i)
  );
  mutation(IPC_CHANNELS.GIT_REVERT_CONTINUE, 'git.revertContinue', (i) =>
    services.git.revertContinue(i)
  );
  mutation(IPC_CHANNELS.GIT_REVERT_SKIP, 'git.revertSkip', (i) => services.git.revertSkip(i));
  mutation(IPC_CHANNELS.GIT_REVERT_ABORT, 'git.revertAbort', (i) => services.git.revertAbort(i));
  mutation(IPC_CHANNELS.GIT_BISECT_RESET, 'git.bisectReset', (i) => services.git.bisectReset(i));

  register(IPC_CHANNELS.GIT_PUBLISH_BRANCH, 'git.publishBranch', async (a: unknown) =>
    services.git.publishBranch(branchPublishRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_SET_UPSTREAM, 'git.setUpstream', async (a: unknown) =>
    services.git.setUpstream(branchSetUpstreamRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_RENAME_BRANCH, 'git.renameBranch', async (a: unknown) =>
    services.git.renameBranch(branchRenameRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_CHECKOUT_TRACKING, 'git.checkoutTracking', async (a: unknown) =>
    services.git.checkoutTracking(branchCheckoutTrackingRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_DELETE_REMOTE_BRANCH, 'git.deleteRemoteBranch', async (a: unknown) =>
    services.git.deleteRemoteBranch(branchDeleteRemoteRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_CHERRY_PICK, 'git.cherryPick', async (a: unknown) =>
    services.git.cherryPick(commitOidMutationRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_REVERT_COMMIT, 'git.revertCommit', async (a: unknown) =>
    services.git.revertCommit(commitOidMutationRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_CREATE_BRANCH_FROM_COMMIT, 'git.createBranchFromCommit', async (a: unknown) =>
    services.git.createBranchFromCommit(branchFromCommitRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_CREATE_TAG, 'git.createTag', async (a: unknown) =>
    services.git.createTag(createTagRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_DELETE_TAG, 'git.deleteTag', async (a: unknown) =>
    services.git.deleteTag(tagMutationRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_PUSH_TAG, 'git.pushTag', async (a: unknown) =>
    services.git.pushTag(tagMutationRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_DELETE_REMOTE_TAG, 'git.deleteRemoteTag', async (a: unknown) =>
    services.git.deleteRemoteTag(remoteTagMutationRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_STASH_APPLY, 'git.stashApply', async (a: unknown) =>
    services.git.stashApply(stashMutationRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_STASH_BRANCH, 'git.stashBranch', async (a: unknown) =>
    services.git.stashBranch(stashBranchRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_STASH_RESTORE_FILES, 'git.stashRestoreFiles', async (a: unknown) =>
    services.git.stashRestoreFiles(stashRestoreFilesRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_SUBMODULE_INIT, 'git.submoduleInit', async (a: unknown) =>
    services.git.submoduleInit(submoduleActionRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_SUBMODULE_UPDATE, 'git.submoduleUpdate', async (a: unknown) =>
    services.git.submoduleUpdate(submoduleActionRequestSchema.parse(a))
  );
  register(IPC_CHANNELS.GIT_GET_CONFLICT_VERSION, 'git.getConflictVersion', async (args: unknown) =>
    services.git.getConflictVersion(conflictVersionRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_RESOLVE_CONFLICT, 'git.resolveConflict', async (args: unknown) =>
    services.git.resolveConflict(conflictResolveRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_BLAME, 'git.blame', async (args: unknown) =>
    services.git.blame(blameRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.GIT_COMPARE_COMMITS, 'git.compareCommits', async (args: unknown) =>
    services.git.compareCommits(compareCommitsRequestSchema.parse(args))
  );
}
