// Editor / terminal presets are shared with the launcher services (ported from StarGit).

export type EditorPreset = 'vscode' | 'cursor' | 'zed' | 'sublime';

export type EditorConfig =
  | { kind: 'none' }
  | { kind: 'preset'; preset: EditorPreset }
  | { kind: 'custom'; executablePath: string };

export type TerminalPreset =
  | 'windows-terminal'
  | 'powershell'
  | 'cmd'
  | 'terminal-app'
  | 'gnome-terminal'
  | 'konsole'
  | 'xfce4-terminal'
  | 'alacritty'
  | 'xterm';

export type TerminalConfig =
  | { kind: 'auto' }
  | { kind: 'preset'; preset: TerminalPreset }
  | { kind: 'custom'; executablePath: string };

export type ThemePreference = 'dark' | 'light' | 'system';
export type DensityPreference = 'compact' | 'comfortable';
export type StartupViewPreference = 'hub' | 'lastOpened';
export type PullStrategy = 'ff-only' | 'merge' | 'rebase';

/** App-wide interface scale. Applied as CSS `zoom` on the document root. */
export type UiScale = 0.9 | 1 | 1.1 | 1.25 | 1.5;
export const UI_SCALES: readonly UiScale[] = [0.9, 1, 1.1, 1.25, 1.5];

export type RefreshIntervalMs = 0 | 5000 | 15000 | 30000 | 60000;

/** Preview surface sizes. Canonical list; the renderer's ViewportPreset aliases this. */
export const VIEWPORT_PRESETS = ['fill', 'mobile', 'tablet', 'desktop'] as const;
export type ViewportPreset = (typeof VIEWPORT_PRESETS)[number];

export type LogBufferLines = 1000 | 5000 | 10000 | 20000;
export const LOG_BUFFER_CHOICES: readonly LogBufferLines[] = [1000, 5000, 10000, 20000];

/** 0 = never auto-restart a crashing process. */
export type MaxCrashRestarts = 0 | 3 | 5 | 10;
export const MAX_CRASH_RESTART_CHOICES: readonly MaxCrashRestarts[] = [0, 3, 5, 10];

export type ProcessesSettings = {
  /** Log lines the renderer keeps per process before dropping the oldest. */
  logBufferLines: LogBufferLines;
  /** Consecutive crashes before Bureau stops auto-restarting a process. */
  maxCrashRestarts: MaxCrashRestarts;
};

export type PreviewSettings = {
  /** Viewport the preview opens with. */
  defaultViewport: ViewportPreset;
  /** Capture the previewed page's console output into the Preview console. */
  captureConsole: boolean;
};

export type TerminalFontSize = 11 | 12 | 13 | 14;
export const TERMINAL_FONT_SIZES: readonly TerminalFontSize[] = [11, 12, 13, 14];
export type TerminalScrollback = 1000 | 5000 | 10000;
export const TERMINAL_SCROLLBACKS: readonly TerminalScrollback[] = [1000, 5000, 10000];
export const TERMINAL_CURSOR_STYLES = ['block', 'underline', 'bar'] as const;
export type TerminalCursorStyle = (typeof TERMINAL_CURSOR_STYLES)[number];

/**
 * The embedded xterm pane. Named apart from `terminal`, which is the *external*
 * terminal launcher config (a discriminated union).
 */
export type EmbeddedTerminalSettings = {
  fontSize: TerminalFontSize;
  scrollback: TerminalScrollback;
  cursorStyle: TerminalCursorStyle;
};

export type EditorFontSize = 12 | 13 | 14 | 16;
export const EDITOR_FONT_SIZES: readonly EditorFontSize[] = [12, 13, 14, 16];

export type PaneWidthSettings = {
  files: number;
  commit: number;
  filesExplorer?: number;
};

export type FilesSettings = {
  wordWrap: boolean;
  showIgnored: boolean;
  restoreSession: boolean;
  autoReloadClean: boolean;
  allowRawHtml: boolean;
  remoteImages: 'ask' | 'block';
  tabSize: 2 | 4;
  readerWidth: 'narrow' | 'standard' | 'wide';
  /** Code editor type size. Independent of the app-wide uiScale, which also applies. */
  editorFontSize: EditorFontSize;
  /** Show the code editor's line-number gutter. */
  lineNumbers: boolean;
};

export type GeneralSettings = {
  startupView: StartupViewPreference;
  confirmBeforeQuit: boolean;
  refreshIntervalMs: RefreshIntervalMs;
  refreshOnFocus: boolean;
};

export type GitBehaviorSettings = {
  pullStrategy: PullStrategy;
};

export type HistorySettings = {
  commitLimit: number;
};

