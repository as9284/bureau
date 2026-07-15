import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import type { EditorConfig, PublicSettings, TerminalConfig } from '@shared/contracts/settings';
import type { TrackedProject } from '@shared/contracts/projects';
import { STACK_TAGS } from '@shared/contracts/projects';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_ANDROID_SETTINGS,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_COMMIT_SETTINGS,
  DEFAULT_CONFIRMATION_SETTINGS,
  DEFAULT_GENERAL_SETTINGS,
  DEFAULT_GIT_BEHAVIOR_SETTINGS,
  DEFAULT_HISTORY_SETTINGS,
  DEFAULT_LAYOUT_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  DEFAULT_TOOLS_SETTINGS,
  DEFAULT_TOOLCHAINS_SETTINGS,
  DEFAULT_HUB_SETTINGS,
  DEFAULT_FILES_SETTINGS,
} from '@shared/contracts/settings';

const MAX_DISPLAY_NAME_LENGTH = 256;
const MAX_PATH_LENGTH = 4096;
const MAX_RECORDS = 500;

export const editorConfigSchema: z.ZodType<EditorConfig> = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('preset'), preset: z.enum(['vscode', 'cursor', 'zed', 'sublime']) }),
  z.object({ kind: z.literal('custom'), executablePath: z.string().min(1).max(MAX_PATH_LENGTH) }),
]);

export const terminalConfigSchema: z.ZodType<TerminalConfig> = z.union([
  z.object({ kind: z.literal('auto') }),
  z.object({
    kind: z.literal('preset'),
    preset: z.enum([
      'windows-terminal',
      'powershell',
      'cmd',
      'terminal-app',
      'gnome-terminal',
      'konsole',
      'xfce4-terminal',
      'alacritty',
      'xterm',
    ]),
  }),
  z.object({ kind: z.literal('custom'), executablePath: z.string().min(1).max(MAX_PATH_LENGTH) }),
]);

const accentColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Accent color must be a hex color like #7c9cff');

export const settingsFileSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().datetime(),
  git: z.object({
    executablePath: z.string().max(MAX_PATH_LENGTH).optional(),
  }),
  editor: editorConfigSchema,
  terminal: terminalConfigSchema,
  window: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      x: z.number().int().optional(),
      y: z.number().int().optional(),
      maximized: z.boolean().optional(),
    })
    .optional(),
  general: z.object({
    startupView: z.enum(['hub', 'lastOpened']),
    confirmBeforeQuit: z.boolean(),
    refreshIntervalMs: z.union([
      z.literal(0),
      z.literal(5000),
      z.literal(15000),
      z.literal(30000),
      z.literal(60000),
    ]),
    refreshOnFocus: z.boolean(),
  }),
  appearance: z.object({
    theme: z.enum(['dark', 'light', 'system']),
    density: z.enum(['compact', 'comfortable']),
    accentColor: accentColorSchema,
    immersiveMode: z.boolean(),
  }),
  gitBehavior: z.object({
    pullStrategy: z.enum(['ff-only', 'merge', 'rebase']),
  }),
  tools: z.object({
    showOpenInEditor: z.boolean(),
    showOpenInTerminal: z.boolean(),
    showOpenInExplorer: z.boolean(),
  }),
  layout: z.object({
    paneWidths: z.object({
      files: z.number().int().min(320),
      commit: z.number().int().min(200),
      filesExplorer: z.number().int().min(180).max(640),
    }),
  }),
  history: z.object({
    commitLimit: z.number().int().min(1).max(100),
  }),
  confirmations: z.object({
    discardChanges: z.boolean(),
    deleteBranch: z.boolean(),
    dropStash: z.boolean(),
    amendCommit: z.boolean(),
    conflictOverwrite: z.boolean(),
    deleteRemoteBranch: z.boolean(),
    deleteRemoteTag: z.boolean(),
  }),
  commit: z.object({
    defaultSignOff: z.boolean(),
    signingPreference: z.enum(['config', 'off']),
    commitTemplate: z.string().max(12000).optional(),
  }),
  notifications: z.object({
    enabled: z.boolean(),
    longRunningOnly: z.boolean(),
  }),
  android: z.object({
    sdkPath: z.string().min(1).max(MAX_PATH_LENGTH).optional(),
    scrcpyPath: z.string().min(1).max(MAX_PATH_LENGTH).optional(),
    defaultLogcatPriority: z.enum(['V', 'D', 'I', 'W', 'E', 'F', 'S']),
    defaultLogcatFilter: z.string().max(256),
    reactNativeMetroPort: z.number().int().min(1024).max(65535),
    reactNativeAutoReverse: z.boolean(),
  }),
  toolchains: z.object({
    preferredNodeManager: z.enum(['fnm', 'volta', 'nvm', 'system']).optional(),
    preferredPythonManager: z.enum(['pyenv', 'venv', 'system']).optional(),
    preferredFlutterManager: z.enum(['fvm', 'flutter']).optional(),
  }),
  hub: z.object({
    defaultSort: z.enum(['attention', 'name', 'recentlyRefreshed', 'changedFiles']),
    recentCount: z.number().int().min(1).max(50),
  }),
  files: z.object({
    wordWrap: z.boolean(),
    showIgnored: z.boolean(),
    restoreSession: z.boolean(),
    autoReloadClean: z.boolean(),
    allowRawHtml: z.boolean(),
    remoteImages: z.enum(['ask', 'block']),
    tabSize: z.union([z.literal(2), z.literal(4)]),
    readerWidth: z.enum(['narrow', 'standard', 'wide']),
  }),
});

