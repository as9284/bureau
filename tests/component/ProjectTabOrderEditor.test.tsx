import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@renderer/store/appStore';
import { SettingsPage } from '@renderer/pages/SettingsPage';
import type { PublicSettings, ProjectTabId } from '@shared/contracts/settings';
import { DEFAULT_CONFIRMATION_SETTINGS } from '@shared/contracts/settings';

const SETTINGS: PublicSettings = {
  schemaVersion: 1,
  editor: { kind: 'none' },
  terminal: { kind: 'auto' },
  general: { startupView: 'hub', confirmBeforeQuit: true, refreshIntervalMs: 15000, refreshOnFocus: true },
  appearance: {
    theme: 'dark',
    density: 'compact',
    accentColor: '#7c9cff',
    immersiveMode: false,
    reduceMotion: false,
    uiScale: 1,
  },
  tools: { showOpenInEditor: true, showOpenInTerminal: true, showOpenInExplorer: true },
  layout: { paneWidths: { files: 340, commit: 280 } },
  notifications: { enabled: false, longRunningOnly: true },
  android: {
    defaultLogcatPriority: 'V',
    defaultLogcatFilter: '',
    reactNativeMetroPort: 8081,
    reactNativeAutoReverse: true,
  },
  toolchains: {},
  processes: { logBufferLines: 5000, maxCrashRestarts: 5 },
  preview: { defaultViewport: 'fill', captureConsole: true },
  embeddedTerminal: { fontSize: 12, scrollback: 1000, cursorStyle: 'block' },
  git: {},
  gitBehavior: { pullStrategy: 'ff-only' },
  history: { commitLimit: 30 },
  confirmations: { ...DEFAULT_CONFIRMATION_SETTINGS },
  commit: { defaultSignOff: false, signingPreference: 'off' },
  onboarding: { completedVersion: '1.0.0' },
};

const DEFAULT_ORDER: ProjectTabId[] = [
  'overview',
  'files',
  'processes',
  'preview',
  'android',
  'toolchains',
  'ports',
  'git',
];

function setSettings(appearance: Partial<PublicSettings['appearance']> = {}) {
  useAppStore.setState({
    status: 'ready',
    settings: { ...SETTINGS, appearance: { ...SETTINGS.appearance, ...appearance } },
    settingsSection: 'appearance',
    view: 'settings',
  });
}

beforeEach(() => setSettings());
afterEach(() => cleanup());

describe('project tab order editor', () => {
  it('lists the workspace tabs and disables the boundary moves', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Workspace tabs')).toBeInTheDocument();
    // Assert via the unique per-tab move controls ("Files"/"Git" as plain text would
    // also match the settings-nav buttons of the same name).
    for (const label of ['Overview', 'Files', 'Processes', 'Preview', 'Android', 'Ports', 'Git']) {
      expect(screen.getByRole('button', { name: `Move ${label} up` })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Move Overview up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Git down' })).toBeDisabled();
    // No reset affordance while the order is the default.
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
  });

  it('persists a reorder when a tab is moved down', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ updateSettings });
    render(<SettingsPage />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Move Overview down' }));

    expect(updateSettings).toHaveBeenCalledWith({
      appearance: {
        projectTabOrder: [
          'files',
          'overview',
          'processes',
          'preview',
          'android',
          'toolchains',
          'ports',
          'git',
        ],
      },
    });
  });

  it('clears the override from Reset to default', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    setSettings({ projectTabOrder: ['git', ...DEFAULT_ORDER.filter((id) => id !== 'git')] });
    useAppStore.setState({ updateSettings });
    render(<SettingsPage />);

    const reset = screen.getByRole('button', { name: 'Reset to default' });
    await userEvent.setup().click(reset);

    expect(updateSettings).toHaveBeenCalledWith({ appearance: { projectTabOrder: undefined } });
  });
});
