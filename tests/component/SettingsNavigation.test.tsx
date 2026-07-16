import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@renderer/store/appStore';
import { SettingsPage } from '@renderer/pages/SettingsPage';
import type { PublicSettings } from '@shared/contracts/settings';
import { DEFAULT_CONFIRMATION_SETTINGS } from '@shared/contracts/settings';
import type { AppCapabilities } from '@shared/contracts/capabilities';

const SETTINGS: PublicSettings = {
  schemaVersion: 1,
  editor: { kind: 'none' },
  terminal: { kind: 'auto' },
  general: {
    startupView: 'hub',
    confirmBeforeQuit: true,
    refreshIntervalMs: 15000,
    refreshOnFocus: true,
  },
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
    emulatorDisplayMode: 'embedded' as const,
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

const CAPABILITIES: AppCapabilities = {
  apiVersion: 1,
  platform: 'test',
  appVersion: '0.1.0',
  gitAvailable: true,
  terminalAvailable: true,
  availableEditors: ['vscode', 'cursor'],
  availableTerminals: ['powershell'],
  availableShells: [
    { id: 'powershell', label: 'Windows PowerShell', executable: 'powershell.exe' },
  ],
  editor: { kind: 'none' },
  terminal: { kind: 'auto' },
  android: {
    sdkPath: null,
    adb: { available: false, path: null },
    emulator: { available: false, path: null },
    scrcpy: { available: false, path: null },
    flutter: { available: false, path: null },
  },
  runtimes: [],
  packageManagers: ['npm'],
};

beforeEach(() => {
  useAppStore.setState({
    status: 'ready',
    settings: SETTINGS,
    capabilities: CAPABILITIES,
    activeSection: 'settings',
    view: 'settings',
    settingsSection: 'general',
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'bureau');
});

describe('settings navigation', () => {
  it('switches the settings section from the page navigation', async () => {
    render(<SettingsPage />);
    expect(useAppStore.getState().settingsSection).toBe('general');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Appearance' }));
    expect(useAppStore.getState().settingsSection).toBe('appearance');
    expect(screen.getByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
  });

  it('renders the section that matches settingsSection', () => {
    useAppStore.setState({ settingsSection: 'general' });
    const { rerender } = render(<SettingsPage />);
    expect(screen.getByText('On startup')).toBeInTheDocument();
    expect(screen.queryByText('Theme')).not.toBeInTheDocument();

    useAppStore.setState({ settingsSection: 'appearance' });
    rerender(<SettingsPage />);
    expect(screen.getByText('Theme')).toBeInTheDocument();
    expect(screen.getByText('Accent')).toBeInTheDocument();

    useAppStore.setState({ settingsSection: 'tools' });
    rerender(<SettingsPage />);
    expect(screen.getByText('External editor')).toBeInTheDocument();
  });

  it('offers a custom accent color picker that opens a popover', async () => {
    useAppStore.setState({ settingsSection: 'appearance' });
    render(<SettingsPage />);
    const trigger = screen.getByRole('button', { name: 'Custom accent color' });
    expect(trigger).toBeInTheDocument();

    await userEvent.setup().click(trigger);
    expect(screen.getByRole('dialog', { name: 'Custom accent color' })).toBeInTheDocument();
    expect(screen.getByLabelText('Hex color')).toBeInTheDocument();
  });

  it('offers a guarded restart when an update has downloaded', async () => {
    const installUpdate = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: {
        app: {
          getUpdateState: vi.fn().mockResolvedValue({
            kind: 'downloaded',
            currentVersion: '1.0.0',
            availableVersion: '1.0.1',
          }),
          onUpdateState: vi.fn(() => () => undefined),
          checkForUpdates: vi.fn(),
          installUpdate,
        },
      },
    });

    render(<SettingsPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Version 1.0.1 is ready. Restart when your work is safe to close.')
      ).toBeInTheDocument();
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Restart and update' }));
    expect(installUpdate).toHaveBeenCalledOnce();
  });
});