export const trackedProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  path: z.string().min(1).max(MAX_PATH_LENGTH),
  canonicalPath: z.string().min(1).max(MAX_PATH_LENGTH),
  stack: z.array(z.enum(STACK_TAGS)).max(20),
  addedAt: z.string().datetime(),
  lastOpenedAt: z.string().datetime().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  groupIds: z.array(z.string().uuid()).max(20).optional(),
  configPresent: z.boolean(),
  missing: z.boolean().optional(),
  nestedRoots: z.array(z.string().max(MAX_PATH_LENGTH)).max(100).optional(),
});

export const projectCatalogueFileSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().datetime(),
  projects: z.array(trackedProjectSchema).max(MAX_RECORDS),
});

export type SettingsFileV1 = z.infer<typeof settingsFileSchema>;
export type ProjectCatalogueFileV1 = z.infer<typeof projectCatalogueFileSchema>;

export function createDefaultSettings(): SettingsFileV1 {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    git: {},
    editor: { kind: 'none' },
    terminal: { kind: 'auto' },
    general: { ...DEFAULT_GENERAL_SETTINGS },
    appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
    gitBehavior: { ...DEFAULT_GIT_BEHAVIOR_SETTINGS },
    tools: { ...DEFAULT_TOOLS_SETTINGS },
    layout: {
      ...DEFAULT_LAYOUT_SETTINGS,
      paneWidths: {
        files: DEFAULT_LAYOUT_SETTINGS.paneWidths.files,
        commit: DEFAULT_LAYOUT_SETTINGS.paneWidths.commit,
        filesExplorer: DEFAULT_LAYOUT_SETTINGS.paneWidths.filesExplorer ?? 280,
      },
    },
    history: { ...DEFAULT_HISTORY_SETTINGS },
    confirmations: { ...DEFAULT_CONFIRMATION_SETTINGS },
    commit: { ...DEFAULT_COMMIT_SETTINGS },
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
    android: { ...DEFAULT_ANDROID_SETTINGS },
    toolchains: { ...DEFAULT_TOOLCHAINS_SETTINGS },
    hub: { ...DEFAULT_HUB_SETTINGS },
    files: { ...DEFAULT_FILES_SETTINGS },
  };
}

export function createDefaultProjectCatalogue(): ProjectCatalogueFileV1 {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    projects: [],
  };
}

