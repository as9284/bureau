import type { AppCapabilities } from './capabilities';
import type {
  AddProjectRequest,
  ProjectIdRequest,
  RemoveProcessRequest,
  SaveProcessRequest,
  StackDetectionResult,
  TrackedProject,
} from './projects';
import type {
  LogSnapshot,
  ProcessOutputEvent,
  ProcessStatusEvent,
  ProcessTargetRequest,
  ProjectProcesses,
} from './processes';
import type { OkResult, Result } from './errors';
import type {
  PreviewBounds,
  PreviewHotkey,
  PreviewConsoleMessage,
  PreviewNavigateRequest,
  PreviewOpenExternalRequest,
  PreviewSetVisibleRequest,
  PreviewSetZoomRequest,
  PreviewState,
} from './preview';
import type { CloseRequestedEvent, ShutdownBeginEvent, ShutdownProgressEvent } from './lifecycle';
import type {
  CloneRequest,
  CloneResult,
  InitRepositoryRequest,
  InitRepositoryResult,
} from './gitLifecycle';
import type { GitSnapshot, GitSnapshotRequest, RepositorySnapshot } from './gitSnapshot';
import type { ChooseDirectoryRequest, ChooseDirectoryResult } from './system';
import type { EditorPreset, PublicSettings, SettingsPatch, TerminalPreset } from './settings';
import type { AndroidApi } from './android';
import type { ProjectToolchains, SetActiveVersionRequest } from './toolchains';
import type { KillPortRequest, ProjectPorts } from './ports';
import type { ProjectTasks, RunTaskRequest } from './tasks';
import type {
  CommitRequest,
  BranchSwitchRequest,
  BranchCreateRequest,
  BranchDeleteRequest,
  DiffRequest,
  DiffResult,
  FileMutationRequest,
  HunkMutationRequest,
  ListCommitFilesRequest,
  ListCommitFilesResult,
  MutationResult,
  RecentCommit,
  RepoMutationRequest,
  StashEntry,
  StashPushRequest,
  StashIndexRequest,
} from './operations';
import type {
  OperationCancelRequest,
  OperationCancelResult,
  OperationListResult,
} from './operationLog';
import type {
  BranchCheckoutTrackingRequest,
  BranchDeleteRemoteRequest,
  BranchDetail,
  BranchPublishRequest,
  BranchRenameRequest,
  BranchSetUpstreamRequest,
} from './branches';
import type {
  BisectState,
  ConflictResolveRequest,
  ConflictVersionRequest,
  ConflictVersionResult,
  OperationStateDetails,
  RecoveryActionRequest,
} from './recovery';
import type {
  CherryPickRequest,
  CompareCommitsRequest,
  CompareCommitsResult,
  CreateBranchFromCommitRequest,
  CreateTagRequest,
  DeleteRemoteTagRequest,
  DeleteTagRequest,
  ListHistoryRequest,
  ListHistoryResult,
  ListTagsRequest,
  ListTagsResult,
  PushTagRequest,
  RevertCommitRequest,
} from './history';
import type {
  StashApplyRequest,
  StashBranchRequest,
  StashFileEntry,
  StashRestoreFilesRequest,
} from './stashDetail';
import type {
  AddWorktreeRequest,
  BlameResult,
  RemoveWorktreeRequest,
  SubmoduleEntry,
  WorktreeEntry,
  WorktreeLockRequest,
} from './advanced';
import type { GitHubCliStatus, GitHubPublishRequest, GitHubPublishResult } from './github';
import type { FilesApi } from './files';
import type { AppUpdateState } from './updates';

export type Unsubscribe = () => void;

export type PtyOutputEvent = {
  projectId: string;
  processId: string;
  data: string;
};

