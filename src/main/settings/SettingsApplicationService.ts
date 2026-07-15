import type { GitExecutableResolver } from '../git/GitExecutableResolver';
import type { SettingsStore } from './SettingsStore';
import type {
  PublicSettings,
  EditorConfig,
  EditorPreset,
  SettingsPatch,
  TerminalConfig,
  TerminalPreset,
} from '@shared/contracts/settings';
import { toBureauError } from '../ipc/errors';

export type ExecutablePickerAdapter = {
  showOpenExecutableDialog(options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | undefined>;
};

export type SettingsApplicationService = ReturnType<typeof createSettingsApplicationService>;

export function createSettingsApplicationService(params: {
  settingsStore: SettingsStore;
  resolver: GitExecutableResolver;
  pickerAdapter: ExecutablePickerAdapter;
}) {
  const { settingsStore, resolver, pickerAdapter } = params;

  async function get(): Promise<PublicSettings> {
    return settingsStore.get();
  }

  async function update(patch: SettingsPatch): Promise<PublicSettings> {
    return settingsStore.update(patch);
  }

  async function chooseGitExecutable(): Promise<PublicSettings> {
    const selectedPath = await pickerAdapter.showOpenExecutableDialog({
      title: 'Choose Git executable',
    });
    if (!selectedPath) {
      return settingsStore.get();
    }

    const capability = await resolver.resolve(selectedPath);
    if (capability.kind === 'notFound') {
      throw toBureauError({
        code: 'EXECUTABLE_NOT_FOUND',
        message: 'Selected file is not a valid Git executable.',
        operation: 'settings.chooseGitExecutable',
        retryable: false,
      });
    }
    if (capability.kind === 'unsupportedVersion') {
      throw toBureauError({
        code: 'GIT_UNSUPPORTED_VERSION',
        message: `Git ${capability.version.major}.${capability.version.minor}.${capability.version.patch} is not supported.`,
        operation: 'settings.chooseGitExecutable',
        retryable: false,
      });
    }

    return settingsStore.setGitExecutable(selectedPath);
  }

  async function clearGitExecutable(): Promise<PublicSettings> {
    return settingsStore.setGitExecutable(undefined);
  }

  async function chooseCustomEditor(): Promise<PublicSettings> {
    const selectedPath = await pickerAdapter.showOpenExecutableDialog({
      title: 'Choose editor executable',
      filters:
        process.platform === 'win32' ? [{ name: 'Applications', extensions: ['exe'] }] : undefined,
    });
    if (!selectedPath) return settingsStore.get();
    return settingsStore.setEditor({ kind: 'custom', executablePath: selectedPath });
  }

  async function setEditorPreset(input: {
    preset: EditorPreset | 'none';
  }): Promise<PublicSettings> {
    const editor: EditorConfig =
      input.preset === 'none' ? { kind: 'none' } : { kind: 'preset', preset: input.preset };
    return settingsStore.setEditor(editor);
  }

  async function chooseCustomTerminal(): Promise<PublicSettings> {
    const selectedPath = await pickerAdapter.showOpenExecutableDialog({
      title: 'Choose terminal executable',
      filters:
        process.platform === 'win32' ? [{ name: 'Applications', extensions: ['exe'] }] : undefined,
    });
    if (!selectedPath) return settingsStore.get();
    return settingsStore.setTerminal({ kind: 'custom', executablePath: selectedPath });
  }

  async function setTerminalPreset(input: {
    preset: TerminalPreset | 'auto';
  }): Promise<PublicSettings> {
    const terminal: TerminalConfig =
      input.preset === 'auto' ? { kind: 'auto' } : { kind: 'preset', preset: input.preset };
    return settingsStore.setTerminal(terminal);
  }

  return {
    get,
    update,
    chooseGitExecutable,
    clearGitExecutable,
    chooseCustomEditor,
    setEditorPreset,
    chooseCustomTerminal,
    setTerminalPreset,
  };
}
