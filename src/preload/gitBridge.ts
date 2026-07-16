import type { CompareCommitsRequest } from '@shared/contracts/history';
import type { DiffRequest, StashEntry } from '@shared/contracts/operations';
import { IPC_CHANNELS } from '@shared/contracts/channels';
import type { BureauApiV1 } from '@shared/contracts/api';
import type {
  BranchSwitchRequest,
  BranchCreateRequest,
  BranchDeleteRequest,
  CommitRequest,
  DiffResult,
  FileMutationRequest,
  HunkMutationRequest,
  ListCommitFilesRequest,
  ListCommitFilesResult,
  MutationResult,
  RepoMutationRequest,
  StashIndexRequest,
  StashPushRequest,
} from '@shared/contracts/operations';
import type {
  OperationCancelRequest,
  OperationCancelResult,
  OperationListResult,
} from '@shared/contracts/operationLog';

type Invoke = <T>(channel: string, arg?: unknown) => Promise<T>;

export function createGitBridge(invoke: Invoke): Pick<BureauApiV1, 'git' | 'github' | 'operations'> {
  return {
    operations: {
    list: () => invoke<OperationListResult>(IPC_CHANNELS.OPERATIONS_LIST),
    cancel: (input: OperationCancelRequest) =>
      invoke<OperationCancelResult>(IPC_CHANNELS.OPERATIONS_CANCEL, input),
    },
    github: {
    getStatus: () => invoke(IPC_CHANNELS.GITHUB_GET_STATUS),
    signIn: () => invoke(IPC_CHANNELS.GITHUB_SIGN_IN),
    publish: (input: import('@shared/contracts/github').GitHubPublishRequest) =>
      invoke(IPC_CHANNELS.GITHUB_PUBLISH, input),
    openUrl: (input: { url: string }) => invoke(IPC_CHANNELS.GITHUB_OPEN_URL, input),
    },
    git: {
    listBranchDetails: (input: { projectId: string }) =>
      invoke(IPC_CHANNELS.GIT_LIST_BRANCH_DETAILS, input),
    switchBranch: (input: BranchSwitchRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_SWITCH_BRANCH, input),
    createBranch: (input: BranchCreateRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_CREATE_BRANCH, input),
    deleteBranch: (input: BranchDeleteRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_DELETE_BRANCH, input),
    publishBranch: (input: import('@shared/contracts/branches').BranchPublishRequest) =>
      invoke(IPC_CHANNELS.GIT_PUBLISH_BRANCH, input),
    setUpstream: (input: import('@shared/contracts/branches').BranchSetUpstreamRequest) =>
      invoke(IPC_CHANNELS.GIT_SET_UPSTREAM, input),
    renameBranch: (input: import('@shared/contracts/branches').BranchRenameRequest) =>
      invoke(IPC_CHANNELS.GIT_RENAME_BRANCH, input),
    checkoutTracking: (input: import('@shared/contracts/branches').BranchCheckoutTrackingRequest) =>
      invoke(IPC_CHANNELS.GIT_CHECKOUT_TRACKING, input),
    deleteRemoteBranch: (input: import('@shared/contracts/branches').BranchDeleteRemoteRequest) =>
      invoke(IPC_CHANNELS.GIT_DELETE_REMOTE_BRANCH, input),
    mergeBranch: (input: import('@shared/contracts/branches').MergeBranchRequest) =>
      invoke(IPC_CHANNELS.GIT_MERGE_BRANCH, input),
    rebaseBranch: (input: import('@shared/contracts/branches').RebaseBranchRequest) =>
      invoke(IPC_CHANNELS.GIT_REBASE_BRANCH, input),
    resetToCommit: (input: import('@shared/contracts/history').ResetToCommitRequest) =>
      invoke(IPC_CHANNELS.GIT_RESET_TO_COMMIT, input),
    checkoutCommit: (input: import('@shared/contracts/history').CheckoutCommitRequest) =>
      invoke(IPC_CHANNELS.GIT_CHECKOUT_COMMIT, input),
    listRemotes: (input: import('@shared/contracts/remotes').ListRemotesRequest) =>
      invoke(IPC_CHANNELS.GIT_LIST_REMOTES, input),
    addRemote: (input: import('@shared/contracts/remotes').AddRemoteRequest) =>
      invoke(IPC_CHANNELS.GIT_ADD_REMOTE, input),
    renameRemote: (input: import('@shared/contracts/remotes').RenameRemoteRequest) =>
      invoke(IPC_CHANNELS.GIT_RENAME_REMOTE, input),
    removeRemote: (input: import('@shared/contracts/remotes').RemoveRemoteRequest) =>
      invoke(IPC_CHANNELS.GIT_REMOVE_REMOTE, input),
    setRemoteUrl: (input: import('@shared/contracts/remotes').SetRemoteUrlRequest) =>
      invoke(IPC_CHANNELS.GIT_SET_REMOTE_URL, input),
    fetch: (input: RepoMutationRequest) => invoke<MutationResult>(IPC_CHANNELS.GIT_FETCH, input),
    stageFile: (input: FileMutationRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_STAGE_FILE, input),
    unstageFile: (input: FileMutationRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_UNSTAGE_FILE, input),
    stageAll: (input: RepoMutationRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_STAGE_ALL, input),
    unstageAll: (input: RepoMutationRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_UNSTAGE_ALL, input),
    discardFile: (input: FileMutationRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_DISCARD_FILE, input),
    discardAll: (input: RepoMutationRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_DISCARD_ALL, input),
    commit: (input: CommitRequest) => invoke<MutationResult>(IPC_CHANNELS.GIT_COMMIT, input),
    pullFastForward: (input: RepoMutationRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_PULL_FAST_FORWARD, input),
    push: (input: RepoMutationRequest) => invoke<MutationResult>(IPC_CHANNELS.GIT_PUSH, input),
    stashPush: (input: StashPushRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_STASH_PUSH, input),
    stashPop: (input: StashIndexRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_STASH_POP, input),
    stashDrop: (input: StashIndexRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_STASH_DROP, input),
    stashList: (input: { projectId: string }) =>
      invoke<StashEntry[]>(IPC_CHANNELS.GIT_STASH_LIST, input),
    listStashFiles: (input: { projectId: string; index: number }) =>
      invoke(IPC_CHANNELS.GIT_STASH_LIST_FILES, input),
    getStashDiff: (input: { projectId: string; index: number; path: string }) =>
      invoke<DiffResult>(IPC_CHANNELS.GIT_STASH_DIFF, input),
    stashApply: (input: import('@shared/contracts/stashDetail').StashApplyRequest) =>
      invoke(IPC_CHANNELS.GIT_STASH_APPLY, input),
    stashBranch: (input: import('@shared/contracts/stashDetail').StashBranchRequest) =>
      invoke(IPC_CHANNELS.GIT_STASH_BRANCH, input),
    stashRestoreFiles: (input: import('@shared/contracts/stashDetail').StashRestoreFilesRequest) =>
      invoke(IPC_CHANNELS.GIT_STASH_RESTORE_FILES, input),
    getDiff: (input: DiffRequest) => invoke<DiffResult>(IPC_CHANNELS.GIT_GET_DIFF, input),
    listCommitFiles: (input: ListCommitFilesRequest) =>
      invoke<ListCommitFilesResult>(IPC_CHANNELS.GIT_LIST_COMMIT_FILES, input),
    listHistory: (input: import('@shared/contracts/history').ListHistoryRequest) =>
      invoke(IPC_CHANNELS.GIT_LIST_HISTORY, input),
    listReflog: (input: import('@shared/contracts/history').ListReflogRequest) =>
      invoke(IPC_CHANNELS.GIT_LIST_REFLOG, input),
    listTags: (input: import('@shared/contracts/history').ListTagsRequest) =>
      invoke(IPC_CHANNELS.GIT_LIST_TAGS, input),
    cherryPick: (input: import('@shared/contracts/history').CherryPickRequest) =>
      invoke(IPC_CHANNELS.GIT_CHERRY_PICK, input),
    revertCommit: (input: import('@shared/contracts/history').RevertCommitRequest) =>
      invoke(IPC_CHANNELS.GIT_REVERT_COMMIT, input),
    createBranchFromCommit: (
      input: import('@shared/contracts/history').CreateBranchFromCommitRequest
    ) => invoke(IPC_CHANNELS.GIT_CREATE_BRANCH_FROM_COMMIT, input),
    createTag: (input: import('@shared/contracts/history').CreateTagRequest) =>
      invoke(IPC_CHANNELS.GIT_CREATE_TAG, input),
    deleteTag: (input: import('@shared/contracts/history').DeleteTagRequest) =>
      invoke(IPC_CHANNELS.GIT_DELETE_TAG, input),
    pushTag: (input: import('@shared/contracts/history').PushTagRequest) =>
      invoke(IPC_CHANNELS.GIT_PUSH_TAG, input),
    deleteRemoteTag: (input: import('@shared/contracts/history').DeleteRemoteTagRequest) =>
      invoke(IPC_CHANNELS.GIT_DELETE_REMOTE_TAG, input),
    compareCommits: (input: CompareCommitsRequest) =>
      invoke(IPC_CHANNELS.GIT_COMPARE_COMMITS, input),
    applyHunk: (input: HunkMutationRequest) =>
      invoke<MutationResult>(IPC_CHANNELS.GIT_APPLY_HUNK, input),
    getOperationState: (input: { projectId: string }) =>
      invoke(IPC_CHANNELS.GIT_GET_OPERATION_STATE, input),
    getConflictVersion: (input: import('@shared/contracts/recovery').ConflictVersionRequest) =>
      invoke(IPC_CHANNELS.GIT_GET_CONFLICT_VERSION, input),
    resolveConflict: (input: import('@shared/contracts/recovery').ConflictResolveRequest) =>
      invoke(IPC_CHANNELS.GIT_RESOLVE_CONFLICT, input),
    mergeContinue: (input: RepoMutationRequest) => invoke(IPC_CHANNELS.GIT_MERGE_CONTINUE, input),
    mergeAbort: (input: RepoMutationRequest) => invoke(IPC_CHANNELS.GIT_MERGE_ABORT, input),
    rebaseContinue: (input: RepoMutationRequest) => invoke(IPC_CHANNELS.GIT_REBASE_CONTINUE, input),
    rebaseSkip: (input: RepoMutationRequest) => invoke(IPC_CHANNELS.GIT_REBASE_SKIP, input),
    rebaseAbort: (input: RepoMutationRequest) => invoke(IPC_CHANNELS.GIT_REBASE_ABORT, input),
    cherryPickContinue: (input: RepoMutationRequest) =>
      invoke(IPC_CHANNELS.GIT_CHERRY_PICK_CONTINUE, input),
    cherryPickSkip: (input: RepoMutationRequest) =>
      invoke(IPC_CHANNELS.GIT_CHERRY_PICK_SKIP, input),
    cherryPickAbort: (input: RepoMutationRequest) =>
      invoke(IPC_CHANNELS.GIT_CHERRY_PICK_ABORT, input),
    revertContinue: (input: RepoMutationRequest) => invoke(IPC_CHANNELS.GIT_REVERT_CONTINUE, input),
    revertSkip: (input: RepoMutationRequest) => invoke(IPC_CHANNELS.GIT_REVERT_SKIP, input),
    revertAbort: (input: RepoMutationRequest) => invoke(IPC_CHANNELS.GIT_REVERT_ABORT, input),
    bisectReset: (input: RepoMutationRequest) => invoke(IPC_CHANNELS.GIT_BISECT_RESET, input),
    listWorktrees: (input: { projectId: string }) => invoke(IPC_CHANNELS.GIT_LIST_WORKTREES, input),
    addWorktree: (input: import('@shared/contracts/advanced').AddWorktreeRequest) =>
      invoke(IPC_CHANNELS.GIT_ADD_WORKTREE, input),
    removeWorktree: (input: import('@shared/contracts/advanced').RemoveWorktreeRequest) =>
      invoke(IPC_CHANNELS.GIT_REMOVE_WORKTREE, input),
    lockWorktree: (input: import('@shared/contracts/advanced').WorktreeLockRequest) =>
      invoke(IPC_CHANNELS.GIT_LOCK_WORKTREE, input),
    unlockWorktree: (input: import('@shared/contracts/advanced').WorktreeLockRequest) =>
      invoke(IPC_CHANNELS.GIT_UNLOCK_WORKTREE, input),
    pruneWorktrees: (input: { projectId: string; snapshotRevision: string }) =>
      invoke(IPC_CHANNELS.GIT_PRUNE_WORKTREES, input),
    listSubmodules: (input: { projectId: string }) => invoke(IPC_CHANNELS.GIT_LIST_SUBMODULES, input),
    blame: (input: {
      projectId: string;
      path: string;
      commitOid: string;
      offset?: number;
      limit?: number;
    }) => invoke(IPC_CHANNELS.GIT_BLAME, input),
    submoduleInit: (input: { projectId: string; snapshotRevision: string; path: string }) =>
      invoke(IPC_CHANNELS.GIT_SUBMODULE_INIT, input),
    submoduleUpdate: (input: { projectId: string; snapshotRevision: string; path: string }) =>
      invoke(IPC_CHANNELS.GIT_SUBMODULE_UPDATE, input),
      refresh: (input: { projectId: string }) => invoke(IPC_CHANNELS.GIT_REFRESH, input),
      snapshot: (input: { projectId: string }) => invoke(IPC_CHANNELS.GIT_SNAPSHOT, input),
      clone: (input: import('@shared/contracts/gitLifecycle').CloneRequest) =>
        invoke(IPC_CHANNELS.GIT_CLONE, input),
      initRepository: (input: import('@shared/contracts/gitLifecycle').InitRepositoryRequest) =>
        invoke(IPC_CHANNELS.GIT_INIT, input),
    },
  };
}
