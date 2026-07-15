/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from 'zustand';
import { useAppStore } from './appStore';
import { ensureRecentRepoId, recentRepoIds } from '@renderer/lib/repoList';
import { applyAppearance } from '@renderer/lib/appearance';
import { createLatestRequestWins } from '@renderer/lib/latestRequestWins';
import type { BureauError } from '@shared/contracts/errors';
import type { AppCapabilities } from '@shared/contracts/capabilities';
import type { EditorPreset, PublicSettings, SettingsPatch, TerminalPreset } from '@shared/contracts/settings';
import type { RepositorySnapshot, TrackedRepository } from '@shared/contracts/gitSnapshot';
import type {
  CommitFileChange, DiffArea, RecentCommit, StashEntry } from '@shared/contracts/operations';
import type { BranchDetail } from '@shared/contracts/branches';
import type {
  CompareCommitsResult,
  HistoryCommit,
  HistoryFilters,
} from '@shared/contracts/history';
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

export type RepoPanel =
  'changes' | 'branches' | 'stash' | 'history' | 'worktrees' | 'submodules' | 'tags';

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
  repos: Record<string, RepoState>;
  repoIds: string[];
  sidebarRecentRepoIds: string[];
  loading: boolean;
  globalError?: BureauError;
  commitDrafts: Record<string, string>;
  statusBanner?: { tone: 'info' | 'success' | 'error'; message: string };
  operationByRepo: Record<string, { name?: string; error?: BureauError }>;
  operationDrawerOpen: boolean;
  operations: OperationRecord[];
  recoveryStateByRepo: Record<string, OperationStateDetails | undefined>;
  announcements: string[];
  commandPaletteOpen: boolean;
  selectedFile?: SelectedDiffFile;
  selectedCommitOid?: string;
  commitFiles: CommitFileChange[];
  commitFilesLoading: boolean;
  commitFilesError?: string;
  repoPanel: RepoPanel;
  diffText?: string;
  diffLoading: boolean;
  branches: string[];
  branchDetails: BranchDetail[];
  branchesLoading: boolean;
  stashEntries: StashEntry[];
  stashLoading: boolean;
  selectedStashIndex?: number;
  stashFiles: StashFileEntry[];
  worktrees: import('@shared/contracts/advanced').WorktreeEntry[];
  worktreesLoading: boolean;
  recentCommits: RecentCommit[];
  historyCommits: HistoryCommit[];
  historyHasMore: boolean;
  historyNextCursor?: string;
  historyFilters: HistoryFilters;
  historyLoading: boolean;
  newBranchName: string;
  commitOptionsByRepo: Record<string, CommitOptions>;
  cloneDialogOpen: boolean;
  initDialogOpen: boolean;
  githubPublishRepoId?: string;
  submodules: SubmoduleEntry[];
  submodulesLoading: boolean;
  tags: TagDetail[];
  tagsLoading: boolean;
  tagsHasMore: boolean;
  tagsNextCursor?: string;
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

  setCommandPaletteOpen: (open: boolean) => void;
  setRepoPanel: (panel: RepoPanel) => void;
  setSelectedFile: (file?: SelectedDiffFile) => void;
  setNewBranchName: (name: string) => void;
  setCommitDraft: (projectId: string, message: string) => void;
  clearGlobalError: () => void;
  clearOperationError: (projectId: string) => void;
  setOperationDrawerOpen: (open: boolean) => void;
  setCloneDialogOpen: (open: boolean) => void;
  setInitDialogOpen: (open: boolean) => void;
  setGitHubPublishRepoId: (projectId?: string) => void;
  setHistoryFilters: (projectId: string, filters: HistoryFilters) => void;
  setCommitAmend: (projectId: string, amend: boolean) => void;
  setCommitSignOff: (projectId: string, signOff: boolean) => void;
  loadOperations: () => Promise<void>;
  cancelOperation: (operationId: string) => Promise<void>;
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

  runRepoOperation: (
    projectId: string,
    name: string,
    fn: () => Promise<
      { ok: true; snapshot: RepositorySnapshot } | { ok: false; error: BureauError }
    >
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
  cherryPick: (projectId: string, revision: string, commitOid: string) => Promise<void>;
  revertCommit: (projectId: string, revision: string, commitOid: string) => Promise<void>;
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
  selectCommit: (projectId: string, commitOid: string) => Promise<void>;
  clearCommitSelection: () => void;

  openInFileExplorer: (projectId: string) => Promise<void>;
  openInTerminal: (projectId: string) => Promise<void>;
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

export const useGitStore = create<AppStore>((set, get) => ({
  repos: {},
  repoIds: [],
  sidebarRecentRepoIds: [],
  loading: true,
  commitDrafts: {},
  operationByRepo: {},
  operationDrawerOpen: false,
  operations: [],
  recoveryStateByRepo: {},
  announcements: [],
  commandPaletteOpen: false,
  repoPanel: 'changes',
  diffLoading: false,
  commitFiles: [],
  commitFilesLoading: false,
  commitFilesError: undefined,
  branches: [],
  branchDetails: [],
  branchesLoading: false,
  stashEntries: [],
  stashLoading: false,
  selectedStashIndex: undefined,
  stashFiles: [],
  worktrees: [],
  worktreesLoading: false,
  recentCommits: [],
  historyCommits: [],
  historyHasMore: false,
  historyNextCursor: undefined,
  historyFilters: {},
  historyLoading: false,
  newBranchName: '',
  commitOptionsByRepo: {},
  cloneDialogOpen: false,
  initDialogOpen: false,
  githubPublishRepoId: undefined,
  submodules: [],
  submodulesLoading: false,
  tags: [],
  tagsLoading: false,
  tagsHasMore: false,
  tagsNextCursor: undefined,
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

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setRepoPanel: (panel) =>
    set((s) => ({
      repoPanel: panel,
      ...(panel !== 'history'
        ? {
            selectedCommitOid: undefined,
            commitFiles: [],
            commitFilesError: undefined,
            ...(s.selectedFile?.area === 'commit'
              ? { selectedFile: undefined, diffText: undefined }
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
          }),
      ...(panel !== 'stash'
        ? {
            selectedStashIndex: undefined,
            stashFiles: [],
            ...(s.selectedFile?.area === 'stash'
              ? { selectedFile: undefined, diffText: undefined }
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
      blameLines: [],
      blameHasMore: false,
      blamePath: undefined,
      blameCommitOid: undefined,
    }),
  setNewBranchName: (name) => set({ newBranchName: name }),
  setCommitDraft: (projectId, message) =>
    set((s) => ({ commitDrafts: { ...s.commitDrafts, [projectId]: message } })),
  clearGlobalError: () => set({ globalError: undefined }),
  clearOperationError: (projectId) =>
    set((s) => {
      const next = { ...s.operationByRepo };
      delete next[projectId];
      return { operationByRepo: next };
    }),

  setOperationDrawerOpen: (open) => set({ operationDrawerOpen: open }),

  setCloneDialogOpen: (open) => set({ cloneDialogOpen: open }),
  setInitDialogOpen: (open) => set({ initDialogOpen: open }),
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
    try {
      const result = await api().operations.list();
      set({ operations: result.operations });
    } catch {
      // drawer remains usable with last known list
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
    await get().runRepoOperation(projectId, `Recovery ${action}`, run);
    await get().refreshRepo(projectId);
    await get().loadRecoveryState(projectId);
  },

  resolveConflict: async (projectId, revision, path, resolution) => {
    await get().runRepoOperation(projectId, 'Resolve conflict', () =>
      api().git.resolveConflict({ projectId, snapshotRevision: revision, path, resolution })
    );
    await get().loadRecoveryState(projectId);
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

  runRepoOperation: async (projectId, name, fn) => {
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
          operationByRepo: { ...s.operationByRepo, [projectId]: { name, error: result.error } },
        }));
      }
    } catch (err) {
      set((s) => ({
        operationByRepo: {
          ...s.operationByRepo,
          [projectId]: { name, error: toError(err, name) },
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
            set({ selectedFile: undefined, diffText: undefined });
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
              set({ selectedFile: undefined, diffText: undefined });
            }
          }
        }
        return result;
      }
    ),
  fetch: (projectId, revision) =>
    get().runRepoOperation(projectId, 'Fetch', () =>
      api().git.fetch({ projectId, snapshotRevision: revision })
    ),
  pull: (projectId, revision) =>
    get().runRepoOperation(projectId, 'Pull', () =>
      api().git.pullFastForward({ projectId, snapshotRevision: revision })
    ),
  push: (projectId, revision) =>
    get().runRepoOperation(projectId, 'Push', () =>
      api().git.push({ projectId, snapshotRevision: revision })
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
  cherryPick: (projectId, revision, commitOid) =>
    get().runRepoOperation(projectId, 'Cherry-pick', () =>
      api().git.cherryPick({ projectId, snapshotRevision: revision, commitOid })
    ),
  revertCommit: (projectId, revision, commitOid) =>
    get().runRepoOperation(projectId, 'Revert', () =>
      api().git.revertCommit({ projectId, snapshotRevision: revision, commitOid })
    ),
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
    get().runRepoOperation(projectId, 'Stash pop', async () => {
      const result = await api().git.stashPop({ projectId, snapshotRevision: revision, index });
      if (result.ok) await get().loadStash(projectId);
      return result;
    }),
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
    });
    await get().loadStashFiles(projectId, index);
  },
  loadStashFiles: async (projectId, index) => {
    try {
      const stashFiles = await api().git.listStashFiles({ projectId, index });
      set({ stashFiles, selectedStashIndex: index });
      const first = stashFiles[0];
      if (first) {
        await get().loadStashDiff(projectId, index, first.path);
      }
    } catch {
      set({ stashFiles: [] });
    }
  },
  loadStashDiff: async (projectId, index, path) => {
    set({
      diffLoading: true,
      selectedFile: { projectId, path, area: 'stash', stashIndex: index },
    });
    try {
      const result = await api().git.getStashDiff({ projectId, index, path });
      set({
        diffLoading: false,
        diffText: result.ok ? result.diff || '(no changes)' : `Error: ${result.error.message}`,
      });
    } catch (err) {
      set({ diffLoading: false, diffText: toError(err, 'getStashDiff').message });
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
    get().runRepoOperation(projectId, 'Restore stash files', async () => {
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
    }),

  loadDiff: async (projectId, path, area, commitOid) => {
    const generation = diffLoadRequest.nextGeneration();
    set({
      diffLoading: true,
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
      set({
        diffLoading: false,
        diffText: result.ok ? result.diff || '(no changes)' : `Error: ${result.error.message}`,
      });
    } catch (err) {
      if (!diffLoadRequest.isCurrent(generation)) return;
      set({ diffLoading: false, diffText: toError(err, 'getDiff').message });
    }
  },

  loadBranches: async (projectId) => {
    const generation = branchLoadRequest.nextGeneration();
    set({ branchesLoading: true });
    try {
      const branchDetails = await api().git.listBranchDetails({ projectId });
      if (!branchLoadRequest.isCurrent(generation)) return;
      const branches = branchDetails.filter((b) => b.kind === 'local').map((b) => b.shortName);
      set({ branchDetails, branches, branchesLoading: false });
    } catch {
      if (branchLoadRequest.isCurrent(generation)) {
        set({ branchesLoading: false });
      }
    }
  },

  loadStash: async (projectId) => {
    set({ stashLoading: true });
    try {
      const stashEntries = await api().git.stashList({ projectId });
      set({ stashEntries, stashLoading: false });
    } catch {
      set({ stashLoading: false });
    }
  },

  loadWorktrees: async (projectId) => {
    set({ worktreesLoading: true });
    try {
      const worktrees = await api().git.listWorktrees({ projectId });
      set({ worktrees, worktreesLoading: false });
    } catch {
      set({ worktreesLoading: false });
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
    get().runRepoOperation(projectId, 'Prune worktrees', async () => {
      const result = await api().git.pruneWorktrees({ projectId, snapshotRevision: revision });
      if (result.ok) await get().loadWorktrees(projectId);
      return result;
    }),

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
        recentCommits: result.items,
        historyHasMore: result.hasMore,
        historyNextCursor: result.nextCursor,
        historyLoading: false,
      });
    } catch {
      if (historyLoadRequest.isCurrent(generation)) {
        set({ historyLoading: false });
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
          recentCommits: historyCommits,
          historyHasMore: result.hasMore,
          historyNextCursor: result.nextCursor,
          historyLoading: false,
        };
      });
    } catch {
      if (historyLoadRequest.isCurrent(generation)) {
        set({ historyLoading: false });
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
        globalError: error,
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
    }),

  openInFileExplorer: async (projectId) => {
    try {
      const result = await api().system.openInExplorer({ projectId });
      if (!result.ok) ((tone: any, message: string) => set({ statusBanner: { tone, message } }))('error', result.error.message);
    } catch (err) {
      ((tone: any, message: string) => set({ statusBanner: { tone, message } }))('error', toError(err, 'system.openInExplorer').message);
    }
  },
  openInTerminal: async (projectId) => {
    try {
      await api().system.openInTerminal({ projectId });
    } catch (err) {
      set({ globalError: toError(err, 'openInTerminal') });
    }
  },
  openInEditor: async (projectId) => {
    try {
      await api().system.openInEditor({ projectId });
    } catch (err) {
      set({ globalError: toError(err, 'openInEditor') });
    }
  },
  chooseGitExecutable: async () => {
    try {
      const settings = await api().settings.chooseGitExecutable();
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      set({ globalError: toError(err, 'chooseGitExecutable') });
    }
  },
  clearGitExecutable: async () => {
    try {
      const settings = await api().settings.clearGitExecutable();
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      set({ globalError: toError(err, 'clearGitExecutable') });
    }
  },
  chooseCustomEditor: async () => {
    try {
      const settings = await api().settings.chooseCustomEditor();
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      set({ globalError: toError(err, 'chooseCustomEditor') });
    }
  },
  setEditorPreset: async (preset) => {
    try {
      const settings = await api().settings.setEditorPreset({ preset });
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      set({ globalError: toError(err, 'setEditorPreset') });
    }
  },
  chooseCustomTerminal: async () => {
    try {
      const settings = await api().settings.chooseCustomTerminal();
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      set({ globalError: toError(err, 'chooseCustomTerminal') });
    }
  },
  setTerminalPreset: async (preset) => {
    try {
      const settings = await api().settings.setTerminalPreset({ preset });
      const capabilities = await api().app.getCapabilities();
      set({ settings, capabilities });
    } catch (err) {
      set({ globalError: toError(err, 'setTerminalPreset') });
    }
  },
  refreshCapabilities: async () => {
    try {
      const capabilities = await api().app.getCapabilities();
      set({ capabilities });
    } catch (err) {
      set({ globalError: toError(err, 'refreshCapabilities') });
    }
  },
  updateSettings: async (patch) => {
    try {
      const settings = await api().settings.update(patch);
      applyAppearance(settings.appearance);
      const capabilities = await api().app.getCapabilities();
      set((s) => ({
        settings,
        capabilities,
        sidebarRecentRepoIds: recentRepoIds(s.repoIds, s.repos, settings.hub.recentCount),
      }));
    } catch (err) {
      set({ globalError: toError(err, 'updateSettings') });
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
            statusBanner: {
              tone: 'success',
              message: result.created
                ? 'Repository created and branch published to GitHub'
                : 'Branch published to GitHub',
            },
            announcements: [...s.announcements, 'Repository published to GitHub'],
          };
        });
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
    set({ cloneDialogOpen: false, statusBanner: { tone: 'info', message: 'Cloning repository…' } });
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
          sidebarRecentRepoIds: ensureRecentRepoId(
            s.sidebarRecentRepoIds,
            result.projectId,
            s.settings?.hub.recentCount ?? 8
          ),
          statusBanner: { tone: 'success', message: 'Repository cloned' },
          announcements: [...s.announcements, 'Repository cloned'],
        }));
        await get().refreshRepo(result.projectId);
        await useAppStore.getState().selectProject(result.projectId);
        useAppStore.getState().setProjectTab('git');
        return;
      }
      if ('cancelled' in result) {
        set({ statusBanner: undefined });
        return;
      }
      set({
        statusBanner: { tone: 'error', message: result.error.message },
        globalError: result.error,
      });
    } catch (err) {
      const error = toError(err, 'clone');
      set({ statusBanner: { tone: 'error', message: error.message }, globalError: error });
    }
  },

  initRepository: async (input) => {
    set({
      initDialogOpen: false,
      statusBanner: { tone: 'info', message: 'Initializing repository…' },
    });
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
          sidebarRecentRepoIds: ensureRecentRepoId(
            s.sidebarRecentRepoIds,
            result.projectId,
            s.settings?.hub.recentCount ?? 8
          ),
          statusBanner: { tone: 'success', message: 'Repository initialized' },
          announcements: [...s.announcements, 'Repository initialized'],
        }));
        await get().refreshRepo(result.projectId);
        await useAppStore.getState().selectProject(result.projectId);
        useAppStore.getState().setProjectTab('git');
        return;
      }
      if ('cancelled' in result) {
        set({ statusBanner: undefined });
        return;
      }
      set({
        statusBanner: { tone: 'error', message: result.error.message },
        globalError: result.error,
      });
    } catch (err) {
      const error = toError(err, 'initRepository');
      set({ statusBanner: { tone: 'error', message: error.message }, globalError: error });
    }
  },

  loadSubmodules: async (projectId) => {
    set({ submodulesLoading: true });
    try {
      const submodules = await api().git.listSubmodules({ projectId });
      set({ submodules, submodulesLoading: false });
    } catch {
      set({ submodulesLoading: false });
    }
  },

  submoduleInit: (projectId, revision, path) =>
    get().runRepoOperation(projectId, 'Submodule init', async () => {
      const result = await api().git.submoduleInit({ projectId, snapshotRevision: revision, path });
      if (result.ok) await get().loadSubmodules(projectId);
      return result;
    }),

  submoduleUpdate: (projectId, revision, path) =>
    get().runRepoOperation(projectId, 'Submodule update', async () => {
      const result = await api().git.submoduleUpdate({ projectId, snapshotRevision: revision, path });
      if (result.ok) await get().loadSubmodules(projectId);
      return result;
    }),

  loadTags: async (projectId, append = false) => {
    set({ tagsLoading: true });
    try {
      const cursor = append ? get().tagsNextCursor : undefined;
      const result = await api().git.listTags({ projectId, cursor, limit: 50 });
      set((s) => ({
        tags: append ? [...s.tags, ...result.items] : result.items,
        tagsHasMore: result.hasMore,
        tagsNextCursor: result.nextCursor,
        tagsLoading: false,
      }));
    } catch {
      set({ tagsLoading: false });
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
      set((s) => ({
        blameLines: append ? [...s.blameLines, ...result.items] : result.items,
        blameHasMore: result.hasMore,
        blamePath: path,
        blameCommitOid: commitOid,
        blameLoading: false,
      }));
    } catch (err) {
      set({ blameLoading: false, globalError: toError(err, 'blame') });
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
      repoIds: s.repoIds.includes(projectId) ? s.repoIds : [...s.repoIds, projectId],
    };
  });
}