// The typed surface exposed to the renderer via contextBridge as `window.bureau`.
export type BureauApiV1 = {
  files: FilesApi;
  app: {
    getCapabilities(): Promise<AppCapabilities>;
    minimizeWindow(): Promise<void>;
    toggleMaximizeWindow(): Promise<void>;
    closeWindow(): Promise<void>;
    confirmQuit(): Promise<void>;
    cancelQuit(): Promise<void>;
    setDirtyFiles(input: { count: number }): Promise<void>;
    getUpdateState(): Promise<AppUpdateState>;
    checkForUpdates(): Promise<AppUpdateState>;
    installUpdate(): Promise<boolean>;
    onCloseRequested(listener: (event: CloseRequestedEvent) => void): Unsubscribe;
    onShutdownBegin(listener: (event: ShutdownBeginEvent) => void): Unsubscribe;
    onShutdownProgress(listener: (event: ShutdownProgressEvent) => void): Unsubscribe;
    onUpdateState(listener: (state: AppUpdateState) => void): Unsubscribe;
  };
  projects: {
    list(): Promise<TrackedProject[]>;
    detect(input: AddProjectRequest): Promise<StackDetectionResult>;
    add(input: AddProjectRequest): Promise<Result<{ project: TrackedProject }>>;
    remove(input: ProjectIdRequest): Promise<void>;
    touch(input: ProjectIdRequest): Promise<TrackedProject>;
  };
  processes: {
    list(input: ProjectIdRequest): Promise<ProjectProcesses>;
    start(input: ProcessTargetRequest): Promise<OkResult>;
    stop(input: ProcessTargetRequest): Promise<OkResult>;
    restart(input: ProcessTargetRequest): Promise<OkResult>;
    stopAll(input: ProjectIdRequest): Promise<void>;
    getLog(input: ProcessTargetRequest): Promise<LogSnapshot>;
    saveDefinition(input: SaveProcessRequest): Promise<ProjectProcesses>;
    removeDefinition(input: RemoveProcessRequest): Promise<ProjectProcesses>;
    writePty(input: { projectId: string; processId: string; data: string }): Promise<void>;
    resizePty(input: {
      projectId: string;
      processId: string;
      cols: number;
      rows: number;
    }): Promise<void>;
    onOutput(listener: (event: ProcessOutputEvent) => void): Unsubscribe;
    onStatus(listener: (event: ProcessStatusEvent) => void): Unsubscribe;
    onPty(listener: (event: PtyOutputEvent) => void): Unsubscribe;
  };
  preview: {
    setBounds(bounds: PreviewBounds): Promise<void>;
    navigate(input: PreviewNavigateRequest): Promise<void>;
    reload(): Promise<void>;
    reloadHard(): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    setVisible(input: PreviewSetVisibleRequest): Promise<void>;
    openExternal(input: PreviewOpenExternalRequest): Promise<void>;
    openDevTools(): Promise<void>;
    setZoom(input: PreviewSetZoomRequest): Promise<void>;
    clearConsole(): Promise<void>;
    onState(listener: (state: PreviewState) => void): Unsubscribe;
    onHotkey(listener: (hotkey: PreviewHotkey) => void): Unsubscribe;
    onConsole(listener: (messages: PreviewConsoleMessage[]) => void): Unsubscribe;
  };
  system: {
    chooseDirectory(input: ChooseDirectoryRequest): Promise<ChooseDirectoryResult>;
    openInEditor(input: { projectId: string }): Promise<OkResult>;
    openInTerminal(input: { projectId: string }): Promise<OkResult>;
    openInExplorer(input: { projectId: string }): Promise<OkResult>;
  };
  operations: {
    list(): Promise<OperationListResult>;
    cancel(input: OperationCancelRequest): Promise<OperationCancelResult>;
  };
  github: {
    getStatus(): Promise<GitHubCliStatus>;
    signIn(): Promise<GitHubCliStatus>;
    publish(input: GitHubPublishRequest): Promise<GitHubPublishResult>;
    openUrl(input: { url: string }): Promise<void>;
  };
  git: {
    refresh(input: { projectId: string }): Promise<RepositorySnapshot>;
    snapshot(input: GitSnapshotRequest): Promise<GitSnapshot>;
    clone(input: CloneRequest): Promise<CloneResult>;
    initRepository(input: InitRepositoryRequest): Promise<InitRepositoryResult>;
    listBranches(input: { projectId: string }): Promise<string[]>;
    listBranchDetails(input: { projectId: string }): Promise<BranchDetail[]>;
    switchBranch(input: BranchSwitchRequest): Promise<MutationResult>;
    createBranch(input: BranchCreateRequest): Promise<MutationResult>;
    deleteBranch(input: BranchDeleteRequest): Promise<MutationResult>;
    publishBranch(input: BranchPublishRequest): Promise<MutationResult>;
    setUpstream(input: BranchSetUpstreamRequest): Promise<MutationResult>;
    renameBranch(input: BranchRenameRequest): Promise<MutationResult>;
    checkoutTracking(input: BranchCheckoutTrackingRequest): Promise<MutationResult>;
    deleteRemoteBranch(input: BranchDeleteRemoteRequest): Promise<MutationResult>;
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
    stashList(input: { projectId: string }): Promise<StashEntry[]>;
    listStashFiles(input: { projectId: string; index: number }): Promise<StashFileEntry[]>;
    getStashDiff(input: { projectId: string; index: number; path: string }): Promise<DiffResult>;
    stashApply(input: StashApplyRequest): Promise<MutationResult>;
    stashBranch(input: StashBranchRequest): Promise<MutationResult>;
    stashRestoreFiles(input: StashRestoreFilesRequest): Promise<MutationResult>;
    getDiff(input: DiffRequest): Promise<DiffResult>;
    listCommitFiles(input: ListCommitFilesRequest): Promise<ListCommitFilesResult>;
    listRecentCommits(input: { projectId: string; limit?: number }): Promise<RecentCommit[]>;
    listHistory(input: ListHistoryRequest): Promise<ListHistoryResult>;
    listTags(input: ListTagsRequest): Promise<ListTagsResult>;
    cherryPick(input: CherryPickRequest): Promise<MutationResult>;
    revertCommit(input: RevertCommitRequest): Promise<MutationResult>;
    createBranchFromCommit(input: CreateBranchFromCommitRequest): Promise<MutationResult>;
    createTag(input: CreateTagRequest): Promise<MutationResult>;
    deleteTag(input: DeleteTagRequest): Promise<MutationResult>;
    pushTag(input: PushTagRequest): Promise<MutationResult>;
    deleteRemoteTag(input: DeleteRemoteTagRequest): Promise<MutationResult>;
    compareCommits(input: CompareCommitsRequest): Promise<CompareCommitsResult>;
    applyHunk(input: HunkMutationRequest): Promise<MutationResult>;
    getOperationState(input: { projectId: string }): Promise<OperationStateDetails>;
    getBisectState(input: { projectId: string }): Promise<BisectState>;
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
  settings: {
    get(): Promise<PublicSettings>;
    update(patch: SettingsPatch): Promise<PublicSettings>;
    chooseGitExecutable(): Promise<PublicSettings>;
    clearGitExecutable(): Promise<PublicSettings>;
    chooseCustomEditor(): Promise<PublicSettings>;
    setEditorPreset(input: { preset: EditorPreset | 'none' }): Promise<PublicSettings>;
    chooseCustomTerminal(): Promise<PublicSettings>;
    setTerminalPreset(input: { preset: TerminalPreset | 'auto' }): Promise<PublicSettings>;
  };
  android: AndroidApi;
  toolchains: {
    get(input: ProjectIdRequest): Promise<ProjectToolchains>;
    setActive(
      input: SetActiveVersionRequest
    ): Promise<OkResult & { toolchains: ProjectToolchains }>;
  };
  ports: {
    list(input: ProjectIdRequest): Promise<ProjectPorts>;
    kill(input: KillPortRequest): Promise<OkResult>;
  };
  tasks: {
    list(input: ProjectIdRequest): Promise<ProjectTasks>;
    run(input: RunTaskRequest): Promise<OkResult>;
  };
};
