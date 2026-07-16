import { create } from 'zustand';
import { useAppStore, type ToastTone } from './appStore';
import { applyAppearance } from '@renderer/lib/appearance';
import { createLatestRequestWins } from '@renderer/lib/latestRequestWins';
import type { BureauError } from '@shared/contracts/errors';
import type { AppCapabilities } from '@shared/contracts/capabilities';
import type { EditorPreset, PublicSettings, SettingsPatch, TerminalPreset } from '@shared/contracts/settings';
import type { RepositorySnapshot, TrackedRepository } from '@shared/contracts/gitSnapshot';
import type {
  CommitFileChange, DiffArea, StashEntry } from '@shared/contracts/operations';
import type { BranchDetail } from '@shared/contracts/branches';
import type {
  CompareCommitsResult,
  HistoryCommit,
  HistoryFilters,
  ReflogEntry,
  ResetMode,
} from '@shared/contracts/history';
import type { RemoteEntry } from '@shared/contracts/remotes';
import type { ConflictStage } from '@shared/contracts/recovery';
import type { CloneRequest, InitRepositoryRequest } from '@shared/contracts/gitLifecycle';
import type { StashFileEntry } from '@shared/contracts/stashDetail';
import type { HunkAction } from '@shared/contracts/stashDetail';
import type { OperationRecord } from '@shared/contracts/operationLog';
import type { OperationStateDetails } from '@shared/contracts/recovery';
import type { BlameLine, SubmoduleEntry } from '@shared/contracts/advanced';
import type { TagDetail } from '@shared/contracts/history';
import type { GitHubPublishRequest, GitHubPublishResult } from '@shared/contracts/github';

const branchLoadRequest = createLatestRequestWins();
const historyLoadRequest = createLatestRequestWins();
const diffLoadRequest = createLatestRequestWins();
const commitFilesLoadRequest = createLatestRequestWins();
// GitWorkbench re-fires these from an effect keyed on projectId, so a fast
// project switch could let a stale response overwrite the new project's panel.
const stashLoadRequest = createLatestRequestWins();
const stashFilesLoadRequest = createLatestRequestWins();
const worktreesLoadRequest = createLatestRequestWins();
const submodulesLoadRequest = createLatestRequestWins();
const tagsLoadRequest = createLatestRequestWins();
const blameLoadRequest = createLatestRequestWins();
const reflogLoadRequest = createLatestRequestWins();
const remotesLoadRequest = createLatestRequestWins();

export type RepoPanel =
  | 'changes'
  | 'branches'
  | 'stash'
  | 'history'
  | 'reflog'
  | 'worktrees'
  | 'submodules'
  | 'tags'
  | 'remotes';

export type { DiffArea };

export type SelectedDiffFile = {
  projectId: string;
  path: string;
  area: DiffArea | 'stash';
  commitOid?: string;
  stashIndex?: number;
};

export type CommitOptions = {
  amend: boolean;
  signOff: boolean;
};

export type RepoState = {
  catalogue: TrackedRepository;
  snapshot?: RepositorySnapshot;
  error?: BureauError;
  refreshing: boolean;
};

