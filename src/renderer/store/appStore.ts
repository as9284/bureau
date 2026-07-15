import { create } from 'zustand';
import type { AppCapabilities } from '@shared/contracts/capabilities';
import type {
  ProcessDefinition,
  StackDetectionResult,
  TrackedProject,
} from '@shared/contracts/projects';
import type {
  LogLine,
  ProcessOutputEvent,
  ProcessStatusEvent,
  ProjectProcesses,
} from '@shared/contracts/processes';
import type {
  PreviewConsoleMessage,
  PreviewState,
} from '@shared/contracts/preview';
import type { AppUpdateState } from '@shared/contracts/updates';
import type { ShutdownProcess } from '@shared/contracts/lifecycle';
import type { GitSnapshot } from '@shared/contracts/git';
import type {
  EditorPreset,
  PublicSettings,
  SettingsPatch,
  TerminalPreset,
  ThemePreference,
} from '@shared/contracts/settings';
import type { BureauError } from '@shared/contracts/errors';
import { moveTabRelative, type TabDropPlace } from '@shared/files/tabOrder';
import { isPathDeleted, pathsAffectedByDelete } from '@shared/files/deletedPaths';
import type { ProjectToolchains, SwitchableRuntimeKind } from '@shared/contracts/toolchains';
import type { ProjectPorts } from '@shared/contracts/ports';
import type { ProjectTasks } from '@shared/contracts/tasks';
import type {
  AndroidOverview,
  LogcatFilter,
  LogcatLine,
  ReactNativeProjectStatus,
} from '@shared/contracts/android';
import type {
  FileEntry,
  FileSystemEvent,
  FileWorkspaceState,
  ImageDocument,
  LineEnding,
  SearchBatch,
  SearchMatch,
  TextDocument,
} from '@shared/contracts/files';
import { applyAppearance } from '../lib/appearance';
import { errorHeading, toError } from '../lib/error';

export type AppView = 'hub' | 'project' | 'settings';
export type ActiveSection = 'projects' | 'settings';
export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'tools'
  | 'android'
  | 'toolchains'
  | 'files'
  | 'git';
export type ProjectTab =
  | 'overview'
  | 'files'
  | 'processes'
  | 'preview'
  | 'android'
  | 'toolchains'
  | 'ports'
  | 'git';
export type ViewportPreset = 'fill' | 'mobile' | 'tablet' | 'desktop';

export type ContextMenuItem =
  | { type: 'item'; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { type: 'separator' };

export type ContextMenuState = { x: number; y: number; items: ContextMenuItem[] };

export type ToastTone = 'info' | 'success' | 'error';
export type Toast = { id: number; tone: ToastTone; message: string };

/** An in-flight process action, tracked optimistically for immediate UI feedback. */
export type PendingAction = 'starting' | 'stopping' | 'restarting';

/** A process being stopped during graceful shutdown, plus whether it has stopped. */
export type ShutdownItem = ShutdownProcess & { done: boolean };
export type ShutdownState = { items: ShutdownItem[] };

export type FileBufferState =
  | {
      kind: 'text';
      document: TextDocument;
      content: string;
      dirty: boolean;
      conflict: boolean;
      missing: boolean;
      recovered: boolean;
      saveError: BureauError | null;
    }
  | { kind: 'image'; document: ImageDocument; objectUrl: string };

export type FilesLoadingPhase = 'idle' | 'starting' | 'watching' | 'restoring';

export type FilesProjectState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadingPhase: FilesLoadingPhase;
  error: BureauError | null;
  directoryCache: Record<string, FileEntry[]>;
  expandedPaths: string[];
  tabs: string[];
  activePath: string | null;
  buffers: Record<string, FileBufferState>;
  selectedPath: string | null;
  recentPaths: string[];
  pinnedPaths: string[];
  modeByPath: Record<string, 'edit' | 'preview' | 'split'>;
  cursorByPath: Record<string, { line: number; column: number; scrollTop: number }>;
  readingProgressByPath: Record<string, number>;
  watcherStatus: 'idle' | 'starting' | 'ready' | 'error';
  showIgnored: boolean;
  search: {
    searchId: string | null;
    query: string;
    matches: SearchMatch[];
    running: boolean;
    truncated: boolean;
    visitedFiles: number;
    error: string | null;
  };
};

export type AndroidWorkspaceState = {
  overview: AndroidOverview | null;
  selectedDevice: string;
  apkPath: string;
  packageName: string;
  activity: string;
  packages: string[];
  filter: LogcatFilter;
  logcat: { running: boolean; paused: boolean; lines: LogcatLine[] };
  bitrate: number;
  maxSize: number;
  recordPath: string;
  reactNative: ReactNativeProjectStatus | null;
  reactNativeError: string | null;
};

const LOG_CAP = 4000;