/** Lenient: deep-merge incoming over defaults, then strict-parse. Older/partial files upgrade silently. */
export function validateSettings(value: unknown): SettingsFileV1 {
  const defaults = createDefaultSettings();
  const incoming = isRecord(value) ? value : {};

  const merged: Record<string, unknown> = {
    schemaVersion: 1,
    updatedAt: typeof incoming.updatedAt === 'string' ? incoming.updatedAt : defaults.updatedAt,
    git: isRecord(incoming.git) ? incoming.git : defaults.git,
    editor: isRecord(incoming.editor) ? incoming.editor : defaults.editor,
    terminal: isRecord(incoming.terminal) ? incoming.terminal : defaults.terminal,
    general: { ...defaults.general, ...(isRecord(incoming.general) ? incoming.general : {}) },
    appearance: {
      ...defaults.appearance,
      ...(isRecord(incoming.appearance) ? incoming.appearance : {}),
      accentColor: normalizeAccent(
        isRecord(incoming.appearance) ? incoming.appearance.accentColor : undefined
      ),
      immersiveMode: normalizeBoolean(
        isRecord(incoming.appearance) ? incoming.appearance.immersiveMode : undefined,
        defaults.appearance.immersiveMode
      ),
    },
    gitBehavior: {
      ...defaults.gitBehavior,
      ...(isRecord(incoming.gitBehavior) ? incoming.gitBehavior : {}),
    },
    tools: { ...defaults.tools, ...(isRecord(incoming.tools) ? incoming.tools : {}) },
    layout: {
      ...defaults.layout,
      ...(isRecord(incoming.layout) ? incoming.layout : {}),
      paneWidths: {
        ...defaults.layout.paneWidths,
        ...(isRecord(incoming.layout) && isRecord(incoming.layout.paneWidths)
          ? incoming.layout.paneWidths
          : {}),
      },
    },
    history: { ...defaults.history, ...(isRecord(incoming.history) ? incoming.history : {}) },
    confirmations: {
      ...defaults.confirmations,
      ...(isRecord(incoming.confirmations) ? incoming.confirmations : {}),
    },
    commit: { ...defaults.commit, ...(isRecord(incoming.commit) ? incoming.commit : {}) },
    notifications: {
      ...defaults.notifications,
      ...(isRecord(incoming.notifications) ? incoming.notifications : {}),
    },
    android: { ...defaults.android, ...(isRecord(incoming.android) ? incoming.android : {}) },
    toolchains: {
      ...defaults.toolchains,
      ...(isRecord(incoming.toolchains) ? incoming.toolchains : {}),
    },
    hub: { ...defaults.hub, ...(isRecord(incoming.hub) ? incoming.hub : {}) },
    files: { ...defaults.files, ...(isRecord(incoming.files) ? incoming.files : {}) },
  };

  if (isRecord(incoming.window)) {
    merged.window = incoming.window;
  }

  return settingsFileSchema.parse(merged);
}

export function validateProjectCatalogue(value: unknown): ProjectCatalogueFileV1 {
  const parsed = projectCatalogueFileSchema.parse(value);
  const ids = new Set(parsed.projects.map((p) => p.projectId));
  if (ids.size !== parsed.projects.length) {
    throw new Error('Duplicate project IDs');
  }
  const paths = new Set(parsed.projects.map((p) => p.canonicalPath));
  if (paths.size !== parsed.projects.length) {
    throw new Error('Duplicate canonical paths');
  }
  return parsed;
}

export function settingsFileToPublic(file: SettingsFileV1): PublicSettings {
  return {
    schemaVersion: file.schemaVersion,
    git: file.git,
    editor: file.editor,
    terminal: file.terminal,
    window: file.window,
    general: file.general,
    appearance: file.appearance,
    gitBehavior: file.gitBehavior,
    tools: file.tools,
    layout: file.layout,
    history: file.history,
    confirmations: file.confirmations,
    commit: file.commit,
    notifications: file.notifications,
    android: file.android,
    toolchains: file.toolchains,
    hub: file.hub,
    files: file.files,
  };
}

export function makeProjectRecord(
  record: Omit<TrackedProject, 'projectId'> & { projectId?: string }
): TrackedProject {
  return { ...record, projectId: record.projectId ?? uuidv4() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAccent(value: unknown): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value.toLowerCase();
  }
  return DEFAULT_ACCENT_COLOR;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