/** Each key gates one destructive git action; true = ask before running it. */
export type ConfirmationSettings = {
  discardChanges: boolean;
  deleteBranch: boolean;
  dropStash: boolean;
  amendCommit: boolean;
  conflictOverwrite: boolean;
  deleteRemoteBranch: boolean;
  deleteRemoteTag: boolean;
  /** Abort an in-progress merge/rebase/cherry-pick/revert (discards the work). */
  abortOperation: boolean;
  /** Skip the current commit during a rebase/cherry-pick/revert (discards its changes). */
  skipCommit: boolean;
  /** Pop a stash (drops it on success and can conflict). */
  stashPop: boolean;
  /** Restore file(s) from a stash over the working tree. */
  restoreStashFiles: boolean;
  /** Check out the recorded commit into a submodule's working tree. */
  submoduleUpdate: boolean;
  /** Prune stale worktree administrative entries. */
  pruneWorktrees: boolean;
  /** Merge another branch into the current one (rewrites the working tree, can conflict). */
  mergeBranch: boolean;
  /** Rebase the current branch onto another (rewrites the current branch's history). */
  rebaseBranch: boolean;
  /**
   * Move the current branch to another commit with `reset --soft`/`--mixed`. Working-tree
   * files survive, and the reflog can restore the old HEAD.
   */
  resetBranch: boolean;
  /**
   * `reset --hard`. Kept apart from `resetBranch` on purpose: it is the only reset that
   * overwrites the working tree, and uncommitted work it destroys is in no reflog — so
   * turning the soft/mixed prompt off must not also disarm this one.
   */
  resetHard: boolean;
  /**
   * Check out a commit directly, detaching HEAD. Nothing is destroyed, but landing on
   * no branch is a state users reach by accident and struggle to get out of.
   */
  checkoutCommit: boolean;
  /**
   * Remove a remote. The remote's URL and its remote-tracking branches go with it, and
   * Bureau cannot put them back — but the commits themselves are untouched.
   */
  removeRemote: boolean;
};

export type CommitSettings = {
  defaultSignOff: boolean;
  signingPreference: 'config' | 'off';
  commitTemplate?: string;
};

/** Canonical id + default order of the per-project workspace tabs. */
export const PROJECT_TAB_IDS = [
  'overview',
  'files',
  'processes',
  'preview',
  'android',
  'toolchains',
  'ports',
  'git',
] as const;
export type ProjectTabId = (typeof PROJECT_TAB_IDS)[number];

export type AppearanceSettings = {
  theme: ThemePreference;
  density: DensityPreference;
  accentColor: string;
  /** Auto-hide the project rail; reveal it from the workspace edge. */
  immersiveMode: boolean;
  /**
   * Force-reduce animations even when the OS does not ask for it. The app always
   * honours `prefers-reduced-motion: reduce`; this only adds an app-level override.
   */
  reduceMotion: boolean;
  /** App-wide interface scale; 1 = 100%. */
  uiScale: UiScale;
  /**
   * User-chosen order of the per-project workspace tabs. Omitted = the default
   * PROJECT_TAB_IDS order. Sanitised at read time (unknown ids dropped, missing
   * ones appended) so it survives tabs being added or removed across versions.
   */
  projectTabOrder?: ProjectTabId[];
};

export type ToolsVisibilitySettings = {
  showOpenInEditor: boolean;
  showOpenInTerminal: boolean;
  showOpenInExplorer: boolean;
};

export type LayoutSettings = {
  paneWidths: PaneWidthSettings;
};

export type NotificationSettings = {
  enabled: boolean;
  longRunningOnly: boolean;
};

export type AndroidSettings = {
  sdkPath?: string;
  scrcpyPath?: string;
  defaultLogcatPriority: 'V' | 'D' | 'I' | 'W' | 'E' | 'F' | 'S';
  defaultLogcatFilter: string;
  reactNativeMetroPort: number;
  reactNativeAutoReverse: boolean;
};

export type ToolchainsSettings = {
  preferredNodeManager?: 'fnm' | 'volta' | 'nvm' | 'system';
  preferredPythonManager?: 'pyenv' | 'venv' | 'system';
  preferredFlutterManager?: 'fvm' | 'flutter';
};

export type WindowBounds = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
};

/** First-run onboarding state. `completedVersion` is null until the tour is finished. */
export type OnboardingSettings = {
  completedVersion: string | null;
};