function processKey(projectId: string, processId: string): string {
  return `${projectId}:${processId}`;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

type AppState = {
  status: 'loading' | 'ready' | 'error';
  capabilities: AppCapabilities | null;
  settings: PublicSettings | null;
  projects: TrackedProject[];

  view: AppView;
  activeSection: ActiveSection;
  settingsSection: SettingsSection;
  selectedProjectId: string | null;
  projectTab: ProjectTab;

  processesByProject: Record<string, ProjectProcesses>;
  toolchainsByProject: Record<string, ProjectToolchains>;
  portsByProject: Record<string, ProjectPorts>;
  tasksByProject: Record<string, ProjectTasks>;
  logsByProject: Record<string, LogLine[]>;
  gitByProject: Record<string, GitSnapshot>;
  filesByProject: Record<string, FilesProjectState>;
  androidByProject: Record<string, AndroidWorkspaceState>;
  pendingProcesses: Record<string, PendingAction>;
  expandedProcess: string | null;

  previewUrl: string | null;
  previewState: PreviewState | null;
  previewViewport: ViewportPreset;
  previewRotated: boolean;
  previewFullscreen: boolean;
  previewRecents: string[];
  previewConsole: PreviewConsoleMessage[];
  previewConsoleOpen: boolean;

  updateState: AppUpdateState | null;

  paletteOpen: boolean;
  onboardingOpen: boolean;
  contextMenu: ContextMenuState | null;
  announcements: string[];
  globalError: BureauError | null;
  toasts: Toast[];
  shutdown: ShutdownState | null;
  closePrompt: { processes: ShutdownProcess[]; dirtyFiles?: number } | null;
  pendingProjectRemoval: string | null;

  addDialogOpen: boolean;
  addBusy: boolean;
  addDetection: { path: string; detection: StackDetectionResult } | null;

  init(): Promise<void>;
  refreshProjects(): Promise<void>;
  setView(view: AppView): void;
  setSection(section: ActiveSection): void;
  setSettingsSection(section: SettingsSection): void;

  openAddDialog(): Promise<void>;
  cancelAddDialog(): void;
  confirmAddProject(): Promise<void>;

  selectProject(projectId: string): Promise<void>;
  backToHub(): void;
  removeProject(projectId: string, force?: boolean): Promise<void>;
  cancelProjectRemoval(): void;
  setProjectTab(tab: ProjectTab): void;

  loadProcesses(projectId: string): Promise<void>;
  saveProcessDefinition(projectId: string, definition: ProcessDefinition): Promise<void>;
  removeProcessDefinition(projectId: string, processId: string): Promise<void>;
  loadToolchains(projectId: string): Promise<void>;
  loadPorts(projectId: string): Promise<void>;
  loadTasks(projectId: string): Promise<void>;
  setActiveToolchain(
    projectId: string,
    kind: SwitchableRuntimeKind,
    version: string
  ): Promise<void>;
  killPort(pid: number, port: number): Promise<void>;
  runTask(projectId: string, taskId: string): Promise<void>;
  toggleProcess(projectId: string, processId: string): Promise<void>;
  startProcess(projectId: string, processId: string): Promise<void>;
  stopProcess(projectId: string, processId: string): Promise<void>;
  restartProcess(projectId: string, processId: string): Promise<void>;
  startAllProcesses(projectId: string): Promise<void>;
  stopAllProcesses(projectId: string): Promise<void>;

  loadGit(projectId: string): Promise<void>;
  setAndroidWorkspace(projectId: string, patch: Partial<AndroidWorkspaceState>): void;
  ensureFilesProject(projectId: string): Promise<void>;
  loadFileDirectory(projectId: string, relativePath: string): Promise<void>;
  openProjectFile(projectId: string, entry: FileEntry | string): Promise<void>;
  updateFileBuffer(projectId: string, relativePath: string, content: string): void;
  saveFile(projectId: string, relativePath: string, force?: boolean): Promise<boolean>;
  saveAllFiles(projectId: string): Promise<boolean>;
  closeFile(projectId: string, relativePath: string, discard?: boolean): void;
  closeDeletedFiles(projectId: string, relativePath: string): void;
  setActiveFile(projectId: string, relativePath: string): void;
  reorderFileTabs(projectId: string, sourcePath: string, targetPath: string, place?: TabDropPlace): void;
  togglePinnedFile(projectId: string, relativePath: string): void;
  setFileMode(projectId: string, relativePath: string, mode: 'edit' | 'preview' | 'split'): void;
  setFileCursor(projectId: string, relativePath: string, line: number, column: number): void;
  setFileLineEnding(projectId: string, relativePath: string, lineEnding: 'lf' | 'crlf' | 'cr'): void;
  setFileReadingProgress(projectId: string, relativePath: string, progress: number): void;
  toggleFileDirectory(projectId: string, relativePath: string): Promise<void>;
  setFilesSelection(projectId: string, relativePath: string | null): void;
  setFilesShowIgnored(projectId: string, showIgnored: boolean): Promise<void>;
  searchProjectFiles(projectId: string, query: string, caseSensitive?: boolean, wholeWord?: boolean): Promise<void>;
  cancelProjectSearch(projectId: string): Promise<void>;
  reloadFileFromDisk(projectId: string, relativePath: string): Promise<void>;
  openInEditor(): Promise<void>;
  openInTerminal(): Promise<void>;
  openInExplorer(): Promise<void>;

  openUrlInPreview(url: string): void;
  previewNavigate(url: string): void;
  previewReload(): void;
  previewReloadHard(): void;
  previewBack(): void;
  previewForward(): void;
  previewOpenExternal(): void;
  previewOpenDevTools(): void;
  setPreviewZoom(factor: number): void;
  clearPreviewConsole(): void;
  togglePreviewConsole(): void;
  setPreviewViewport(preset: ViewportPreset): void;
  togglePreviewRotate(): void;
  togglePreviewFullscreen(): void;
  setPreviewFullscreen(value: boolean): void;

  openPalette(): void;
  closePalette(): void;
  togglePalette(): void;
  completeOnboarding(): void;
  openContextMenu(menu: ContextMenuState): void;
  closeContextMenu(): void;
  updateSettings(patch: SettingsPatch): Promise<void>;
  applySettings(settings: PublicSettings): void;
  setEditorPreset(preset: EditorPreset | 'none'): Promise<void>;
  chooseCustomEditor(): Promise<void>;
  setTerminalPreset(preset: TerminalPreset | 'auto'): Promise<void>;
  chooseCustomTerminal(): Promise<void>;
  toggleTheme(): Promise<void>;

  announce(message: string): void;
  pushToast(tone: ToastTone, message: string): void;
  dismissToast(id: number): void;

  confirmQuit(): void;
  saveAllAndQuit(): Promise<void>;
  discardAllAndQuit(): void;
  cancelQuit(): void;
};

const api = () => window.bureau;
let toastId = 0;
let subscribed = false;
const draftTimers = new Map<string, ReturnType<typeof setTimeout>>();
const workspacePersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
const workspacePersistPending = new Map<string, FilesProjectState>();

function createFilesProjectState(): FilesProjectState {
  return {
    status: 'idle', loadingPhase: 'idle', error: null, directoryCache: {}, expandedPaths: [], tabs: [], activePath: null,
    buffers: {}, selectedPath: null, recentPaths: [], pinnedPaths: [], modeByPath: {}, cursorByPath: {}, readingProgressByPath: {},
    watcherStatus: 'idle', showIgnored: false,
    search: { searchId: null, query: '', matches: [], running: false, truncated: false, visitedFiles: 0, error: null },
  };
}

function createAndroidWorkspaceState(): AndroidWorkspaceState {
  return {
    overview: null,
    selectedDevice: '',
    apkPath: '',
    packageName: '',
    activity: '',
    packages: [],
    filter: { priority: 'V', tag: '', packageName: '', regex: '' },
    logcat: { running: false, paused: false, lines: [] },
    bitrate: 8,
    maxSize: 1920,
    recordPath: '',
    reactNative: null,
    reactNativeError: null,
  };
}

function parentFilePath(relativePath: string): string {
  const parts = relativePath.split('/');
  parts.pop();
  return parts.join('/');
}

function persistFilesWorkspace(projectId: string, project: FilesProjectState): void {
  // Coalesce the frequent workspace writes — open/close/toggle/reorder, and the
  // burst during session restore — into a single fsync'd save. Previously each
  // action triggered an fsync (temp file + sync + backup), serialized through
  // the write queue, which dominated open time when restoring many tabs.
  workspacePersistPending.set(projectId, project);
  if (workspacePersistTimers.has(projectId)) return;
  workspacePersistTimers.set(
    projectId,
    setTimeout(() => {
      workspacePersistTimers.delete(projectId);
      const latest = workspacePersistPending.get(projectId);
      workspacePersistPending.delete(projectId);
      if (!latest) return;
      const state: FileWorkspaceState = {
        projectId,
        openPaths: latest.tabs,
        activePath: latest.activePath,
        expandedPaths: latest.expandedPaths,
        recentPaths: latest.recentPaths,
        pinnedPaths: latest.pinnedPaths,
        modeByPath: latest.modeByPath,
        cursorByPath: latest.cursorByPath,
        explorerWidth: 280,
        updatedAt: new Date().toISOString(),
      };
      void api().files.saveWorkspaceState({ state });
    }, 400)
  );
}

export const useAppStore = create<AppState>()((set, get) => ({
  status: 'loading',
  capabilities: null,
  settings: null,
  projects: [],

  view: 'hub',
  activeSection: 'projects',
  settingsSection: 'general',
  selectedProjectId: null,
  projectTab: 'overview',

  processesByProject: {},
  toolchainsByProject: {},
  portsByProject: {},
  tasksByProject: {},
  logsByProject: {},
  gitByProject: {},
  filesByProject: {},
  androidByProject: {},
  pendingProcesses: {},
  expandedProcess: null,

  previewUrl: null,
  previewState: null,
  previewViewport: 'fill',
  previewRotated: false,
  previewFullscreen: false,
  previewRecents: [],
  previewConsole: [],
  previewConsoleOpen: false,

  updateState: null,

  paletteOpen: false,
  onboardingOpen: false,
  contextMenu: null,
  announcements: [],
  globalError: null,
  toasts: [],
  shutdown: null,
  closePrompt: null,
  pendingProjectRemoval: null,

  addDialogOpen: false,
  addBusy: false,
  addDetection: null,

  async init() {
    try {
      const [capabilities, settings, projects] = await Promise.all([
        api().app.getCapabilities(),
        api().settings.get(),
        api().projects.list(),
      ]);
      applyAppearance(settings.appearance);
      set({
        capabilities,
        settings,
        projects,
        status: 'ready',
        view: 'hub',
        // Show onboarding on first run and once for existing users after the
        // update that adds it (their settings backfill completedVersion = null).
        onboardingOpen: settings.onboarding?.completedVersion == null,
      });

      if (!subscribed) {
        subscribed = true;
        api().processes.onOutput(handleOutput);
        api().processes.onStatus(handleStatus);
        api().preview.onState((previewState) => set({ previewState }));
        api().preview.onConsole((messages) =>
          set((s) => ({ previewConsole: [...s.previewConsole, ...messages].slice(-500) }))
        );
        api().app.onUpdateState((updateState) => set({ updateState }));
        void api()
          .app.getUpdateState()
          .then((updateState) => set((s) => (s.updateState ? {} : { updateState })));
        api().app.onShutdownBegin(({ processes }) => {
          set({ shutdown: { items: processes.map((p) => ({ ...p, done: false })) } });
        });
        api().app.onShutdownProgress(({ projectId, processId }) => {
          set((s) => {
            if (!s.shutdown) return {};
            return {
              shutdown: {
                items: s.shutdown.items.map((item) =>
                  item.projectId === projectId && item.processId === processId
                    ? { ...item, done: true }
                    : item
                ),
              },
            };
          });
        });
        api().app.onCloseRequested((payload) => set({ closePrompt: payload }));
        api().files.onFileEvents(handleFileEvents);
        api().files.onSearchEvents(handleSearchBatch);
      }
    } catch (err) {
      set({ status: 'error', globalError: toError(err, 'app.init') });
    }

    function handleOutput(event: ProcessOutputEvent): void {
      const key = processKey(event.projectId, event.processId);
      set((s) => {
        const existing = s.logsByProject[key] ?? [];
        const merged = [...existing, ...event.lines];
        const trimmed = merged.length > LOG_CAP ? merged.slice(merged.length - LOG_CAP) : merged;
        return { logsByProject: { ...s.logsByProject, [key]: trimmed } };
      });
    }

    function handleStatus(event: ProcessStatusEvent): void {
      const { runtime } = event;
      set((s) => {
        const bucket = s.processesByProject[runtime.projectId];
        if (!bucket) return {};
        const runtimes = bucket.runtimes.some((r) => r.processId === runtime.processId)
          ? bucket.runtimes.map((r) => (r.processId === runtime.processId ? runtime : r))
          : [...bucket.runtimes, runtime];
        // A real status transition resolves any optimistic pending action, except that a
        // 'restarting' action must survive the intermediate 'exited' event from the stop half.
        const key = processKey(runtime.projectId, runtime.processId);
        const pending = s.pendingProcesses[key];
        const keepPending =
          pending === 'restarting' && (runtime.status === 'exited' || runtime.status === 'idle');
        const pendingProcesses = keepPending
          ? s.pendingProcesses
          : omitKey(s.pendingProcesses, key);
        return {
          processesByProject: {
            ...s.processesByProject,
            [runtime.projectId]: { ...bucket, runtimes },
          },
          pendingProcesses,
        };
      });
    }

    function handleFileEvents(events: FileSystemEvent[]): void {
      const cleanReloads: Array<{ projectId: string; relativePath: string }> = [];
      const configProjects = new Set<string>();
      set((s) => {
        const filesByProject = { ...s.filesByProject };
        for (const event of events) {
          const project = filesByProject[event.projectId];
          if (!project) continue;
          if (event.type === 'watcher-ready' || event.type === 'watcher-error') {
            filesByProject[event.projectId] = {
              ...project,
              watcherStatus: event.type === 'watcher-ready' ? 'ready' : 'error',
            };
            continue;
          }
          const parent = parentFilePath(event.relativePath);
          const directoryCache = { ...project.directoryCache };
          delete directoryCache[parent];
          const buffer = project.buffers[event.relativePath];
          let buffers = project.buffers;
          let tabs = project.tabs;
          let activePath = project.activePath;
          let recentPaths = project.recentPaths;
          let pinnedPaths = project.pinnedPaths;
          if (event.type === 'deleted') {
            const victims = pathsAffectedByDelete(project.tabs, event.relativePath);
            if (victims.length) {
              buffers = { ...project.buffers };
              tabs = project.tabs.filter((path) => !victims.includes(path));
              for (const path of victims) {
                const open = buffers[path];
                if (open?.kind === 'text' && open.dirty) {
                  buffers[path] = { ...open, missing: true, conflict: true };
                  if (!tabs.includes(path)) tabs = [...tabs, path];
                } else {
                  if (open?.kind === 'image') URL.revokeObjectURL(open.objectUrl);
                  delete buffers[path];
                }
              }
              if (activePath && isPathDeleted(activePath, event.relativePath)) {
                const stillOpen = victims.find((path) => tabs.includes(path));
                const closedIndex = project.tabs.indexOf(activePath);
                activePath =
                  stillOpen ??
                  (closedIndex >= 0 ? tabs[Math.min(closedIndex, tabs.length - 1)] : null) ??
                  tabs[tabs.length - 1] ??
                  null;
              }
            } else if (buffer?.kind === 'text' && buffer.dirty) {
              buffers = { ...buffers, [event.relativePath]: { ...buffer, missing: true, conflict: true } };
            }
            recentPaths = project.recentPaths.filter((path) => !isPathDeleted(path, event.relativePath));
            pinnedPaths = project.pinnedPaths.filter((path) => !isPathDeleted(path, event.relativePath));
          } else if (buffer?.kind === 'text') {
            if (buffer.dirty) {
              buffers = { ...buffers, [event.relativePath]: { ...buffer, conflict: true } };
            } else if (event.type === 'changed' && (s.settings?.files?.autoReloadClean ?? true)) {
              cleanReloads.push({ projectId: event.projectId, relativePath: event.relativePath });
            }
          }
          const next = { ...project, directoryCache, buffers, tabs, activePath, recentPaths, pinnedPaths };
          filesByProject[event.projectId] = next;
          if (event.type === 'deleted') persistFilesWorkspace(event.projectId, next);
          if (event.relativePath.toLocaleLowerCase() === '.bureau/config.json') configProjects.add(event.projectId);
        }
        return { filesByProject };
      });
      for (const item of cleanReloads) void get().reloadFileFromDisk(item.projectId, item.relativePath);
      for (const projectId of configProjects) {
        void get().loadProcesses(projectId);
        void get().loadTasks(projectId);
        get().pushToast('info', 'Project configuration changed; processes and tasks were refreshed.');
      }
    }

    function handleSearchBatch(batch: SearchBatch): void {
      set((s) => {
        const project = s.filesByProject[batch.projectId];
        if (!project || project.search.searchId !== batch.searchId) return {};
        return {
          filesByProject: {
            ...s.filesByProject,
            [batch.projectId]: {
              ...project,
              search: {
                ...project.search,
                matches: [...project.search.matches, ...batch.matches],
                running: !batch.done,
                truncated: project.search.truncated || batch.truncated,
                visitedFiles: batch.visitedFiles || project.search.visitedFiles,
                error: null,
              },
            },
          },
        };
      });
    }
  },

  async refreshProjects() {
    try {
      set({ projects: await api().projects.list() });
    } catch (err) {
      set({ globalError: toError(err, 'projects.list') });
    }
  },

  setView(view) {
    set({ view, activeSection: view === 'settings' ? 'settings' : 'projects' });
  },

  setSection(section) {
    if (section === 'settings') {
      set({ activeSection: 'settings', view: 'settings' });
    } else {
      // Clicking "Projects" always returns to the projects home (hub).
      set({ activeSection: 'projects', view: 'hub', selectedProjectId: null });
    }
  },

  setSettingsSection(section) {
    set({ settingsSection: section, activeSection: 'settings', view: 'settings' });
  },

  async openAddDialog() {
    try {
      const { path } = await api().system.chooseDirectory({ title: 'Add a project' });
      if (!path) return;
      const detection = await api().projects.detect({ path });
      set({ addDialogOpen: true, addDetection: { path, detection } });
    } catch (err) {
      get().pushToast('error', toError(err, 'projects.detect').message);
    }
  },

  cancelAddDialog() {
    set({ addDialogOpen: false, addDetection: null, addBusy: false });
  },

  async confirmAddProject() {
    const detection = get().addDetection;
    if (!detection) return;
    set({ addBusy: true });
    try {
      const result = await api().projects.add({ path: detection.path });
      if (!result.ok) {
        get().pushToast('error', `${errorHeading(result.error)}: ${result.error.message}`);
        set({ addBusy: false });
        return;
      }
      set({ addDialogOpen: false, addDetection: null, addBusy: false });
      await get().refreshProjects();
      if (result.project) {
        get().pushToast('success', `Added ${result.project.name}`);
        await get().selectProject(result.project.projectId);
      }
    } catch (err) {
      get().pushToast('error', toError(err, 'projects.add').message);
      set({ addBusy: false });
    }
  },

  async selectProject(projectId) {
    set({
      selectedProjectId: projectId,
      view: 'project',
      activeSection: 'projects',
      projectTab: 'overview',
      expandedProcess: null,
      previewUrl: null,
      previewState: null,
      previewFullscreen: false,
    });
    try {
      await api().projects.touch({ projectId });
    } catch {
      // Non-fatal.
    }
    await get().loadProcesses(projectId);
    void get().loadGit(projectId);
    void get().loadToolchains(projectId);
    void get().loadPorts(projectId);
    void get().loadTasks(projectId);

    // Auto-start processes marked runOnOpen (skip ones already running).
    const bucket = get().processesByProject[projectId];
    if (bucket) {
      for (const definition of bucket.definitions) {
        if (!definition.runOnOpen) continue;
        const runtime = bucket.runtimes.find((r) => r.processId === definition.id);
        if (runtime?.status === 'running' || runtime?.status === 'starting') continue;
        void get().startProcess(projectId, definition.id);
      }
    }
  },

  backToHub() {
    set({
      view: 'hub',
      activeSection: 'projects',
      selectedProjectId: null,
      previewFullscreen: false,
    });
  },

  async removeProject(projectId, force = false) {
    const files = get().filesByProject[projectId];
    const dirty = Object.values(files?.buffers ?? {}).some(
      (buffer) => buffer.kind === 'text' && buffer.dirty
    );
    if (dirty && !force) {
      set({ pendingProjectRemoval: projectId });
      return;
    }
    try {
      await api().processes.stopAll({ projectId });
      await api().projects.remove({ projectId });
      set({ pendingProjectRemoval: null });
      if (get().selectedProjectId === projectId) get().backToHub();
      await get().refreshProjects();
    } catch (err) {
      get().pushToast('error', toError(err, 'projects.remove').message);
    }
  },

  cancelProjectRemoval() {
    set({ pendingProjectRemoval: null });
  },

  setProjectTab(tab) {
    set(tab === 'preview' ? { projectTab: tab } : { projectTab: tab, previewFullscreen: false });
    const projectId = get().selectedProjectId;
    if (tab === 'files' && projectId) void get().ensureFilesProject(projectId);
  },

  async ensureFilesProject(projectId) {
    const existing = get().filesByProject[projectId];
    if (existing?.status === 'ready' || existing?.status === 'loading') return;
    set((s) => ({ filesByProject: { ...s.filesByProject, [projectId]: { ...(s.filesByProject[projectId] ?? createFilesProjectState()), status: 'loading', loadingPhase: 'starting', error: null, watcherStatus: 'starting' } } }));
    try {
      const configuredShowIgnored = existing?.showIgnored ?? get().settings?.files?.showIgnored ?? false;
      const rootPromise = api().files.listDirectory({ projectId, relativePath: '', showIgnored: configuredShowIgnored });
      const workspacePromise = api().files.getWorkspaceState({ projectId });
      const draftsPromise = api().files.listDrafts({ projectId });
      const watcherPromise = api().files.watchProject({ projectId });
      const [rootResult, workspaceResult, draftsResult] = await Promise.all([rootPromise, workspacePromise, draftsPromise]);
      if (!rootResult.ok) {
        void api().files.unwatchProject({ projectId });
        set((s) => ({ filesByProject: { ...s.filesByProject, [projectId]: { ...(s.filesByProject[projectId] ?? createFilesProjectState()), status: 'error', loadingPhase: 'idle', error: rootResult.error } } }));
        return;
      }

      set((s) => {
        const current = s.filesByProject[projectId] ?? createFilesProjectState();
        return { filesByProject: { ...s.filesByProject, [projectId]: {
          ...current,
          status: 'loading',
          loadingPhase: 'watching',
          showIgnored: configuredShowIgnored,
          directoryCache: { ...current.directoryCache, '': rootResult.entries },
        } } };
      });

      // The watcher keeps the tree fresh but must never gate the workspace: on a
      // large repo readiness can lag, and a failure should degrade to "no live
      // updates" rather than blank the panel. Settle its status in the background.
      const markWatcher = (status: FilesProjectState['watcherStatus']) =>
        set((s) => {
          const current = s.filesByProject[projectId];
          return current
            ? { filesByProject: { ...s.filesByProject, [projectId]: { ...current, watcherStatus: status } } }
            : {};
        });
      void watcherPromise
        .then((watcherResult) => markWatcher(watcherResult.ok ? 'ready' : 'error'))
        .catch(() => markWatcher('error'));

      const restored = get().settings?.files?.restoreSession !== false && workspaceResult.ok ? workspaceResult.state : null;
      set((s) => {
        const current = s.filesByProject[projectId] ?? createFilesProjectState();
        return { filesByProject: { ...s.filesByProject, [projectId]: {
          ...current,
          status: 'loading',
          loadingPhase: 'restoring',
          showIgnored: configuredShowIgnored,
          directoryCache: { ...current.directoryCache, '': rootResult.entries },
          tabs: restored?.openPaths ?? current.tabs,
          activePath: restored?.activePath ?? current.activePath,
          expandedPaths: restored?.expandedPaths ?? current.expandedPaths,
          recentPaths: restored?.recentPaths ?? current.recentPaths,
          pinnedPaths: restored?.pinnedPaths ?? current.pinnedPaths,
          modeByPath: restored?.modeByPath ?? current.modeByPath,
          cursorByPath: restored?.cursorByPath ?? current.cursorByPath,
        } } };
      });
      const restoredPaths = restored?.openPaths ?? [];
      for (const relativePath of restoredPaths) await get().openProjectFile(projectId, relativePath);
      if (draftsResult.ok) {
        for (const draft of draftsResult.drafts) {
          await get().openProjectFile(projectId, draft.relativePath);
          set((s) => {
            const project = s.filesByProject[projectId];
            const buffer = project?.buffers[draft.relativePath];
            if (!project || buffer?.kind !== 'text') return {};
            return { filesByProject: { ...s.filesByProject, [projectId]: { ...project, buffers: { ...project.buffers, [draft.relativePath]: { ...buffer, content: draft.content, dirty: true, recovered: true, conflict: draft.baseRevision?.hash !== buffer.document.revision.hash } } } } };
          });
        }
      }
      if (restoredPaths.length === 0 && (!draftsResult.ok || draftsResult.drafts.length === 0)) {
        const readme = rootResult.entries.find((entry) => entry.kind !== 'directory' && /^readme(?:\.[^/]*)?$/i.test(entry.name));
        if (readme) await get().openProjectFile(projectId, readme);
        else {
          const docs = rootResult.entries.find((entry) => entry.kind === 'directory' && entry.name.toLocaleLowerCase() === 'docs');
          if (docs) {
            await get().loadFileDirectory(projectId, docs.relativePath);
            const docsEntries = get().filesByProject[projectId]?.directoryCache[docs.relativePath] ?? [];
            const docsStart = docsEntries.find((entry) => /^(readme|index)(?:\.(md|mdx|markdown))?$/i.test(entry.name));
            if (docsStart) await get().openProjectFile(projectId, docsStart);
          }
        }
      }
      const restoredActivePath = restored?.activePath;
      if (restoredActivePath && get().filesByProject[projectId]?.buffers[restoredActivePath]) {
        get().setActiveFile(projectId, restoredActivePath);
      }
      set((s) => {
        const current = s.filesByProject[projectId];
        if (!current) return {};
        // Keep whatever watcherStatus the background settle produced — don't
        // optimistically claim 'ready' before the watcher has actually settled.
        return { filesByProject: { ...s.filesByProject, [projectId]: { ...current, status: 'ready', loadingPhase: 'idle', error: null } } };
      });
    } catch (err) {
      const error = toError(err, 'files.initialize');
      set((s) => ({ filesByProject: { ...s.filesByProject, [projectId]: { ...(s.filesByProject[projectId] ?? createFilesProjectState()), status: 'error', loadingPhase: 'idle', error } } }));
    }
  },

  async loadFileDirectory(projectId, relativePath) {
    const project = get().filesByProject[projectId];
    const result = await api().files.listDirectory({ projectId, relativePath, showIgnored: project?.showIgnored ?? false });
    if (!result.ok) { get().pushToast('error', result.error.message); return; }
    set((s) => {
      const current = s.filesByProject[projectId] ?? createFilesProjectState();
      return { filesByProject: { ...s.filesByProject, [projectId]: { ...current, directoryCache: { ...current.directoryCache, [relativePath]: result.entries } } } };
    });
  },

  async openProjectFile(projectId, entryOrPath) {
    const relativePath = typeof entryOrPath === 'string' ? entryOrPath : entryOrPath.relativePath;
    const knownKind = typeof entryOrPath === 'string' ? undefined : entryOrPath.kind;
    const project = get().filesByProject[projectId] ?? createFilesProjectState();
    if (project.buffers[relativePath]) { get().setActiveFile(projectId, relativePath); return; }
    if (knownKind === 'directory') { await get().toggleFileDirectory(projectId, relativePath); return; }
    const image = knownKind === 'image' || /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i.test(relativePath);
    if (image) {
      const result = await api().files.readImage({ projectId, relativePath });
      if (!result.ok) { get().pushToast('error', result.error.message); return; }
      const bytes = result.document.bytes.slice();
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: result.document.mimeType }));
      set((s) => {
        const current = s.filesByProject[projectId] ?? createFilesProjectState();
        const next = { ...current, tabs: [...current.tabs.filter((item) => item !== relativePath), relativePath], activePath: relativePath, selectedPath: relativePath, recentPaths: [relativePath, ...current.recentPaths.filter((item) => item !== relativePath)].slice(0, 50), buffers: { ...current.buffers, [relativePath]: { kind: 'image' as const, document: result.document, objectUrl } } };
        persistFilesWorkspace(projectId, next);
        return { filesByProject: { ...s.filesByProject, [projectId]: next } };
      });
      return;
    }
    const result = await api().files.readText({ projectId, relativePath });
    if (!result.ok) { get().pushToast('error', result.error.message); return; }
    set((s) => {
      const current = s.filesByProject[projectId] ?? createFilesProjectState();
      const next = { ...current, tabs: [...current.tabs.filter((item) => item !== relativePath), relativePath], activePath: relativePath, selectedPath: relativePath, recentPaths: [relativePath, ...current.recentPaths.filter((item) => item !== relativePath)].slice(0, 50), modeByPath: { ...current.modeByPath, [relativePath]: result.document.languageId === 'markdown' ? (current.modeByPath[relativePath] ?? 'preview') : 'edit' }, buffers: { ...current.buffers, [relativePath]: { kind: 'text' as const, document: result.document, content: result.document.content, dirty: false, conflict: false, missing: false, recovered: false, saveError: null } } };
      persistFilesWorkspace(projectId, next);
      return { filesByProject: { ...s.filesByProject, [projectId]: next } };
    });
  },

  updateFileBuffer(projectId, relativePath, content) {
    set((s) => {
      const project = s.filesByProject[projectId];
      const buffer = project?.buffers[relativePath];
      if (!project || buffer?.kind !== 'text' || buffer.document.readOnly) return {};
      const nextBuffer: FileBufferState = { ...buffer, content, dirty: content !== buffer.document.content, saveError: null };
      return { filesByProject: { ...s.filesByProject, [projectId]: { ...project, buffers: { ...project.buffers, [relativePath]: nextBuffer } } } };
    });
    const key = `${projectId}:${relativePath}`;
    const prior = draftTimers.get(key);
    if (prior) clearTimeout(prior);
    draftTimers.set(key, setTimeout(() => {
      draftTimers.delete(key);
      const buffer = get().filesByProject[projectId]?.buffers[relativePath];
      if (buffer?.kind !== 'text' || !buffer.dirty) return;
      const lineEnding: Exclude<LineEnding, 'mixed'> = buffer.document.lineEnding === 'mixed' ? 'lf' : buffer.document.lineEnding;
      void api().files.putDraft({ draft: { projectId, relativePath, content: buffer.content, baseRevision: buffer.document.revision, encoding: buffer.document.encoding, lineEnding, updatedAt: new Date().toISOString() } });
    }, 500));
  },

  async saveFile(projectId, relativePath, force = false) {
    const buffer = get().filesByProject[projectId]?.buffers[relativePath];
    if (buffer?.kind !== 'text' || !buffer.dirty) return true;
    if (buffer.document.lineEnding === 'mixed') {
      get().pushToast('error', 'Choose LF, CRLF, or CR before saving a file with mixed line endings.');
      return false;
    }
    const result = await api().files.saveText({ projectId, relativePath, content: buffer.content, expectedRevision: buffer.document.revision, encoding: buffer.document.encoding, lineEnding: buffer.document.lineEnding, force });
    if (!result.ok) {
      set((s) => {
        const project = s.filesByProject[projectId];
        const current = project?.buffers[relativePath];
        if (!project || current?.kind !== 'text') return {};
        return { filesByProject: { ...s.filesByProject, [projectId]: { ...project, buffers: { ...project.buffers, [relativePath]: { ...current, conflict: result.error.code === 'FILE_CONFLICT' || current.conflict, saveError: result.error } } } } };
      });
      get().pushToast('error', result.error.message);
      return false;
    }
    set((s) => {
      const project = s.filesByProject[projectId];
      const current = project?.buffers[relativePath];
      if (!project || current?.kind !== 'text') return {};
      return { filesByProject: { ...s.filesByProject, [projectId]: { ...project, buffers: { ...project.buffers, [relativePath]: { ...current, document: { ...current.document, content: current.content, revision: result.revision }, dirty: false, conflict: false, missing: false, recovered: false, saveError: null } } } } };
    });
    await api().files.removeDraft({ projectId, relativePath });
    get().pushToast('success', `Saved ${relativePath.split('/').pop() ?? relativePath}`);
    window.setTimeout(() => { void get().loadGit(projectId); }, 180);
    return true;
  },

  async saveAllFiles(projectId) {
    const project = get().filesByProject[projectId];
    if (!project) return true;
    for (const relativePath of project.tabs) if (!(await get().saveFile(projectId, relativePath))) return false;
    return true;
  },

  closeFile(projectId, relativePath, discard = false) {
    const project = get().filesByProject[projectId];
    const buffer = project?.buffers[relativePath];
    if (!project || (!discard && buffer?.kind === 'text' && buffer.dirty)) return;
    if (buffer?.kind === 'image') URL.revokeObjectURL(buffer.objectUrl);
    const buffers = { ...project.buffers };
    delete buffers[relativePath];
    const tabs = project.tabs.filter((item) => item !== relativePath);
    const closedIndex = project.tabs.indexOf(relativePath);
    const activePath = project.activePath === relativePath ? (tabs[Math.min(closedIndex, tabs.length - 1)] ?? null) : project.activePath;
    const next = { ...project, tabs, activePath, buffers };
    set((s) => ({ filesByProject: { ...s.filesByProject, [projectId]: next } }));
    persistFilesWorkspace(projectId, next);
    if (discard) void api().files.removeDraft({ projectId, relativePath });
  },

  closeDeletedFiles(projectId, relativePath) {
    const project = get().filesByProject[projectId];
    if (!project) return;
    const bufferKeys = Object.keys(project.buffers);
    const victims = new Set([
      ...pathsAffectedByDelete(project.tabs, relativePath),
      ...pathsAffectedByDelete(bufferKeys, relativePath),
    ]);
    for (const path of victims) get().closeFile(projectId, path, true);
    set((s) => {
      const current = s.filesByProject[projectId];
      if (!current) return {};
      const selectedPath =
        current.selectedPath && isPathDeleted(current.selectedPath, relativePath)
          ? null
          : current.selectedPath;
      const next = {
        ...current,
        selectedPath,
        recentPaths: current.recentPaths.filter((path) => !isPathDeleted(path, relativePath)),
        pinnedPaths: current.pinnedPaths.filter((path) => !isPathDeleted(path, relativePath)),
      };
      persistFilesWorkspace(projectId, next);
      return { filesByProject: { ...s.filesByProject, [projectId]: next } };
    });
  },

  setActiveFile(projectId, relativePath) {
    set((s) => {
      const project = s.filesByProject[projectId];
      if (!project) return {};
      const next = { ...project, activePath: relativePath, selectedPath: relativePath };
      persistFilesWorkspace(projectId, next);
      return { filesByProject: { ...s.filesByProject, [projectId]: next } };
    });
  },

  reorderFileTabs(projectId, sourcePath, targetPath, place = 'before') {
    set((s) => {
      const project = s.filesByProject[projectId];
      if (!project) return {};
      const tabs = moveTabRelative(project.tabs, sourcePath, targetPath, place);
      if (tabs === project.tabs || tabs.every((path, index) => path === project.tabs[index])) return {};
      const next = { ...project, tabs };
      persistFilesWorkspace(projectId, next);
      return { filesByProject: { ...s.filesByProject, [projectId]: next } };
    });
  },

  togglePinnedFile(projectId, relativePath) {
    set((s) => {
      const project = s.filesByProject[projectId];
      if (!project) return {};
      const pinnedPaths = project.pinnedPaths.includes(relativePath)
        ? project.pinnedPaths.filter((path) => path !== relativePath)
        : [relativePath, ...project.pinnedPaths].slice(0, 50);
      const next = { ...project, pinnedPaths };
      persistFilesWorkspace(projectId, next);
      return { filesByProject: { ...s.filesByProject, [projectId]: next } };
    });
  },

  setFileMode(projectId, relativePath, mode) {
    set((s) => {
      const project = s.filesByProject[projectId];
      if (!project) return {};
      const next = { ...project, modeByPath: { ...project.modeByPath, [relativePath]: mode } };
      persistFilesWorkspace(projectId, next);
      return { filesByProject: { ...s.filesByProject, [projectId]: next } };
    });
  },

  setFileCursor(projectId, relativePath, line, column) {
    set((s) => {
      const project = s.filesByProject[projectId];
      if (!project) return {};
      return { filesByProject: { ...s.filesByProject, [projectId]: { ...project, cursorByPath: { ...project.cursorByPath, [relativePath]: { line, column, scrollTop: project.cursorByPath[relativePath]?.scrollTop ?? 0 } } } } };
    });
  },

  setFileLineEnding(projectId, relativePath, lineEnding) {
    set((s) => {
      const project = s.filesByProject[projectId];
      const buffer = project?.buffers[relativePath];
      if (!project || buffer?.kind !== 'text') return {};
      return { filesByProject: { ...s.filesByProject, [projectId]: { ...project, buffers: { ...project.buffers, [relativePath]: { ...buffer, document: { ...buffer.document, lineEnding }, dirty: true } } } } };
    });
  },

  setFileReadingProgress(projectId, relativePath, progress) {
    set((s) => {
      const project = s.filesByProject[projectId];
      if (!project) return {};
      return { filesByProject: { ...s.filesByProject, [projectId]: { ...project, readingProgressByPath: { ...project.readingProgressByPath, [relativePath]: Math.max(0, Math.min(100, progress)) } } } };
    });
  },

  async toggleFileDirectory(projectId, relativePath) {
    const project = get().filesByProject[projectId] ?? createFilesProjectState();
    const expanded = project.expandedPaths.includes(relativePath);
    if (!expanded && !project.directoryCache[relativePath]) await get().loadFileDirectory(projectId, relativePath);
    set((s) => {
      const current = s.filesByProject[projectId] ?? createFilesProjectState();
      const next = { ...current, expandedPaths: expanded ? current.expandedPaths.filter((item) => item !== relativePath) : [...current.expandedPaths, relativePath], selectedPath: relativePath };
      persistFilesWorkspace(projectId, next);
      return { filesByProject: { ...s.filesByProject, [projectId]: next } };
    });
  },

  setFilesSelection(projectId, relativePath) {
    set((s) => {
      const project = s.filesByProject[projectId];
      return project ? { filesByProject: { ...s.filesByProject, [projectId]: { ...project, selectedPath: relativePath } } } : {};
    });
  },

  async setFilesShowIgnored(projectId, showIgnored) {
    set((s) => {
      const project = s.filesByProject[projectId];
      return project ? { filesByProject: { ...s.filesByProject, [projectId]: { ...project, showIgnored, directoryCache: {} } } } : {};
    });
    await get().loadFileDirectory(projectId, '');
  },

  async searchProjectFiles(projectId, query, caseSensitive = false, wholeWord = false) {
    await get().cancelProjectSearch(projectId);
    if (!query.trim()) return;
    const searchId = crypto.randomUUID();
    set((s) => {
      const project = s.filesByProject[projectId] ?? createFilesProjectState();
      return { filesByProject: { ...s.filesByProject, [projectId]: { ...project, search: { searchId, query, matches: [], running: true, truncated: false, visitedFiles: 0, error: null } } } };
    });
    const result = await api().files.startSearch({ projectId, searchId, query, caseSensitive, wholeWord, showIgnored: get().filesByProject[projectId]?.showIgnored });
    if (!result.ok) {
      set((s) => {
        const project = s.filesByProject[projectId];
        if (!project || project.search.searchId !== searchId) return {};
        return {
          filesByProject: {
            ...s.filesByProject,
            [projectId]: {
              ...project,
              search: { ...project.search, running: false, error: result.error.message },
            },
          },
        };
      });
      get().pushToast('error', result.error.message);
    }
  },

  async cancelProjectSearch(projectId) {
    const searchId = get().filesByProject[projectId]?.search.searchId;
    if (searchId) await api().files.cancelSearch({ projectId, searchId });
  },

  async reloadFileFromDisk(projectId, relativePath) {
    const result = await api().files.readText({ projectId, relativePath });
    if (!result.ok) return;
    set((s) => {
      const project = s.filesByProject[projectId];
      const current = project?.buffers[relativePath];
      if (!project || current?.kind !== 'text' || current.dirty) return {};
      return { filesByProject: { ...s.filesByProject, [projectId]: { ...project, buffers: { ...project.buffers, [relativePath]: { ...current, document: result.document, content: result.document.content, conflict: false, missing: false } } } } };
    });
  },

  async loadProcesses(projectId) {
    try {
      const processes = await api().processes.list({ projectId });
      set((s) => ({ processesByProject: { ...s.processesByProject, [projectId]: processes } }));
    } catch (err) {
      get().pushToast('error', toError(err, 'processes.list').message);
    }
  },

  async saveProcessDefinition(projectId, definition) {
    try {
      const processes = await api().processes.saveDefinition({ projectId, definition });
      set((s) => ({ processesByProject: { ...s.processesByProject, [projectId]: processes } }));
      get().pushToast('success', `Saved ${definition.label}`);
    } catch (err) {
      get().pushToast('error', toError(err, 'processes.saveDefinition').message);
    }
  },

  async removeProcessDefinition(projectId, processId) {
    try {
      const processes = await api().processes.removeDefinition({ projectId, processId });
      set((s) => ({ processesByProject: { ...s.processesByProject, [projectId]: processes } }));
      get().pushToast('success', 'Process removed');
    } catch (err) {
      get().pushToast('error', toError(err, 'processes.removeDefinition').message);
    }
  },

  async loadToolchains(projectId) {
    try {
      const toolchains = await api().toolchains.get({ projectId });
      set((s) => ({ toolchainsByProject: { ...s.toolchainsByProject, [projectId]: toolchains } }));
    } catch (err) {
      get().pushToast('error', toError(err, 'toolchains.get').message);
    }
  },

  async loadPorts(projectId) {
    try {
      const ports = await api().ports.list({ projectId });
      set((s) => ({ portsByProject: { ...s.portsByProject, [projectId]: ports } }));
    } catch (err) {
      get().pushToast('error', toError(err, 'ports.list').message);
    }
  },

  async loadTasks(projectId) {
    try {
      const tasks = await api().tasks.list({ projectId });
      set((s) => ({ tasksByProject: { ...s.tasksByProject, [projectId]: tasks } }));
    } catch (err) {
      get().pushToast('error', toError(err, 'tasks.list').message);
    }
  },

  async setActiveToolchain(projectId, kind, version) {
    const result = await api().toolchains.setActive({ projectId, kind, version });
    if (!result.ok) {
      get().pushToast('error', `${errorHeading(result.error)}: ${result.error.message}`);
      return;
    }
    set((s) => ({
      toolchainsByProject: { ...s.toolchainsByProject, [projectId]: result.toolchains },
    }));
    get().pushToast('success', `${kind} set to ${version}`);
  },

  async killPort(pid, port) {
    const result = await api().ports.kill({ pid, port });
    if (!result.ok) {
      get().pushToast('error', `${errorHeading(result.error)}: ${result.error.message}`);
      return;
    }
    get().pushToast('success', `Stopped process on port ${port}`);
    const projectId = get().selectedProjectId;
    if (projectId) void get().loadPorts(projectId);
  },

  async runTask(projectId, taskId) {
    const result = await api().tasks.run({ projectId, taskId });
    if (!result.ok) {
      get().pushToast('error', `${errorHeading(result.error)}: ${result.error.message}`);
      return;
    }
    await get().loadProcesses(projectId);
    get().pushToast('success', 'Task started');
  },

  async toggleProcess(projectId, processId) {
    const key = processKey(projectId, processId);
    if (get().expandedProcess === key) {
      set({ expandedProcess: null });
      return;
    }
    set({ expandedProcess: key });
    if (!get().logsByProject[key]) {
      try {
        const snapshot = await api().processes.getLog({ projectId, processId });
        set((s) => ({ logsByProject: { ...s.logsByProject, [key]: snapshot.lines } }));
      } catch {
        // Non-fatal.
      }
    }
  },

  async startProcess(projectId, processId) {
    const key = processKey(projectId, processId);
    set((s) => ({ pendingProcesses: { ...s.pendingProcesses, [key]: 'starting' } }));
    const result = await api().processes.start({ projectId, processId });
    if (!result.ok) {
      set((s) => ({ pendingProcesses: omitKey(s.pendingProcesses, key) }));
      get().pushToast('error', `${errorHeading(result.error)}: ${result.error.message}`);
    }
  },

  async stopProcess(projectId, processId) {
    const key = processKey(projectId, processId);
    set((s) => ({ pendingProcesses: { ...s.pendingProcesses, [key]: 'stopping' } }));
    const result = await api().processes.stop({ projectId, processId });
    if (!result.ok) {
      set((s) => ({ pendingProcesses: omitKey(s.pendingProcesses, key) }));
      get().pushToast('error', result.error.message);
    }
  },

  async restartProcess(projectId, processId) {
    const key = processKey(projectId, processId);
    set((s) => ({ pendingProcesses: { ...s.pendingProcesses, [key]: 'restarting' } }));
    const result = await api().processes.restart({ projectId, processId });
    if (!result.ok) {
      set((s) => ({ pendingProcesses: omitKey(s.pendingProcesses, key) }));
      get().pushToast('error', `${errorHeading(result.error)}: ${result.error.message}`);
    }
  },

  async startAllProcesses(projectId) {
    const bucket = get().processesByProject[projectId];
    if (!bucket) return;
    const active = new Set(
      bucket.runtimes
        .filter((r) => r.status === 'running' || r.status === 'starting')
        .map((r) => r.processId)
    );
    const pending = bucket.definitions.filter((d) => !active.has(d.id));
    if (pending.length === 0) return;
    for (const definition of pending) {
      const result = await api().processes.start({ projectId, processId: definition.id });
      if (!result.ok) {
        get().pushToast('error', `${errorHeading(result.error)}: ${result.error.message}`);
      }
    }
  },

  async stopAllProcesses(projectId) {
    const bucket = get().processesByProject[projectId];
    if (bucket) {
      const pending = { ...get().pendingProcesses };
      for (const runtime of bucket.runtimes) {
        if (runtime.status === 'running' || runtime.status === 'starting') {
          pending[processKey(projectId, runtime.processId)] = 'stopping';
        }
      }
      set({ pendingProcesses: pending });
    }
    await api().processes.stopAll({ projectId });
  },

  async loadGit(projectId) {
    try {
      const snapshot = await api().git.snapshot({ projectId });
      set((s) => ({ gitByProject: { ...s.gitByProject, [projectId]: snapshot } }));
    } catch {
      // Non-fatal — the git card simply won't render.
    }
  },

  setAndroidWorkspace(projectId, patch) {
    set((s) => ({
      androidByProject: {
        ...s.androidByProject,
        [projectId]: {
          ...(s.androidByProject[projectId] ?? createAndroidWorkspaceState()),
          ...patch,
        },
      },
    }));
  },

  async openInEditor() {
    const projectId = get().selectedProjectId;
    if (!projectId) return;
    const result = await api().system.openInEditor({ projectId });
    if (!result.ok) get().pushToast('error', result.error.message);
  },

  async openInTerminal() {
    const projectId = get().selectedProjectId;
    if (!projectId) return;
    const result = await api().system.openInTerminal({ projectId });
    if (!result.ok) get().pushToast('error', result.error.message);
  },

  async openInExplorer() {
    const projectId = get().selectedProjectId;
    if (!projectId) return;
    const result = await api().system.openInExplorer({ projectId });
    if (!result.ok) get().pushToast('error', result.error.message);
  },

  openUrlInPreview(url) {
    set((s) => ({
      projectTab: 'preview',
      previewUrl: url,
      previewRecents: [url, ...s.previewRecents.filter((entry) => entry !== url)].slice(0, 8),
    }));
    void api().preview.navigate({ url });
  },

  previewNavigate(url) {
    set((s) => ({
      previewUrl: url,
      previewRecents: [url, ...s.previewRecents.filter((entry) => entry !== url)].slice(0, 8),
    }));
    void api().preview.navigate({ url });
  },

  previewReload() {
    void api().preview.reload();
  },

  previewReloadHard() {
    void api().preview.reloadHard();
  },

  previewBack() {
    void api().preview.back();
  },

  previewForward() {
    void api().preview.forward();
  },

  previewOpenExternal() {
    const url = get().previewState?.currentUrl ?? get().previewUrl;
    if (url) void api().preview.openExternal({ url });
  },

  previewOpenDevTools() {
    void api().preview.openDevTools();
  },

  setPreviewZoom(factor) {
    void api().preview.setZoom({ factor });
  },

  clearPreviewConsole() {
    set({ previewConsole: [] });
    void api().preview.clearConsole();
  },

  togglePreviewConsole() {
    set((s) => ({ previewConsoleOpen: !s.previewConsoleOpen }));
  },

  setPreviewViewport(preset) {
    set({ previewViewport: preset });
  },

  togglePreviewRotate() {
    set((s) => ({ previewRotated: !s.previewRotated }));
  },

  togglePreviewFullscreen() {
    set((s) => ({ previewFullscreen: !s.previewFullscreen }));
  },

  setPreviewFullscreen(value) {
    set({ previewFullscreen: value });
  },

  openPalette() {
    set({ paletteOpen: true });
  },
  closePalette() {
    set({ paletteOpen: false });
  },
  togglePalette() {
    set((s) => ({ paletteOpen: !s.paletteOpen }));
  },

  completeOnboarding() {
    set({ onboardingOpen: false });
    // Stamp the running version so onboarding never re-shows (Skip and Finish
    // both call this). updateSettings persists the flag.
    const completedVersion = get().capabilities?.appVersion ?? '0.0.0';
    void get().updateSettings({ onboarding: { completedVersion } });
  },

  openContextMenu(menu) {
    set({ contextMenu: menu });
  },
  closeContextMenu() {
    set({ contextMenu: null });
  },

  async updateSettings(patch) {
    try {
      get().applySettings(await api().settings.update(patch));
    } catch (err) {
      set({ globalError: toError(err, 'settings.update') });
    }
  },

  applySettings(settings) {
    applyAppearance(settings.appearance);
    set({ settings });
  },

  async setEditorPreset(preset) {
    try {
      get().applySettings(await api().settings.setEditorPreset({ preset }));
    } catch (err) {
      get().pushToast('error', toError(err, 'settings.setEditorPreset').message);
    }
  },

  async chooseCustomEditor() {
    try {
      get().applySettings(await api().settings.chooseCustomEditor());
    } catch (err) {
      get().pushToast('error', toError(err, 'settings.chooseCustomEditor').message);
    }
  },

  async setTerminalPreset(preset) {
    try {
      get().applySettings(await api().settings.setTerminalPreset({ preset }));
    } catch (err) {
      get().pushToast('error', toError(err, 'settings.setTerminalPreset').message);
    }
  },

  async chooseCustomTerminal() {
    try {
      get().applySettings(await api().settings.chooseCustomTerminal());
    } catch (err) {
      get().pushToast('error', toError(err, 'settings.chooseCustomTerminal').message);
    }
  },

  async toggleTheme() {
    const current = get().settings?.appearance.theme ?? 'dark';
    const next: ThemePreference = current === 'dark' ? 'light' : 'dark';
    await get().updateSettings({ appearance: { theme: next } });
    get().announce(`Theme set to ${next}`);
  },

  announce(message) {
    set((s) => ({ announcements: [...s.announcements.slice(-9), message] }));
  },

  pushToast(tone, message) {
    const toast: Toast = { id: ++toastId, tone, message };
    set((s) => ({ toasts: [...s.toasts, toast] }));
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  confirmQuit() {
    set({ closePrompt: null });
    void api().app.confirmQuit();
  },

  async saveAllAndQuit() {
    for (const projectId of Object.keys(get().filesByProject)) {
      if (!(await get().saveAllFiles(projectId))) {
        get().pushToast('error', 'Bureau remains open because one or more files could not be saved.');
        return;
      }
    }
    set({ closePrompt: null });
    await api().app.confirmQuit();
  },

  discardAllAndQuit() {
    for (const [projectId, project] of Object.entries(get().filesByProject)) {
      for (const relativePath of [...project.tabs]) get().closeFile(projectId, relativePath, true);
    }
    set({ closePrompt: null });
    void api().app.confirmQuit();
  },

  cancelQuit() {
    set({ closePrompt: null });
    void api().app.cancelQuit();
  },
}));

let reportedDirtyFiles = -1;
useAppStore.subscribe((state) => {
  let count = 0;
  for (const project of Object.values(state.filesByProject)) {
    for (const buffer of Object.values(project.buffers)) {
      if (buffer.kind === 'text' && buffer.dirty) count += 1;
    }
  }
  if (count === reportedDirtyFiles) return;
  const setter = window.bureau?.app?.setDirtyFiles;
  if (!setter) return;
  reportedDirtyFiles = count;
  void setter({ count });
});

export function selectProcessDefinitions(state: AppState, projectId: string): ProcessDefinition[] {
  return state.processesByProject[projectId]?.definitions ?? [];
}

export function selectRunningCount(state: AppState): number {
  let count = 0;
  for (const bucket of Object.values(state.processesByProject)) {
    for (const runtime of bucket.runtimes) {
      if (runtime.status === 'running' || runtime.status === 'starting') count += 1;
    }
  }
  return count;
}