type AppStore = {
  capabilities?: AppCapabilities;
  settings?: PublicSettings;
  /**
   * A destructive git action awaiting explicit confirmation. Gating lives in the
   * store (not in each panel) so every entry point — toolbar button, context
   * menu, command palette, any future caller — is gated by construction. A
   * per-component gate is what let the conflict context menu overwrite a
   * working-tree resolution with no prompt.
   */
  pendingConfirm?: GitConfirmRequest;
  repos: Record<string, RepoState>;
  commitDrafts: Record<string, string>;
  /**
   * `retry` re-fires the exact call that failed, so the workbench banner can offer a
   * real Retry rather than a Dismiss that loses the action.
   */
  operationByRepo: Record<
    string,
    { name?: string; error?: BureauError; retry?: () => Promise<void> }
  >;
  operationDrawerOpen: boolean;
  operations: OperationRecord[];
  operationsLoading: boolean;
  operationsError?: BureauError;
  recoveryStateByRepo: Record<string, OperationStateDetails | undefined>;
  announcements: string[];
  selectedFile?: SelectedDiffFile;
  selectedCommitOid?: string;
  commitFiles: CommitFileChange[];
  commitFilesLoading: boolean;
  commitFilesError?: string;
  repoPanel: RepoPanel;
  diffText?: string;
  diffLoading: boolean;
  /**
   * A failed diff load is an error, not content. It used to be written into
   * `diffText`, so `parseUnifiedDiff` rendered the error prose as the diff body.
   * Shared by loadDiff and loadStashDiff, exactly like `diffText`/`diffLoading`.
   */
  diffError?: BureauError;
  branches: string[];
  branchDetails: BranchDetail[];
  branchesLoading: boolean;
  branchesError?: BureauError;
  stashEntries: StashEntry[];
  stashLoading: boolean;
  stashError?: BureauError;
  selectedStashIndex?: number;
  stashFiles: StashFileEntry[];
  worktrees: import('@shared/contracts/advanced').WorktreeEntry[];
  worktreesLoading: boolean;
  worktreesError?: BureauError;
  remotes: RemoteEntry[];
  remotesLoading: boolean;
  remotesError?: BureauError;
  historyCommits: HistoryCommit[];
  historyHasMore: boolean;
  historyNextCursor?: string;
  historyFilters: HistoryFilters;
  historyLoading: boolean;
  historyError?: BureauError;
  newBranchName: string;
  commitOptionsByRepo: Record<string, CommitOptions>;
  cloneDialogOpen: boolean;
  cloneBusy: boolean;
  cloneError?: BureauError;
  initDialogOpen: boolean;
  initBusy: boolean;
  initError?: BureauError;
  githubPublishRepoId?: string;
  submodules: SubmoduleEntry[];
  submodulesLoading: boolean;
  submodulesError?: BureauError;
  tags: TagDetail[];
  tagsLoading: boolean;
  tagsError?: BureauError;
  tagsHasMore: boolean;
  tagsNextCursor?: string;
  reflog: ReflogEntry[];
  reflogLoading: boolean;
  reflogError?: BureauError;
  reflogHasMore: boolean;
  reflogNextCursor?: string;
  blameLines: BlameLine[];
  blameLoading: boolean;
  blameHasMore: boolean;
  blamePath?: string;
  blameCommitOid?: string;
  conflictPreview?: {
    path: string;
    stage: ConflictStage;
    content: string;
    binary: boolean;
  };
  compareResult?: CompareCommitsResult;
  compareDialogOpen: boolean;
  compareBaseOid?: string;
  compareTargetOid?: string;

  setRepoPanel: (panel: RepoPanel) => void;
  setSelectedFile: (file?: SelectedDiffFile) => void;
  setNewBranchName: (name: string) => void;
  setCommitDraft: (projectId: string, message: string) => void;
  clearOperationError: (projectId: string) => void;
  /** Re-run the operation whose failure is showing in the workbench banner. */
  retryOperation: (projectId: string) => Promise<void>;
  setOperationDrawerOpen: (open: boolean) => void;
  setCloneDialogOpen: (open: boolean) => void;
  setInitDialogOpen: (open: boolean) => void;
  setGitHubPublishRepoId: (projectId?: string) => void;
  setHistoryFilters: (projectId: string, filters: HistoryFilters) => void;
  setCommitAmend: (projectId: string, amend: boolean) => void;
  setCommitSignOff: (projectId: string, signOff: boolean) => void;
  loadOperations: () => Promise<void>;
  cancelOperation: (operationId: string) => Promise<void>;
  /**
   * Run `run` immediately, or hold it behind the shared confirmation dialog when
   * the matching `confirmations.*` setting is on. Every destructive git action
   * routes through here, so a new call site cannot skip the prompt.
   */
  gateConfirm: (
    settingKey: keyof PublicSettings['confirmations'],
    descriptor: Omit<GitConfirmRequest, 'run'>,
    run: () => Promise<void>
  ) => Promise<void>;
  /** Dismiss the pending destructive-action confirmation without running it. */
  cancelGitConfirm: () => void;
  /** Run the pending destructive action the user just confirmed. */
  acceptGitConfirm: () => Promise<void>;
  loadRecoveryState: (projectId: string) => Promise<void>;
  runRecoveryAction: (
    projectId: string,
    revision: string,
    action: 'continue' | 'skip' | 'abort'
  ) => Promise<void>;
  resolveConflict: (
    projectId: string,
    revision: string,
    path: string,
    resolution: 'ours' | 'theirs' | 'markResolved'
  ) => Promise<void>;
  loadConflictVersion: (
    projectId: string,
    path: string,
    stage: ConflictStage
  ) => Promise<import('@shared/contracts/recovery').ConflictVersionResult>;
  clearConflictPreview: () => void;
  bisectReset: (projectId: string, revision: string) => Promise<void>;
  compareCommits: (
    projectId: string,
    baseOid: string,
    targetOid: string
  ) => Promise<CompareCommitsResult>;
  setCompareDialogOpen: (open: boolean) => void;
  setCompareBaseOid: (oid?: string) => void;

  refreshRepo: (projectId: string) => Promise<void>;

  /**
   * `retryable` is opt-in, and deliberately so. Every destructive action reaches
   * this through `gateConfirm`'s already-confirmed `run`, so a retry recorded here
   * would re-fire the git command *without* re-passing the gate — the exact bypass
   * the store-level gate exists to make impossible. Opting in per call site means a
   * forgotten annotation costs a Retry button, not a silent unconfirmed reset.
   * Reserved for operations that fail transiently and destroy nothing.
   */
  runRepoOperation: (
    projectId: string,
    name: string,
    fn: () => Promise<
      { ok: true; snapshot: RepositorySnapshot } | { ok: false; error: BureauError }
    >,
    options?: { retryable?: boolean }
  ) => Promise<void>;

  stageFile: (projectId: string, revision: string, path: string) => Promise<void>;
  unstageFile: (projectId: string, revision: string, path: string) => Promise<void>;
  stageAll: (projectId: string, revision: string) => Promise<void>;
  unstageAll: (projectId: string, revision: string) => Promise<void>;
  discardFile: (projectId: string, revision: string, path: string) => Promise<void>;
  discardAll: (projectId: string, revision: string) => Promise<void>;
  commit: (
    projectId: string,
    revision: string,
    message: string,
    options?: { amend?: boolean; signOff?: boolean; signing?: 'config' | 'off' }
  ) => Promise<void>;
  applyHunk: (
    projectId: string,
    revision: string,
    path: string,
    area: 'staged' | 'unstaged',
    patch: string,
    action: HunkAction
  ) => Promise<void>;
  fetch: (projectId: string, revision: string) => Promise<void>;
  pull: (projectId: string, revision: string) => Promise<void>;
  push: (projectId: string, revision: string) => Promise<void>;
  switchBranch: (projectId: string, revision: string, branchName: string) => Promise<void>;
  createBranch: (projectId: string, revision: string, branchName: string) => Promise<void>;
  deleteBranch: (projectId: string, revision: string, branchName: string) => Promise<void>;
  publishBranch: (
    projectId: string,
    revision: string,
    branchName: string,
    remoteName?: string,
    remoteUrl?: string
  ) => Promise<void>;
  renameBranch: (projectId: string, revision: string, newName: string) => Promise<void>;
  checkoutTracking: (
    projectId: string,
    revision: string,
    remoteRef: string,
    localName?: string
  ) => Promise<void>;
  setUpstream: (projectId: string, revision: string, upstreamRef: string | null) => Promise<void>;
  deleteRemoteBranch: (
    projectId: string,
    revision: string,
    remoteName: string,
    branchName: string
  ) => Promise<void>;
  /** Merge `branchName` into the checked-out branch. Conflicts land in the recovery banner. */
  mergeBranch: (projectId: string, revision: string, branchName: string) => Promise<void>;
  /** Replay the checked-out branch onto `ontoRef`. Conflicts land in the recovery banner. */
  rebaseBranch: (projectId: string, revision: string, ontoRef: string) => Promise<void>;
  /**
   * `mainline` is the 1-based parent index git needs for a *merge* commit (`-m <n>`).
   * Omit it for an ordinary commit — git rejects it there. The caller reads the count
   * from the target's `parentOids` and asks the user; nothing here guesses.
   */
  cherryPick: (
    projectId: string,
    revision: string,
    commitOid: string,
    mainline?: number
  ) => Promise<void>;
  revertCommit: (
    projectId: string,
    revision: string,
    commitOid: string,
    mainline?: number
  ) => Promise<void>;
  /** Check out a commit directly, leaving HEAD detached. Gated on `checkoutCommit`. */
  checkoutCommit: (projectId: string, revision: string, commitOid: string) => Promise<void>;
  createBranchFromCommit: (
    projectId: string,
    revision: string,
    branchName: string,
    commitOid: string
  ) => Promise<void>;
  createTag: (
    projectId: string,
    revision: string,
    name: string,
    targetOid: string,
    message?: string
  ) => Promise<void>;
  stashPush: (
    projectId: string,
    revision: string,
    message?: string,
    includeUntracked?: boolean
  ) => Promise<void>;
  stashPop: (projectId: string, revision: string, index: number) => Promise<void>;
  stashDrop: (projectId: string, revision: string, index: number) => Promise<void>;
  selectStash: (projectId: string, index: number) => Promise<void>;
  loadStashFiles: (projectId: string, index: number) => Promise<void>;
  loadStashDiff: (projectId: string, index: number, path: string) => Promise<void>;
  stashApply: (projectId: string, revision: string, index: number) => Promise<void>;
  stashBranch: (
    projectId: string,
    revision: string,
    index: number,
    branchName: string
  ) => Promise<void>;
  stashRestoreFiles: (
    projectId: string,
    revision: string,
    index: number,
    paths: string[]
  ) => Promise<void>;
  cloneRepository: (input: CloneRequest) => Promise<void>;
  initRepository: (input: InitRepositoryRequest) => Promise<void>;
  publishToGitHub: (input: GitHubPublishRequest) => Promise<GitHubPublishResult>;

  loadSubmodules: (projectId: string) => Promise<void>;
  submoduleInit: (projectId: string, revision: string, path: string) => Promise<void>;
  submoduleUpdate: (projectId: string, revision: string, path: string) => Promise<void>;
  loadTags: (projectId: string, append?: boolean) => Promise<void>;
  deleteTag: (projectId: string, revision: string, name: string) => Promise<void>;
  pushTag: (projectId: string, revision: string, name: string) => Promise<void>;
  deleteRemoteTag: (
    projectId: string,
    revision: string,
    remoteName: string,
    name: string
  ) => Promise<void>;
  loadBlame: (projectId: string, path: string, commitOid: string, append?: boolean) => Promise<void>;
  clearBlame: () => void;

  loadDiff: (projectId: string, path: string, area: DiffArea, commitOid?: string) => Promise<void>;
  loadBranches: (projectId: string) => Promise<void>;
  loadStash: (projectId: string) => Promise<void>;
  loadRemotes: (projectId: string) => Promise<void>;
  addRemote: (projectId: string, revision: string, name: string, url: string) => Promise<void>;
  renameRemote: (
    projectId: string,
    revision: string,
    name: string,
    newName: string
  ) => Promise<void>;
  /** Gated on `removeRemote`: takes the remote's tracking branches with it. */
  removeRemote: (projectId: string, revision: string, name: string) => Promise<void>;
  setRemoteUrl: (projectId: string, revision: string, name: string, url: string) => Promise<void>;
  loadWorktrees: (projectId: string) => Promise<void>;
  addWorktree: (
    projectId: string,
    revision: string,
    path: string,
    options?: { branch?: string; newBranch?: string }
  ) => Promise<void>;
  removeWorktree: (projectId: string, revision: string, path: string) => Promise<void>;
  lockWorktree: (projectId: string, revision: string, path: string, reason?: string) => Promise<void>;
  unlockWorktree: (projectId: string, revision: string, path: string) => Promise<void>;
  pruneWorktrees: (projectId: string, revision: string) => Promise<void>;
  loadHistory: (projectId: string) => Promise<void>;
  loadMoreHistory: (projectId: string) => Promise<void>;
  loadReflog: (projectId: string, append?: boolean) => Promise<void>;
  /**
   * Move the current branch to `commitOid`. Gated on `resetHard` for `hard` (which
   * destroys uncommitted work) and on `resetBranch` for soft/mixed.
   */
  resetToCommit: (
    projectId: string,
    revision: string,
    commitOid: string,
    mode: ResetMode
  ) => Promise<void>;
  selectCommit: (projectId: string, commitOid: string) => Promise<void>;
  clearCommitSelection: () => void;

  openInFileExplorer: (projectId: string) => Promise<void>;
  openInTerminal: (projectId: string) => Promise<void>;
  openInExternalTerminal: (projectId: string) => Promise<void>;
  openInEditor: (projectId: string) => Promise<void>;
  chooseGitExecutable: () => Promise<void>;
  clearGitExecutable: () => Promise<void>;
  chooseCustomEditor: () => Promise<void>;
  setEditorPreset: (preset: EditorPreset | 'none') => Promise<void>;
  chooseCustomTerminal: () => Promise<void>;
  setTerminalPreset: (preset: TerminalPreset | 'auto') => Promise<void>;
  refreshCapabilities: () => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<void>;
};

const api = () => window.bureau;

/**
 * One-shot action failures (open in editor/terminal/explorer, settings and
 * capability writes, blame, clone/init success) surface through the app-wide
 * ToastStack that WorkbenchShell already mounts. These are transient outcomes of
 * a deliberate click, not panel state — a toast reports them where the user is
 * looking and dismisses itself, whereas the store fields they used to be written
 * to (`globalError`, `statusBanner`) had no reader at all and failed silently.
 * Panel *load* failures are different: they persist as `<panel>Error` and get a
 * PanelError banner with Retry.
 */
function toast(tone: ToastTone, message: string): void {
  useAppStore.getState().pushToast(tone, message);
}

