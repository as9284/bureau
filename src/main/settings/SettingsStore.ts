import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import { createAtomicJsonStore } from '../storage/AtomicJsonStore';
import {
  createDefaultSettings,
  settingsFileToPublic,
  validateSettings,
  type SettingsFileV1,
} from '../storage/schemas';
import type {
  EditorConfig,
  PublicSettings,
  SettingsPatch,
  TerminalConfig,
  WindowBounds,
} from '@shared/contracts/settings';

export type SettingsStore = {
  get(): PublicSettings;
  setEditor(editor: EditorConfig): Promise<PublicSettings>;
  setTerminal(terminal: TerminalConfig): Promise<PublicSettings>;
  setGitExecutable(executablePath: string | undefined): Promise<PublicSettings>;
  setWindowBounds(bounds: WindowBounds): Promise<PublicSettings>;
  update(patch: SettingsPatch): Promise<PublicSettings>;
};

export function createSettingsStore(store: AtomicJsonStore<SettingsFileV1>): SettingsStore {
  function get(): PublicSettings {
    return settingsFileToPublic(store.read());
  }

  async function setEditor(editor: EditorConfig): Promise<PublicSettings> {
    return update({ editor });
  }

  async function setTerminal(terminal: TerminalConfig): Promise<PublicSettings> {
    return update({ terminal });
  }

  async function setGitExecutable(executablePath: string | undefined): Promise<PublicSettings> {
    return update({ git: { executablePath: executablePath ?? null } });
  }

  async function setWindowBounds(bounds: WindowBounds): Promise<PublicSettings> {
    const next = await store.update((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      window: bounds,
    }));
    return settingsFileToPublic(next);
  }

  async function update(patch: SettingsPatch): Promise<PublicSettings> {
    const next = await store.update((current) => applyPatch(current, patch));
    return settingsFileToPublic(next);
  }

  return { get, setEditor, setTerminal, setGitExecutable, setWindowBounds, update };
}

export function createSettingsStoreFromPath(filePath: string): AtomicJsonStore<SettingsFileV1> {
  return createAtomicJsonStore<SettingsFileV1>({
    filePath,
    schemaVersion: 1,
    defaultValue: createDefaultSettings(),
    validate: validateSettings,
  });
}

function applyPatch(current: SettingsFileV1, patch: SettingsPatch): SettingsFileV1 {
  const next: SettingsFileV1 = { ...current, updatedAt: new Date().toISOString() };

  if (patch.git) {
    next.git = {
      ...current.git,
      ...(patch.git.executablePath === null
        ? {}
        : { executablePath: patch.git.executablePath ?? current.git.executablePath }),
    };
    if (patch.git.executablePath === null) {
      delete next.git.executablePath;
    }
  }
  if (patch.editor) next.editor = patch.editor;
  if (patch.terminal) next.terminal = patch.terminal;
  if (patch.general) next.general = { ...current.general, ...patch.general };
  if (patch.appearance) next.appearance = { ...current.appearance, ...patch.appearance };
  if (patch.gitBehavior) next.gitBehavior = { ...current.gitBehavior, ...patch.gitBehavior };
  if (patch.tools) next.tools = { ...current.tools, ...patch.tools };
  if (patch.layout) {
    next.layout = {
      ...current.layout,
      ...patch.layout,
      paneWidths: patch.layout.paneWidths
        ? { ...current.layout.paneWidths, ...patch.layout.paneWidths }
        : current.layout.paneWidths,
    };
  }
  if (patch.history) next.history = { ...current.history, ...patch.history };
  if (patch.confirmations) {
    next.confirmations = { ...current.confirmations, ...patch.confirmations };
  }
  if (patch.commit) next.commit = { ...current.commit, ...patch.commit };
  if (patch.notifications) {
    next.notifications = { ...current.notifications, ...patch.notifications };
  }
  if (patch.android) next.android = { ...current.android, ...patch.android };
  if (patch.toolchains) next.toolchains = { ...current.toolchains, ...patch.toolchains };
  if (patch.processes) next.processes = { ...current.processes, ...patch.processes };
  if (patch.preview) next.preview = { ...current.preview, ...patch.preview };
  if (patch.embeddedTerminal) {
    next.embeddedTerminal = { ...current.embeddedTerminal, ...patch.embeddedTerminal };
  }
  if (patch.files) next.files = { ...current.files, ...patch.files };
  if (patch.onboarding) next.onboarding = { ...current.onboarding, ...patch.onboarding };

  return validateSettings(next);
}
