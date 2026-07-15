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
export type HubSortPreference = 'attention' | 'name' | 'recentlyRefreshed' | 'changedFiles';

export type HubSettings = {
  defaultSort: HubSortPreference;
  recentCount: number;
};

export type RefreshIntervalMs = 0 | 5000 | 15000 | 30000 | 60000;

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

export type ConfirmationSettings = {
  discardChanges: boolean;
  deleteBranch: boolean;
  dropStash: boolean;
  amendCommit: boolean;
  conflictOverwrite: boolean;
  deleteRemoteBranch: boolean;
  deleteRemoteTag: boolean;
};

export type CommitSettings = {
  defaultSignOff: boolean;
  signingPreference: 'config' | 'off';
  commitTemplate?: string;
};

export type AppearanceSettings = {
  theme: ThemePreference;
  density: DensityPreference;
  accentColor: string;
  /** Auto-hide the activity rail and Projects sidebar; reveal from the workspace edge. */
  immersiveMode: boolean;
};

export type ToolsVisibilitySettings = {
  showOpenInEditor: boolean;
  showOpenInTerminal: boolean;
  showOpenInExplorer: boolean;
};

export type LayoutSettings = {
  sidebarWidth: number;
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
  hub: HubSettings;
  files?: FilesSettings;
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
    sidebarWidth?: number;
    paneWidths?: Partial<PaneWidthSettings>;
  };
  history?: Partial<HistorySettings>;
  confirmations?: Partial<ConfirmationSettings>;
  commit?: Partial<CommitSettings>;
  notifications?: Partial<NotificationSettings>;
  android?: Partial<AndroidSettings>;
  toolchains?: Partial<ToolchainsSettings>;
  hub?: Partial<HubSettings>;
  files?: Partial<FilesSettings>;
};

export const DEFAULT_ACCENT_COLOR = '#7c9cff';

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
};

export const DEFAULT_TOOLS_SETTINGS: ToolsVisibilitySettings = {
  showOpenInEditor: true,
  showOpenInTerminal: true,
  showOpenInExplorer: true,
};

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  sidebarWidth: 220,
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

export const DEFAULT_HUB_SETTINGS: HubSettings = { defaultSort: 'attention', recentCount: 8 };