function toError(err: unknown, operation: string): BureauError {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return err as BureauError;
  }
  return {
    code: 'COMMAND_FAILED',
    message: err instanceof Error ? err.message : 'An unexpected error occurred',
    operation,
    retryable: true,
  };
}

/** A destructive git action held pending an explicit user confirmation. */
export type GitConfirmRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<void>;
};

export const useGitStore = create<AppStore>((set, get) => ({
  pendingConfirm: undefined,
  repos: {},
  commitDrafts: {},
  operationByRepo: {},
  operationDrawerOpen: false,
  operations: [],
  operationsLoading: false,
  operationsError: undefined,
  recoveryStateByRepo: {},
  announcements: [],
  repoPanel: 'changes',
  diffLoading: false,
  diffError: undefined,
  commitFiles: [],
  commitFilesLoading: false,
  commitFilesError: undefined,
  branches: [],
  branchDetails: [],
  branchesLoading: false,
  branchesError: undefined,
  stashEntries: [],
  stashLoading: false,
  stashError: undefined,
  selectedStashIndex: undefined,
  stashFiles: [],
  worktrees: [],
  worktreesLoading: false,
  worktreesError: undefined,
  remotes: [],
  remotesLoading: false,
  remotesError: undefined,
  historyCommits: [],
  historyHasMore: false,
  historyNextCursor: undefined,
  historyFilters: {},
  historyLoading: false,
  historyError: undefined,
  newBranchName: '',
  commitOptionsByRepo: {},
  cloneDialogOpen: false,
  cloneBusy: false,
  cloneError: undefined,
  initDialogOpen: false,
  initBusy: false,
  initError: undefined,
  githubPublishRepoId: undefined,
  submodules: [],
  submodulesLoading: false,
  submodulesError: undefined,
  tags: [],
  tagsLoading: false,
  tagsError: undefined,
  tagsHasMore: false,
  tagsNextCursor: undefined,
  reflog: [],
  reflogLoading: false,
  reflogError: undefined,
  reflogHasMore: false,
  reflogNextCursor: undefined,
  blameLines: [],
  blameLoading: false,
  blameHasMore: false,
  blamePath: undefined,
  blameCommitOid: undefined,
  conflictPreview: undefined,
  compareResult: undefined,
  compareDialogOpen: false,
  compareBaseOid: undefined,
  compareTargetOid: undefined,

  setRepoPanel: (panel) =>
    set((s) => ({
      repoPanel: panel,
      ...(panel !== 'history'
        ? {
            selectedCommitOid: undefined,
            commitFiles: [],
            commitFilesError: undefined,
            ...(s.selectedFile?.area === 'commit'
              ? { selectedFile: undefined, diffText: undefined, diffError: undefined }
              : {}),
          }
        : {
            selectedFile:
              s.selectedFile?.area === 'staged' || s.selectedFile?.area === 'unstaged'
                ? undefined
                : s.selectedFile,
            diffText:
              s.selectedFile?.area === 'staged' || s.selectedFile?.area === 'unstaged'
                ? undefined
                : s.diffText,
            diffError:
              s.selectedFile?.area === 'staged' || s.selectedFile?.area === 'unstaged'
                ? undefined
                : s.diffError,
          }),
      ...(panel !== 'stash'
        ? {
            selectedStashIndex: undefined,
            stashFiles: [],
            ...(s.selectedFile?.area === 'stash'
              ? { selectedFile: undefined, diffText: undefined, diffError: undefined }
              : {}),
          }
        : {}),
      ...(panel !== 'history'
        ? {
            blameLines: [],
            blameHasMore: false,
            blamePath: undefined,
            blameCommitOid: undefined,
          }
        : {}),
    })),
  setSelectedFile: (file) =>
    set({
      selectedFile: file,
      diffText: undefined,
      diffError: undefined,
      blameLines: [],
      blameHasMore: false,
      blamePath: undefined,
      blameCommitOid: undefined,
    }),
  setNewBranchName: (name) => set({ newBranchName: name }),
  setCommitDraft: (projectId, message) =>
    set((s) => ({ commitDrafts: { ...s.commitDrafts, [projectId]: message } })),
  clearOperationError: (projectId) =>
    set((s) => {
      const next = { ...s.operationByRepo };
      delete next[projectId];
      return { operationByRepo: next };
    }),

  retryOperation: async (projectId) => {
    const retry = get().operationByRepo[projectId]?.retry;
    if (!retry) return;
    get().clearOperationError(projectId);
    await retry();
  },

  setOperationDrawerOpen: (open) => set({ operationDrawerOpen: open }),

  // Reopening starts clean; a previous attempt's failure must not greet the next one.
  setCloneDialogOpen: (open) => set({ cloneDialogOpen: open, cloneError: undefined }),
  setInitDialogOpen: (open) => set({ initDialogOpen: open, initError: undefined }),
  setGitHubPublishRepoId: (projectId) => set({ githubPublishRepoId: projectId }),

  setHistoryFilters: (projectId, filters) => {
    set({ historyFilters: filters });
    get()
      .loadHistory(projectId)
      .catch(() => undefined);
  },

  setCommitAmend: (projectId, amend) =>
    set((s) => {
      const current = s.commitOptionsByRepo[projectId] ?? {
        amend: false,
        signOff: s.settings?.commit.defaultSignOff ?? false,
      };
      return {
        commitOptionsByRepo: {
          ...s.commitOptionsByRepo,
          [projectId]: { ...current, amend },
        },
      };
    }),

  setCommitSignOff: (projectId, signOff) =>
    set((s) => {
      const current = s.commitOptionsByRepo[projectId] ?? {
        amend: false,
        signOff: s.settings?.commit.defaultSignOff ?? false,
      };
      return {
        commitOptionsByRepo: {
          ...s.commitOptionsByRepo,
          [projectId]: { ...current, signOff },
        },
      };
    }),

  loadOperations: async () => {
    // `operationsLoading` exists so the drawer can tell "still asking" from "asked,
    // and there is nothing" — it used to show its "No recent operations" empty state
    // during the very first load, which is a false negative.
    set({ operationsLoading: true });
    try {
      const result = await api().operations.list();
      set({ operations: result.operations, operationsLoading: false, operationsError: undefined });
    } catch (err) {
      // The last known list stays on screen (degraded, not blanked); the error rides
      // above it with a Retry.
      set({ operationsLoading: false, operationsError: toError(err, 'operations.list') });
    }
  },

  cancelOperation: async (operationId) => {
    try {
      await api().operations.cancel({ operationId });
    } catch {
      // cancel is best-effort; refresh the list regardless so state stays truthful
    }
    await get().loadOperations();
  },

  loadRecoveryState: async (projectId) => {
    try {
      const state = await api().git.getOperationState({ projectId });
      set((s) => ({
        recoveryStateByRepo: { ...s.recoveryStateByRepo, [projectId]: state },
      }));
    } catch {
      // banner hides when state unavailable
    }
  },

  runRecoveryAction: async (projectId, revision, action) => {
    const state = get().recoveryStateByRepo[projectId];
    const kind = state?.activeKind;
    const request = { projectId, snapshotRevision: revision };
    const run = async () => {
      if (kind === 'merge') {
        if (action === 'continue') return api().git.mergeContinue(request);
        if (action === 'abort') return api().git.mergeAbort(request);
      }
      if (kind === 'rebase') {
        if (action === 'continue') return api().git.rebaseContinue(request);
        if (action === 'skip') return api().git.rebaseSkip(request);
        if (action === 'abort') return api().git.rebaseAbort(request);
      }
      if (kind === 'cherryPick') {
        if (action === 'continue') return api().git.cherryPickContinue(request);
        if (action === 'skip') return api().git.cherryPickSkip(request);
        if (action === 'abort') return api().git.cherryPickAbort(request);
      }
      if (kind === 'revert') {
        if (action === 'continue') return api().git.revertContinue(request);
        if (action === 'skip') return api().git.revertSkip(request);
        if (action === 'abort') return api().git.revertAbort(request);
      }
      return { ok: false as const, error: toError('Unsupported recovery action', 'recovery') };
    };
    const finish = async () => {
      await get().runRepoOperation(projectId, `Recovery ${action}`, run);
      await get().refreshRepo(projectId);
      await get().loadRecoveryState(projectId);
    };
    // `continue` is constructive; `abort` throws away the whole in-progress
    // operation and `skip` throws away the current commit's changes. Neither is
    // recoverable, and both were previously one unguarded click.
    if (action === 'continue') {
      await finish();
      return;
    }
    const label = kind === 'rebase' ? 'rebase' : kind === 'cherryPick' ? 'cherry-pick' : kind ?? 'operation';
    await get().gateConfirm(
      action === 'abort' ? 'abortOperation' : 'skipCommit',
      action === 'abort'
        ? {
            title: `Abort ${label}?`,
            description: `This discards the in-progress ${label} and any conflict resolution you have done for it. It cannot be undone.`,
            confirmLabel: 'Abort',
          }
        : {
            title: 'Skip this commit?',
            description: `This drops the current commit's changes from the ${label} and moves on. It cannot be undone.`,
            confirmLabel: 'Skip commit',
          },
      finish
    );
  },

  gateConfirm: async (settingKey, descriptor, run) => {
    if (!(get().settings?.confirmations[settingKey] ?? true)) {
      await run();
      return;
    }
    set({ pendingConfirm: { ...descriptor, run } });
  },

  cancelGitConfirm: () => set({ pendingConfirm: undefined }),

  acceptGitConfirm: async () => {
    const pending = get().pendingConfirm;
    if (!pending) return;
    set({ pendingConfirm: undefined });
    await pending.run();
  },

  resolveConflict: async (projectId, revision, path, resolution) => {
    // Gated here rather than in ConflictResolveBar: `git checkout --ours/--theirs`
    // overwrites any hand-merged working-tree content, and the context menu calls
    // this action directly — so a component-level gate is silently skippable.
    const label =
      resolution === 'ours' ? 'Use ours' : resolution === 'theirs' ? 'Use theirs' : 'Mark resolved';
    await get().gateConfirm(
      'conflictOverwrite',
      {
        title: 'Overwrite conflict resolution?',
        description: `Apply “${label}” for ${path}? This replaces the working-tree resolution for this file.`,
        confirmLabel: label,
      },
      async () => {
        await get().runRepoOperation(projectId, 'Resolve conflict', () =>
          api().git.resolveConflict({ projectId, snapshotRevision: revision, path, resolution })
        );
        await get().loadRecoveryState(projectId);
      }
    );
  },

  loadConflictVersion: async (projectId, path, stage) => {
    try {
      const result = await api().git.getConflictVersion({ projectId, path, stage });
      if (result.ok) {
        set({ conflictPreview: { path, stage, content: result.content, binary: result.binary } });
      } else {
        set({ conflictPreview: undefined });
      }
      return result;
    } catch (err) {
      const error = toError(err, 'getConflictVersion');
      set({ conflictPreview: undefined });
      return { ok: false as const, error };
    }
  },

  clearConflictPreview: () => set({ conflictPreview: undefined }),

  bisectReset: async (projectId, revision) => {
    await get().runRepoOperation(projectId, 'Reset bisect', () =>
      api().git.bisectReset({ projectId, snapshotRevision: revision })
    );
    await get().refreshRepo(projectId);
    await get().loadRecoveryState(projectId);
  },

  compareCommits: async (projectId, baseOid, targetOid) => {
    try {
      const result = await api().git.compareCommits({ projectId, baseOid, targetOid });
      set({
        compareResult: result,
        compareDialogOpen: true,
        compareBaseOid: baseOid,
        compareTargetOid: targetOid,
      });
      return result;
    } catch (err) {
      const error = toError(err, 'compareCommits');
      const result = { ok: false as const, error };
      set({ compareResult: result, compareDialogOpen: true, compareBaseOid: baseOid, compareTargetOid: targetOid });
      return result;
    }
  },

  setCompareDialogOpen: (open) =>
    set({
      compareDialogOpen: open,
      ...(open
        ? {}
        : {
            compareResult: undefined,
            compareBaseOid: undefined,
            compareTargetOid: undefined,
          }),
    }),

  setCompareBaseOid: (oid) => set({ compareBaseOid: oid }),

  refreshRepo: async (projectId) => {
    set((s) => ({
      repos: { ...s.repos, [projectId]: { ...s.repos[projectId], refreshing: true } },
    }));
    try {
      const snapshot = await api().git.refresh({ projectId });
      set((s) => ({
        repos: {
          ...s.repos,
          [projectId]: { ...s.repos[projectId], snapshot, error: undefined, refreshing: false },
        },
      }));
    } catch (err) {
      set((s) => ({
        repos: {
          ...s.repos,
          [projectId]: { ...s.repos[projectId], error: toError(err, 'refresh'), refreshing: false },
        },
      }));
    }
  },

  runRepoOperation: async (projectId, name, fn, options) => {
    // Only recorded for opt-in callers: re-running `fn` skips whatever confirmation
    // gated the action in the first place. See the type declaration above.
    const retry = options?.retryable
      ? () => get().runRepoOperation(projectId, name, fn, options)
      : undefined;
    set((s) => ({ operationByRepo: { ...s.operationByRepo, [projectId]: { name } } }));
    try {
      const result = await fn();
      if (result.ok) {
        set((s) => {
          const nextOps = { ...s.operationByRepo };
          delete nextOps[projectId];
          return {
            repos: {
              ...s.repos,
              [projectId]: { ...s.repos[projectId], snapshot: result.snapshot, error: undefined },
            },
            operationByRepo: nextOps,
            announcements: [...s.announcements, `${name} completed`],
          };
        });
      } else {
        set((s) => ({
          operationByRepo: {
            ...s.operationByRepo,
            [projectId]: { name, error: result.error, retry },
          },
        }));
      }
    } catch (err) {
      set((s) => ({
        operationByRepo: {
          ...s.operationByRepo,
          [projectId]: { name, error: toError(err, name), retry },
        },
      }));
    }
  },

  stageFile: (projectId, revision, path) =>
    get().runRepoOperation(projectId, 'Stage', () =>
      api().git.stageFile({ projectId, snapshotRevision: revision, path })
    ),
  unstageFile: (projectId, revision, path) =>
    get().runRepoOperation(projectId, 'Unstage', () =>
      api().git.unstageFile({ projectId, snapshotRevision: revision, path })
    ),
  stageAll: (projectId, revision) =>
    get().runRepoOperation(projectId, 'Stage all', () =>
      api().git.stageAll({ projectId, snapshotRevision: revision })
    ),
  unstageAll: (projectId, revision) =>
    get().runRepoOperation(projectId, 'Unstage all', () =>
      api().git.unstageAll({ projectId, snapshotRevision: revision })
    ),
  discardFile: (projectId, revision, path) =>
    get().runRepoOperation(projectId, 'Discard', () =>
      api().git.discardFile({ projectId, snapshotRevision: revision, path })
    ),
  discardAll: (projectId, revision) =>
    get().runRepoOperation(projectId, 'Discard all', async () => {
      const result = await api().git.discardAll({ projectId, snapshotRevision: revision });
      if (result.ok) {
        const selected = get().selectedFile;
        if (
          selected?.projectId === projectId &&
          (selected.area === 'unstaged' || selected.area === 'staged')
        ) {
          const stillPresent = result.snapshot.changedFiles.some((f) => f.path === selected.path);
          if (!stillPresent) {
            set({ selectedFile: undefined, diffText: undefined, diffError: undefined });
          }
        }
      }
      return result;
    }),
  commit: (projectId, revision, message, options) => {
    const settings = get().settings;
    const signing = options?.signing ?? settings?.commit.signingPreference ?? 'off';
    return get().runRepoOperation(projectId, 'Commit', async () => {
      const result = await api().git.commit({
        projectId,
        snapshotRevision: revision,
        message,
        amend: options?.amend,
        signOff: options?.signOff,
        signing,
      });
      if (result.ok) {
        const closesActiveDiff = get().selectedFile?.projectId === projectId;
        if (closesActiveDiff) {
          // Prevent an in-flight diff from repopulating the pane after a successful commit.
          diffLoadRequest.nextGeneration();
        }
        set((s) => ({
          commitDrafts: { ...s.commitDrafts, [projectId]: '' },
          commitOptionsByRepo: {
            ...s.commitOptionsByRepo,
            [projectId]: { amend: false, signOff: settings?.commit.defaultSignOff ?? false },
          },
          ...(s.selectedFile?.projectId === projectId
            ? {
                selectedFile: undefined,
                diffText: undefined,
                diffError: undefined,
                diffLoading: false,
                blameLines: [],
                blameLoading: false,
                blameHasMore: false,
                blamePath: undefined,
                blameCommitOid: undefined,
              }
            : {}),
        }));
      }
      return result;
    });
  },
  applyHunk: (projectId, revision, path, area, patch, action) =>
    get().runRepoOperation(
      projectId,
      action === 'discard' ? 'Discard hunk' : action === 'stage' ? 'Stage hunk' : 'Unstage hunk',
      async () => {
        const result = await api().git.applyHunk({
          projectId,
          snapshotRevision: revision,
          path,
          area,
          patch,
          action,
        });
        if (result.ok) {
          const selected = get().selectedFile;
          if (
            selected?.projectId === projectId &&
            selected.path === path &&
            (selected.area === 'staged' || selected.area === 'unstaged')
          ) {
            const stillPresent = result.snapshot.changedFiles.some((f) => f.path === path);
            if (stillPresent) {
              await get().loadDiff(projectId, path, area);
            } else {
              set({ selectedFile: undefined, diffText: undefined, diffError: undefined });
            }
          }
        }
        return result;
      }
    ),
  // The three ops that fail for reasons a second attempt can actually fix — a
  // dropped network, an expired credential, a busy remote — and that no
  // confirmation gates, because none of them can destroy work. Retry is theirs.
  fetch: (projectId, revision) =>
    get().runRepoOperation(
      projectId,
      'Fetch',
      () => api().git.fetch({ projectId, snapshotRevision: revision }),
      { retryable: true }
    ),
  pull: (projectId, revision) =>
    get().runRepoOperation(
      projectId,
      'Pull',
      () => api().git.pullFastForward({ projectId, snapshotRevision: revision }),
      { retryable: true }
    ),
  push: (projectId, revision) =>
    get().runRepoOperation(
      projectId,
      'Push',
      () => api().git.push({ projectId, snapshotRevision: revision }),
      { retryable: true }
    ),
  switchBranch: (projectId, revision, branchName) =>
    get().runRepoOperation(projectId, 'Switch branch', () =>
      api().git.switchBranch({ projectId, snapshotRevision: revision, branchName })
    ),
  createBranch: (projectId, revision, branchName) =>
    get().runRepoOperation(projectId, 'Create branch', () =>
      api().git.createBranch({ projectId, snapshotRevision: revision, branchName })
    ),
  deleteBranch: (projectId, revision, branchName) =>
    get().runRepoOperation(projectId, 'Delete branch', async () => {
      const result = await api().git.deleteBranch({
        projectId,
        snapshotRevision: revision,
        branchName,
      });
      if (result.ok) await get().loadBranches(projectId);
      return result;
    }),
  publishBranch: (projectId, revision, branchName, remoteName, remoteUrl) =>
    get().runRepoOperation(projectId, 'Publish branch', async () => {
      const result = await api().git.publishBranch({
        projectId,
        snapshotRevision: revision,
        branchName,
        remoteName,
        remoteUrl,
      });
      if (result.ok) await get().loadBranches(projectId);
      return result;
    }),
  renameBranch: (projectId, revision, newName) =>
    get().runRepoOperation(projectId, 'Rename branch', async () => {
      const result = await api().git.renameBranch({ projectId, snapshotRevision: revision, newName });
      if (result.ok) await get().loadBranches(projectId);
      return result;
    }),
  checkoutTracking: (projectId, revision, remoteRef, localName) =>
    get().runRepoOperation(projectId, 'Checkout branch', async () => {
      const result = await api().git.checkoutTracking({
        projectId,
        snapshotRevision: revision,
        remoteRef,
        localName,
      });
      if (result.ok) await get().loadBranches(projectId);
      return result;
    }),
  setUpstream: (projectId, revision, upstreamRef) =>
    get().runRepoOperation(projectId, 'Set upstream', async () => {
      const result = await api().git.setUpstream({
        projectId,
        snapshotRevision: revision,
        upstreamRef,
      });
      if (result.ok) await get().loadBranches(projectId);
      return result;
    }),
  deleteRemoteBranch: (projectId, revision, remoteName, branchName) =>
    get().runRepoOperation(projectId, 'Delete remote branch', async () => {
      const result = await api().git.deleteRemoteBranch({
        projectId,
        snapshotRevision: revision,
        remoteName,
        branchName,
      });
      if (result.ok) await get().loadBranches(projectId);
      return result;
    }),
  mergeBranch: async (projectId, revision, branchName) => {
    // A conflicting merge is *not* an error: main returns the refreshed, blocked
    // snapshot, so refresh recovery state too or the banner never appears.
    const finish = async () => {
      await get().runRepoOperation(projectId, 'Merge branch', () =>
        api().git.mergeBranch({ projectId, snapshotRevision: revision, branchName })
      );
      await get().refreshRepo(projectId);
      await get().loadRecoveryState(projectId);
      await get().loadBranches(projectId);
    };
    // Gated because Bureau has no reset/undo yet: once a merge commit lands there
    // is no in-app way back, and the action sits one click deep in a branch row.
    await get().gateConfirm(
      'mergeBranch',
      {
        title: 'Merge branch?',
        description: `Merge “${branchName}” into the current branch. If the merge conflicts, the repository is left mid-merge for you to resolve.`,
        confirmLabel: 'Merge',
      },
      finish
    );
  },
  rebaseBranch: async (projectId, revision, ontoRef) => {
    const finish = async () => {
      await get().runRepoOperation(projectId, 'Rebase branch', () =>
        api().git.rebaseBranch({ projectId, snapshotRevision: revision, ontoRef })
      );
      await get().refreshRepo(projectId);
      await get().loadRecoveryState(projectId);
      await get().loadBranches(projectId);
    };
    await get().gateConfirm(
      'rebaseBranch',
      {
        title: 'Rebase branch?',
        description: `Replay the current branch onto “${ontoRef}”. This rewrites the current branch's history, so commits already pushed will diverge from the remote.`,
        confirmLabel: 'Rebase',
      },
      finish
    );
  },
  resetToCommit: async (projectId, revision, commitOid, mode) => {
    const finish = async () => {
      await get().runRepoOperation(projectId, 'Reset', () =>
        api().git.resetToCommit({ projectId, snapshotRevision: revision, commitOid, mode })
      );
      await get().refreshRepo(projectId);
      // The reset is itself a reflog entry, and it moves HEAD out from under the
      // history/branch lists — so every view of where HEAD is must be re-read.
      await get().loadHistory(projectId);
      await get().loadBranches(projectId);
      await get().loadReflog(projectId);
    };
    const short = commitOid.slice(0, 7);
    // Two keys, not one: --hard is the only mode that overwrites the working tree,
    // and the work it destroys was never committed, so no reflog entry can bring it
    // back. Sharing a key with soft/mixed would let "I reset softly all day, stop
    // asking" silently disarm the prompt that guards unrecoverable data.
    if (mode === 'hard') {
      await get().gateConfirm(
        'resetHard',
        {
          // Verified against real git: --hard restores tracked files and leaves
          // untracked ones in place. The copy says exactly that — overstating the
          // damage teaches users to distrust the prompt as much as understating it.
          title: 'Reset and discard your changes?',
          description: `Move the current branch to ${short} and restore every tracked file to match it. Your staged and unstaged changes are permanently lost — the reflog can restore commits, but not uncommitted work. Untracked files are left in place. Stash first if you may want them back.`,
          confirmLabel: 'Reset and discard',
        },
        finish
      );
      return;
    }
    await get().gateConfirm(
      'resetBranch',
      {
        title: mode === 'soft' ? 'Reset branch (soft)?' : 'Reset branch (mixed)?',
        description:
          mode === 'soft'
            ? `Move the current branch to ${short}, keeping every change staged. Your files are not touched, and the reflog records the current HEAD so you can move back.`
            : `Move the current branch to ${short} and unstage everything. Your files are not touched, and the reflog records the current HEAD so you can move back.`,
        confirmLabel: 'Reset',
      },
      finish
    );
  },
  // Both can conflict, which main reports as success with a *blocked* snapshot — so the
  // recovery state has to be reloaded here or the RecoveryBanner never appears, exactly
  // as for merge/rebase.
  cherryPick: async (projectId, revision, commitOid, mainline) => {
    await get().runRepoOperation(projectId, 'Cherry-pick', () =>
      api().git.cherryPick({ projectId, snapshotRevision: revision, commitOid, mainline })
    );
    await get().refreshRepo(projectId);
    await get().loadRecoveryState(projectId);
  },
  revertCommit: async (projectId, revision, commitOid, mainline) => {
    await get().runRepoOperation(projectId, 'Revert', () =>
      api().git.revertCommit({ projectId, snapshotRevision: revision, commitOid, mainline })
    );
    await get().refreshRepo(projectId);
    await get().loadRecoveryState(projectId);
    // A revert lands a new commit on the branch, so the history list is stale.
    await get().loadHistory(projectId);
  },
  checkoutCommit: async (projectId, revision, commitOid) => {
    const short = commitOid.slice(0, 7);
    const finish = async () => {
      await get().runRepoOperation(projectId, 'Checkout commit', () =>
        api().git.checkoutCommit({ projectId, snapshotRevision: revision, commitOid })
      );
      await get().refreshRepo(projectId);
      // HEAD moved off the branch: every view of where HEAD is must be re-read.
      await get().loadHistory(projectId);
      await get().loadBranches(projectId);
      await get().loadReflog(projectId);
    };
    // Nothing is destroyed — git refuses to detach over uncommitted changes — but
    // "you are on no branch" is a state users reach by accident and cannot reason their
    // way out of, so the prompt explains the way back rather than warning about loss.
    await get().gateConfirm(
      'checkoutCommit',
      {
        title: 'Check out this commit?',
        description: `This moves you to ${short} without being on a branch — Git calls that a “detached HEAD”. You can look around and build, but new commits belong to no branch and are easy to lose. To get back, check out a branch; to keep work you do here, create a branch from it first.`,
        confirmLabel: 'Check out commit',
      },
      finish
    );
  },
  createBranchFromCommit: (projectId, revision, branchName, commitOid) =>
    get().runRepoOperation(projectId, 'Create branch', async () => {
      const result = await api().git.createBranchFromCommit({
        projectId,
        snapshotRevision: revision,
        branchName,
        commitOid,
      });
      if (result.ok) await get().loadBranches(projectId);
      return result;
    }),
  createTag: (projectId, revision, name, targetOid, message) =>
    get().runRepoOperation(projectId, 'Create tag', () =>
      api().git.createTag({
        projectId,
        snapshotRevision: revision,
        name,
        targetOid,
        message,
        annotated: Boolean(message),
      })
    ),
  stashPush: (projectId, revision, message, includeUntracked) =>
    get().runRepoOperation(projectId, 'Stash', async () => {
      const result = await api().git.stashPush({
        projectId,
        snapshotRevision: revision,
        message,
        includeUntracked,
      });
      if (result.ok) await get().loadStash(projectId);
      return result;
    }),
  stashPop: (projectId, revision, index) =>
    get().gateConfirm(
      'stashPop',
      {
        title: 'Pop stash?',
        description: `Apply stash@{${index}} to the working tree and drop it. This can conflict with your current changes.`,
        confirmLabel: 'Pop stash',
      },
      async () => {
        await get().runRepoOperation(projectId, 'Stash pop', async () => {
          const result = await api().git.stashPop({ projectId, snapshotRevision: revision, index });
          if (result.ok) await get().loadStash(projectId);
          return result;
        });
      }
    ),
  stashDrop: (projectId, revision, index) =>
    get().runRepoOperation(projectId, 'Stash drop', async () => {
      const result = await api().git.stashDrop({ projectId, snapshotRevision: revision, index });
      if (result.ok) {
        set((s) => ({
          selectedStashIndex: s.selectedStashIndex === index ? undefined : s.selectedStashIndex,
          stashFiles: s.selectedStashIndex === index ? [] : s.stashFiles,
        }));
        await get().loadStash(projectId);
      }
      return result;
    }),
  selectStash: async (projectId, index) => {
    set({
      selectedStashIndex: index,
      stashFiles: [],
      selectedFile: undefined,
      diffText: undefined,
      diffError: undefined,
    });
    await get().loadStashFiles(projectId, index);
  },
  loadStashFiles: async (projectId, index) => {
    const generation = stashFilesLoadRequest.nextGeneration();
    try {
      const stashFiles = await api().git.listStashFiles({ projectId, index });
      if (!stashFilesLoadRequest.isCurrent(generation)) return;
      set({ stashFiles, selectedStashIndex: index });
      const first = stashFiles[0];
      if (first) {
        await get().loadStashDiff(projectId, index, first.path);
      }
    } catch {
      if (!stashFilesLoadRequest.isCurrent(generation)) return;
      set({ stashFiles: [] });
    }
  },
  loadStashDiff: async (projectId, index, path) => {
    // Shares diffText/diffLoading with loadDiff, so it must share loadDiff's
    // generation counter too: otherwise a slow stash diff lands on top of a
    // newer regular diff, and commit()'s deliberate nextGeneration() (which
    // exists to stop an in-flight diff repopulating the pane) can't cancel it.
    const generation = diffLoadRequest.nextGeneration();
    set({
      diffLoading: true,
      diffError: undefined,
      selectedFile: { projectId, path, area: 'stash', stashIndex: index },
    });
    try {
      const result = await api().git.getStashDiff({ projectId, index, path });
      if (!diffLoadRequest.isCurrent(generation)) return;
      // A failure is `diffError`, never `diffText`: writing the message into the diff
      // body made DiffPanel parse and render error prose as if it were the file's diff.
      set(
        result.ok
          ? { diffLoading: false, diffText: result.diff || '(no changes)', diffError: undefined }
          : { diffLoading: false, diffText: undefined, diffError: result.error }
      );
    } catch (err) {
      if (!diffLoadRequest.isCurrent(generation)) return;
      set({ diffLoading: false, diffText: undefined, diffError: toError(err, 'getStashDiff') });
    }
  },
  stashApply: (projectId, revision, index) =>
    get().runRepoOperation(projectId, 'Stash apply', () =>
      api().git.stashApply({ projectId, snapshotRevision: revision, index })
    ),
  stashBranch: (projectId, revision, index, branchName) =>
    get().runRepoOperation(projectId, 'Create branch from stash', async () => {
      const result = await api().git.stashBranch({
        projectId,
        snapshotRevision: revision,
        index,
        branchName,
      });
      if (result.ok) await get().loadBranches(projectId);
      return result;
    }),
  stashRestoreFiles: (projectId, revision, index, paths) =>
    get().gateConfirm(
      'restoreStashFiles',
      {
        title: paths.length === 1 ? 'Restore file from stash?' : `Restore ${paths.length} files from stash?`,
        description: `This overwrites ${
          paths.length === 1 ? paths[0] : `${paths.length} files`
        } in the working tree with the version from stash@{${index}}. Uncommitted edits to ${
          paths.length === 1 ? 'it' : 'them'
        } are lost.`,
        confirmLabel: 'Restore',
      },
      async () => {
        await get().runRepoOperation(projectId, 'Restore stash files', async () => {
          const result = await api().git.stashRestoreFiles({
            projectId,
            snapshotRevision: revision,
            index,
            paths,
          });
          if (result.ok) {
            await get().refreshRepo(projectId);
            await get().loadStashFiles(projectId, index);
          }
          return result;
        });
      }
    ),

  loadDiff: async (projectId, path, area, commitOid) => {
    const generation = diffLoadRequest.nextGeneration();
    set({
      diffLoading: true,
      diffError: undefined,
      selectedFile: { projectId, path, area, commitOid },
    });
    try {
      const result = await api().git.getDiff({
        projectId,
        path,
        area: area as DiffArea,
        commitOid,
      });
      // Drop a stale response so switching file/repo mid-flight can't clobber the newer diff.
      if (!diffLoadRequest.isCurrent(generation)) return;
      set(
        result.ok
          ? { diffLoading: false, diffText: result.diff || '(no changes)', diffError: undefined }
          : { diffLoading: false, diffText: undefined, diffError: result.error }
      );
    } catch (err) {
      if (!diffLoadRequest.isCurrent(generation)) return;
      set({ diffLoading: false, diffText: undefined, diffError: toError(err, 'getDiff') });
    }
  },

  // Every list loader below records its failure rather than swallowing it. A
  // swallowed load left the panel showing its Empty state ("No branches"), which
  // states as fact the very thing the failure means we could not find out.
  loadBranches: async (projectId) => {
    const generation = branchLoadRequest.nextGeneration();
    set({ branchesLoading: true });
    try {
      const branchDetails = await api().git.listBranchDetails({ projectId });
      if (!branchLoadRequest.isCurrent(generation)) return;
      const branches = branchDetails.filter((b) => b.kind === 'local').map((b) => b.shortName);
      set({ branchDetails, branches, branchesLoading: false, branchesError: undefined });
    } catch (err) {
      if (branchLoadRequest.isCurrent(generation)) {
        set({ branchesLoading: false, branchesError: toError(err, 'listBranchDetails') });
      }
    }
  },

  loadStash: async (projectId) => {
    const generation = stashLoadRequest.nextGeneration();
    set({ stashLoading: true });
    try {
      const stashEntries = await api().git.stashList({ projectId });
      if (!stashLoadRequest.isCurrent(generation)) return;
      set({ stashEntries, stashLoading: false, stashError: undefined });
    } catch (err) {
      if (!stashLoadRequest.isCurrent(generation)) return;
      set({ stashLoading: false, stashError: toError(err, 'stashList') });
    }
  },

  loadRemotes: async (projectId) => {
    const generation = remotesLoadRequest.nextGeneration();
    set({ remotesLoading: true });
    try {
      const remotes = await api().git.listRemotes({ projectId });
      if (!remotesLoadRequest.isCurrent(generation)) return;
      set({ remotes, remotesLoading: false, remotesError: undefined });
    } catch (err) {
      if (!remotesLoadRequest.isCurrent(generation)) return;
      set({ remotesLoading: false, remotesError: toError(err, 'listRemotes') });
    }
  },

  addRemote: (projectId, revision, name, url) =>
    get().runRepoOperation(projectId, 'Add remote', async () => {
      const result = await api().git.addRemote({
        projectId,
        snapshotRevision: revision,
        name,
        url,
      });
      if (result.ok) await get().loadRemotes(projectId);
      return result;
    }),

  renameRemote: (projectId, revision, name, newName) =>
    get().runRepoOperation(projectId, 'Rename remote', async () => {
      const result = await api().git.renameRemote({
        projectId,
        snapshotRevision: revision,
        name,
        newName,
      });
      if (result.ok) {
        await get().loadRemotes(projectId);
        // Renaming rewrites every `<old>/<branch>` remote-tracking ref and any
        // upstream that pointed at them, so the branch list is stale too.
        await get().loadBranches(projectId);
      }
      return result;
    }),

  removeRemote: async (projectId, revision, name) => {
    const finish = async () => {
      await get().runRepoOperation(projectId, 'Remove remote', async () => {
        const result = await api().git.removeRemote({
          projectId,
          snapshotRevision: revision,
          name,
        });
        if (result.ok) {
          await get().loadRemotes(projectId);
          await get().loadBranches(projectId);
        }
        return result;
      });
    };
    // Gated, but deliberately not worded as data loss: the commits are untouched and
    // the remote can be added back. What actually goes is the URL and the tracking refs.
    await get().gateConfirm(
      'removeRemote',
      {
        title: `Remove remote “${name}”?`,
        description: `This deletes the “${name}” remote and its remote-tracking branches from this repository. Your commits are not affected, and nothing is deleted on the server — you can add the remote back with its URL.`,
        confirmLabel: 'Remove remote',
      },
      finish
    );
  },

  setRemoteUrl: (projectId, revision, name, url) =>
    get().runRepoOperation(projectId, 'Set remote URL', async () => {
      const result = await api().git.setRemoteUrl({
        projectId,
        snapshotRevision: revision,
        name,
        url,
      });
      if (result.ok) await get().loadRemotes(projectId);
      return result;
    }),

  loadWorktrees: async (projectId) => {
    const generation = worktreesLoadRequest.nextGeneration();
    set({ worktreesLoading: true });
    try {
      const worktrees = await api().git.listWorktrees({ projectId });
      if (!worktreesLoadRequest.isCurrent(generation)) return;
      set({ worktrees, worktreesLoading: false, worktreesError: undefined });
    } catch (err) {
      if (!worktreesLoadRequest.isCurrent(generation)) return;
      set({ worktreesLoading: false, worktreesError: toError(err, 'listWorktrees') });
    }
  },

  addWorktree: (projectId, revision, path, options) =>
    get().runRepoOperation(projectId, 'Add worktree', async () => {
      const result = await api().git.addWorktree({
        projectId,
        snapshotRevision: revision,
        path,
        branch: options?.branch,
        newBranch: options?.newBranch,
      });
      if (result.ok) await get().loadWorktrees(projectId);
      return result;
    }),

  removeWorktree: (projectId, revision, path) =>
    get().runRepoOperation(projectId, 'Remove worktree', async () => {
      const result = await api().git.removeWorktree({
        projectId,
        snapshotRevision: revision,
        path,
      });
      if (result.ok) await get().loadWorktrees(projectId);
      return result;
    }),

  lockWorktree: (projectId, revision, path, reason) =>
    get().runRepoOperation(projectId, 'Lock worktree', async () => {
      const result = await api().git.lockWorktree({
        projectId,
        snapshotRevision: revision,
        path,
        reason,
      });
      if (result.ok) await get().loadWorktrees(projectId);
      return result;
    }),

  unlockWorktree: (projectId, revision, path) =>
    get().runRepoOperation(projectId, 'Unlock worktree', async () => {
      const result = await api().git.unlockWorktree({
        projectId,
        snapshotRevision: revision,
        path,
      });
      if (result.ok) await get().loadWorktrees(projectId);
      return result;
    }),

  pruneWorktrees: (projectId, revision) =>
    get().gateConfirm(
      'pruneWorktrees',
      {
        title: 'Prune worktrees?',
        description:
          'This removes the administrative entries for worktrees whose directories are gone. Worktrees still on disk are untouched.',
        confirmLabel: 'Prune',
      },
      async () => {
        await get().runRepoOperation(projectId, 'Prune worktrees', async () => {
          const result = await api().git.pruneWorktrees({ projectId, snapshotRevision: revision });
          if (result.ok) await get().loadWorktrees(projectId);
          return result;
        });
      }
    ),

  loadHistory: async (projectId) => {
    const generation = historyLoadRequest.nextGeneration();
    set({ historyLoading: true });
    try {
      const limit = get().settings?.history.commitLimit ?? 30;
      const filters = get().historyFilters;
      const result = await api().git.listHistory({ projectId, limit, filters });
      if (!historyLoadRequest.isCurrent(generation)) return;
      set({
        historyCommits: result.items,
        historyHasMore: result.hasMore,
        historyNextCursor: result.nextCursor,
        historyLoading: false,
        historyError: undefined,
      });
    } catch (err) {
      if (historyLoadRequest.isCurrent(generation)) {
        set({ historyLoading: false, historyError: toError(err, 'listHistory') });
      }
    }
  },

  loadMoreHistory: async (projectId) => {
    const cursor = get().historyNextCursor;
    if (!cursor || !get().historyHasMore) return;
    const generation = historyLoadRequest.nextGeneration();
    set({ historyLoading: true });
    try {
      const limit = get().settings?.history.commitLimit ?? 30;
      const filters = get().historyFilters;
      const result = await api().git.listHistory({ projectId, limit, cursor, filters });
      if (!historyLoadRequest.isCurrent(generation)) return;
      set((s) => {
        const historyCommits = [...s.historyCommits, ...result.items];
        return {
          historyCommits,
          historyHasMore: result.hasMore,
          historyNextCursor: result.nextCursor,
          historyLoading: false,
          historyError: undefined,
        };
      });
    } catch (err) {
      if (historyLoadRequest.isCurrent(generation)) {
        set({ historyLoading: false, historyError: toError(err, 'listHistory') });
      }
    }
  },

  loadReflog: async (projectId, append = false) => {
    // GitWorkbench re-fires this from an effect keyed on projectId, so without the
    // generation guard a slow response for project A can land in project B's panel.
    const generation = reflogLoadRequest.nextGeneration();
    set({ reflogLoading: true });
    try {
      const cursor = append ? get().reflogNextCursor : undefined;
      const result = await api().git.listReflog({ projectId, cursor, limit: 50 });
      if (!reflogLoadRequest.isCurrent(generation)) return;
      set((s) => ({
        reflog: append ? [...s.reflog, ...result.items] : result.items,
        reflogHasMore: result.hasMore,
        reflogNextCursor: result.nextCursor,
        reflogLoading: false,
        reflogError: undefined,
      }));
    } catch (err) {
      if (reflogLoadRequest.isCurrent(generation)) {
        set({ reflogLoading: false, reflogError: toError(err, 'listReflog') });
      }
    }
  },

  selectCommit: async (projectId, commitOid) => {
    const generation = commitFilesLoadRequest.nextGeneration();
    set({
      selectedCommitOid: commitOid,
      commitFilesLoading: true,
      commitFiles: [],
      commitFilesError: undefined,
      selectedFile: undefined,
      diffText: undefined,
      diffError: undefined,
    });
    try {
      const result = await api().git.listCommitFiles({ projectId, commitOid });
      // Drop a stale response so selecting another commit mid-flight isn't overwritten.
      if (!commitFilesLoadRequest.isCurrent(generation)) return;
      if (!result.ok) {
        set({
          commitFilesLoading: false,
          commitFiles: [],
          commitFilesError: result.error.message,
        });
        return;
      }
      set({
        commitFiles: result.files,
        commitFilesLoading: false,
        commitFilesError: undefined,
      });
      const first = result.files[0];
      if (first) {
        await get().loadDiff(projectId, first.path, 'commit', commitOid);
      }
    } catch (err) {
      if (!commitFilesLoadRequest.isCurrent(generation)) return;
      const error = toError(err, 'listCommitFiles');
      set({
        commitFilesLoading: false,
        commitFilesError: error.message,
      });
    }
  },

  clearCommitSelection: () =>
    set({
      selectedCommitOid: undefined,
      commitFiles: [],
      commitFilesLoading: false,
      commitFilesError: undefined,
      selectedFile: undefined,
      diffText: undefined,
      diffError: undefined,
    }),

  openInFileExplorer: async (projectId) => {
    try {
      const result = await api().system.openInExplorer({ projectId });
      if (!result.ok) toast('error', result.error.message);
    } catch (err) {
      toast('error', toError(err, 'system.openInExplorer').message);
    }
  },
  /** Opens Bureau's own Terminal tab; the external launcher is a separate action now. */
  openInTerminal: async (projectId) => {
    await useAppStore.getState().openInTerminal(projectId);
  },
  openInExternalTerminal: async (projectId) => {
    try {
      await api().system.openInTerminal({ projectId });
    } catch (err) {
      toast('error', toError(err, 'openInExternalTerminal').message);
    }
  },
  openInEditor: async (projectId) => {
    try {
      await api().system.openInEditor({ projectId });
    } catch (err) {
      toast('error', toError(err, 'openInEditor').message);
    }
  },
  chooseGitExecutable: async () => {
    try {
      const settings = await api().settings.chooseGitExecutable();
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      toast('error', toError(err, 'chooseGitExecutable').message);
    }
  },
  clearGitExecutable: async () => {
    try {
      const settings = await api().settings.clearGitExecutable();
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      toast('error', toError(err, 'clearGitExecutable').message);
    }
  },
  chooseCustomEditor: async () => {
    try {
      const settings = await api().settings.chooseCustomEditor();
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      toast('error', toError(err, 'chooseCustomEditor').message);
    }
  },
  setEditorPreset: async (preset) => {
    try {
      const settings = await api().settings.setEditorPreset({ preset });
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      toast('error', toError(err, 'setEditorPreset').message);
    }
  },
  chooseCustomTerminal: async () => {
    try {
      const settings = await api().settings.chooseCustomTerminal();
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      toast('error', toError(err, 'chooseCustomTerminal').message);
    }
  },
  setTerminalPreset: async (preset) => {
    try {
      const settings = await api().settings.setTerminalPreset({ preset });
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      toast('error', toError(err, 'setTerminalPreset').message);
    }
  },
  refreshCapabilities: async () => {
    try {
      const capabilities = await api().app.getCapabilities();
      set({ capabilities });
    } catch (err) {
      toast('error', toError(err, 'refreshCapabilities').message);
    }
  },
  updateSettings: async (patch) => {
    try {
      const settings = await api().settings.update(patch);
      applyAppearance(settings.appearance);
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      toast('error', toError(err, 'updateSettings').message);
    }
  },

  publishToGitHub: async (input) => {
    const name = 'Publish to GitHub';
    set((s) => ({
      operationByRepo: { ...s.operationByRepo, [input.projectId]: { name } },
    }));
    try {
      const result = await api().github.publish(input);
      if (result.ok) {
        set((s) => {
          const nextOperations = { ...s.operationByRepo };
          delete nextOperations[input.projectId];
          return {
            repos: {
              ...s.repos,
              [input.projectId]: {
                ...s.repos[input.projectId],
                snapshot: result.snapshot,
                error: undefined,
              },
            },
            operationByRepo: nextOperations,
            announcements: [...s.announcements, 'Repository published to GitHub'],
          };
        });
        toast(
          'success',
          result.created
            ? 'Repository created and branch published to GitHub'
            : 'Branch published to GitHub'
        );
      } else {
        set((s) => ({
          operationByRepo: {
            ...s.operationByRepo,
            [input.projectId]: { name, error: result.error },
          },
        }));
      }
      return result;
    } catch (err) {
      const error = toError(err, 'github.publish');
      set((s) => ({
        operationByRepo: {
          ...s.operationByRepo,
          [input.projectId]: { name, error },
        },
      }));
      return { ok: false, error };
    }
  },

  cloneRepository: async (input) => {
    // The dialog stays open and busy for the duration: clone is the longest
    // operation in the feature, and closing on submit left the user with no sign it
    // was running and — if it failed — nowhere to see why or to correct the URL.
    set({ cloneBusy: true, cloneError: undefined });
    try {
      const result = await api().git.clone(input);
      if (result.ok) {
        const projects = await api().projects.list();
        const project = projects.find((p) => p.projectId === result.projectId);
        const displayName =
          project?.name ?? result.path.split(/[/\\]/).filter(Boolean).pop() ?? result.projectId;
        ensureGitProject({
          projectId: result.projectId,
          path: result.path,
          name: displayName,
        });
        await useAppStore.getState().refreshProjects();
        set((s) => ({
          cloneBusy: false,
          cloneError: undefined,
          cloneDialogOpen: false,
          announcements: [...s.announcements, 'Repository cloned'],
        }));
        toast('success', 'Repository cloned');
        await get().refreshRepo(result.projectId);
        await useAppStore.getState().selectProject(result.projectId);
        useAppStore.getState().setProjectTab('git');
        return;
      }
      if ('cancelled' in result) {
        set({ cloneBusy: false, cloneError: undefined });
        return;
      }
      set({ cloneBusy: false, cloneError: result.error });
    } catch (err) {
      set({ cloneBusy: false, cloneError: toError(err, 'clone') });
    }
  },

  initRepository: async (input) => {
    set({ initBusy: true, initError: undefined });
    try {
      const result = await api().git.initRepository(input);
      if (result.ok) {
        const projects = await api().projects.list();
        const project = projects.find((p) => p.projectId === result.projectId);
        const displayName =
          project?.name ?? result.path.split(/[/\\]/).filter(Boolean).pop() ?? result.projectId;
        ensureGitProject({
          projectId: result.projectId,
          path: result.path,
          name: displayName,
        });
        await useAppStore.getState().refreshProjects();
        set((s) => ({
          initBusy: false,
          initError: undefined,
          initDialogOpen: false,
          announcements: [...s.announcements, 'Repository initialized'],
        }));
        toast('success', 'Repository initialized');
        await get().refreshRepo(result.projectId);
        await useAppStore.getState().selectProject(result.projectId);
        useAppStore.getState().setProjectTab('git');
        return;
      }
      if ('cancelled' in result) {
        set({ initBusy: false, initError: undefined });
        return;
      }
      set({ initBusy: false, initError: result.error });
    } catch (err) {
      set({ initBusy: false, initError: toError(err, 'initRepository') });
    }
  },

  loadSubmodules: async (projectId) => {
    const generation = submodulesLoadRequest.nextGeneration();
    set({ submodulesLoading: true });
    try {
      const submodules = await api().git.listSubmodules({ projectId });
      if (!submodulesLoadRequest.isCurrent(generation)) return;
      set({ submodules, submodulesLoading: false, submodulesError: undefined });
    } catch (err) {
      if (!submodulesLoadRequest.isCurrent(generation)) return;
      set({ submodulesLoading: false, submodulesError: toError(err, 'listSubmodules') });
    }
  },

  submoduleInit: (projectId, revision, path) =>
    get().runRepoOperation(projectId, 'Submodule init', async () => {
      const result = await api().git.submoduleInit({ projectId, snapshotRevision: revision, path });
      if (result.ok) await get().loadSubmodules(projectId);
      return result;
    }),

  submoduleUpdate: (projectId, revision, path) =>
    get().gateConfirm(
      'submoduleUpdate',
      {
        title: 'Update submodule?',
        description: `This checks out the recorded commit in ${path}. Uncommitted changes inside the submodule may be lost.`,
        confirmLabel: 'Update',
      },
      async () => {
        await get().runRepoOperation(projectId, 'Submodule update', async () => {
          const result = await api().git.submoduleUpdate({
            projectId,
            snapshotRevision: revision,
            path,
          });
          if (result.ok) await get().loadSubmodules(projectId);
          return result;
        });
      }
    ),

  loadTags: async (projectId, append = false) => {
    const generation = tagsLoadRequest.nextGeneration();
    set({ tagsLoading: true });
    try {
      const cursor = append ? get().tagsNextCursor : undefined;
      const result = await api().git.listTags({ projectId, cursor, limit: 50 });
      if (!tagsLoadRequest.isCurrent(generation)) return;
      set((s) => ({
        tags: append ? [...s.tags, ...result.items] : result.items,
        tagsHasMore: result.hasMore,
        tagsNextCursor: result.nextCursor,
        tagsLoading: false,
        tagsError: undefined,
      }));
    } catch (err) {
      if (!tagsLoadRequest.isCurrent(generation)) return;
      set({ tagsLoading: false, tagsError: toError(err, 'listTags') });
    }
  },

  deleteTag: (projectId, revision, name) =>
    get().runRepoOperation(projectId, 'Delete tag', async () => {
      const result = await api().git.deleteTag({ projectId, snapshotRevision: revision, name });
      if (result.ok) await get().loadTags(projectId);
      return result;
    }),

  pushTag: (projectId, revision, name) =>
    get().runRepoOperation(projectId, 'Push tag', async () => {
      const result = await api().git.pushTag({ projectId, snapshotRevision: revision, name });
      if (result.ok) await get().loadTags(projectId);
      return result;
    }),

  deleteRemoteTag: (projectId, revision, remoteName, name) =>
    get().runRepoOperation(projectId, 'Delete remote tag', async () => {
      const result = await api().git.deleteRemoteTag({
        projectId,
        snapshotRevision: revision,
        remoteName,
        name,
      });
      if (result.ok) await get().loadTags(projectId);
      return result;
    }),

  loadBlame: async (projectId, path, commitOid, append = false) => {
    const generation = blameLoadRequest.nextGeneration();
    set({
      blameLoading: true,
      ...(append
        ? {}
        : {
            blameLines: [],
            blamePath: path,
            blameCommitOid: commitOid,
          }),
    });
    try {
      const offset = append ? get().blameLines.length : 0;
      const result = await api().git.blame({ projectId, path, commitOid, offset, limit: 100 });
      if (!blameLoadRequest.isCurrent(generation)) return;
      set((s) => ({
        blameLines: append ? [...s.blameLines, ...result.items] : result.items,
        blameHasMore: result.hasMore,
        blamePath: path,
        blameCommitOid: commitOid,
        blameLoading: false,
      }));
    } catch (err) {
      if (!blameLoadRequest.isCurrent(generation)) return;
      set({ blameLoading: false });
      toast('error', toError(err, 'blame').message);
    }
  },

  clearBlame: () =>
    set({
      blameLines: [],
      blameHasMore: false,
      blamePath: undefined,
      blameCommitOid: undefined,
      blameLoading: false,
    }),
}));

/** Register a Bureau project into the git workbench catalogue (no separate repo hub). */
export function ensureGitProject(input: {
  projectId: string;
  path: string;
  name: string;
}): void {
  const { projectId, path, name } = input;
  useGitStore.setState((s) => {
    if (s.repos[projectId]) return s;
    return {
      repos: {
        ...s.repos,
        [projectId]: {
          catalogue: {
            projectId,
            canonicalPath: path,
            displayName: name,
            addedAt: new Date().toISOString(),
          },
          refreshing: false,
        },
      },
    };
  });
}