/** Settings shape sent to the renderer (file-only fields like updatedAt are stripped). */
export type PublicSettings = {
  schemaVersion: number;
  git: {
    executablePath?: string;
  };
  editor: EditorConfig;
  terminal: TerminalConfig;
  window?: WindowBounds;
  general: GeneralSettings;
  appearance: AppearanceSettings;
  gitBehavior: GitBehaviorSettings;
  tools: ToolsVisibilitySettings;
  layout: LayoutSettings;
  history: HistorySettings;
  confirmations: ConfirmationSettings;
  commit: CommitSettings;
  notifications: NotificationSettings;
  android: AndroidSettings;
  toolchains: ToolchainsSettings;
  processes: ProcessesSettings;
  preview: PreviewSettings;
  embeddedTerminal: EmbeddedTerminalSettings;
  files?: FilesSettings;
  onboarding: OnboardingSettings;
};

/** Deep-partial patch from the renderer. */
export type SettingsPatch = {
  git?: { executablePath?: string | null };
  editor?: EditorConfig;
  terminal?: TerminalConfig;
  general?: Partial<GeneralSettings>;
  appearance?: Partial<AppearanceSettings>;
  gitBehavior?: Partial<GitBehaviorSettings>;
  tools?: Partial<ToolsVisibilitySettings>;
  layout?: {
    paneWidths?: Partial<PaneWidthSettings>;
  };
  history?: Partial<HistorySettings>;
  confirmations?: Partial<ConfirmationSettings>;
  commit?: Partial<CommitSettings>;
  notifications?: Partial<NotificationSettings>;
  android?: Partial<AndroidSettings>;
  toolchains?: Partial<ToolchainsSettings>;
  processes?: Partial<ProcessesSettings>;
  preview?: Partial<PreviewSettings>;
  embeddedTerminal?: Partial<EmbeddedTerminalSettings>;
  files?: Partial<FilesSettings>;
  onboarding?: Partial<OnboardingSettings>;
};

export const DEFAULT_ACCENT_COLOR = '#7c9cff';

export const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettings = {
  completedVersion: null,
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  startupView: 'hub',
  confirmBeforeQuit: true,
  refreshIntervalMs: 15000,
  refreshOnFocus: true,
};

export const DEFAULT_GIT_BEHAVIOR_SETTINGS: GitBehaviorSettings = {
  pullStrategy: 'ff-only',
};

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  commitLimit: 30,
};

export const DEFAULT_CONFIRMATION_SETTINGS: ConfirmationSettings = {
  discardChanges: true,
  deleteBranch: true,
  dropStash: true,
  amendCommit: true,
  conflictOverwrite: true,
  deleteRemoteBranch: true,
  deleteRemoteTag: true,
  abortOperation: true,
  skipCommit: true,
  stashPop: true,
  restoreStashFiles: true,
  submoduleUpdate: true,
  pruneWorktrees: true,
  mergeBranch: true,
  rebaseBranch: true,
  resetBranch: true,
  resetHard: true,
  checkoutCommit: true,
  removeRemote: true,
};

export const DEFAULT_COMMIT_SETTINGS: CommitSettings = {
  defaultSignOff: false,
  signingPreference: 'off',
};

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: 'dark',
  density: 'compact',
  accentColor: DEFAULT_ACCENT_COLOR,
  immersiveMode: false,
  reduceMotion: false,
  uiScale: 1,
};

export const DEFAULT_TOOLS_SETTINGS: ToolsVisibilitySettings = {
  showOpenInEditor: true,
  showOpenInTerminal: true,
  showOpenInExplorer: true,
};

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  paneWidths: { files: 340, commit: 280, filesExplorer: 280 },
};

export const DEFAULT_FILES_SETTINGS: FilesSettings = {
  wordWrap: false,
  showIgnored: false,
  restoreSession: true,
  autoReloadClean: true,
  allowRawHtml: false,
  remoteImages: 'ask',
  tabSize: 2,
  readerWidth: 'standard',
  editorFontSize: 13,
  lineNumbers: true,
};

export const DEFAULT_EMBEDDED_TERMINAL_SETTINGS: EmbeddedTerminalSettings = {
  fontSize: 12,
  scrollback: 1000,
  cursorStyle: 'block',
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  longRunningOnly: true,
};

export const DEFAULT_ANDROID_SETTINGS: AndroidSettings = {
  defaultLogcatPriority: 'V',
  defaultLogcatFilter: '',
  reactNativeMetroPort: 8081,
  reactNativeAutoReverse: true,
};

export const DEFAULT_TOOLCHAINS_SETTINGS: ToolchainsSettings = {};

export const DEFAULT_PROCESSES_SETTINGS: ProcessesSettings = {
  logBufferLines: 5000,
  maxCrashRestarts: 5,
};

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
  defaultViewport: 'fill',
  captureConsole: true,
};

