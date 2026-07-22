import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GiteaStatus } from '@shared/contracts/gitea';
import type { PublicSettings } from '@shared/contracts/settings';
import { DEFAULT_CONFIRMATION_SETTINGS } from '@shared/contracts/settings';
import { SettingsPage } from '@renderer/pages/SettingsPage';
import { useAppStore } from '@renderer/store/appStore';

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

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'bureau');
});

const CONNECTED: GiteaStatus = {
  configured: true,
  authenticated: true,
  hostUrl: 'https://gitea.example.com',
  account: 'ana',
  version: '1.22.0',
};

const DISCONNECTED: GiteaStatus = { configured: false, authenticated: false };

function mountGitSettings(gitea: Partial<Record<string, unknown>>) {
  Object.defineProperty(window, 'bureau', { configurable: true, value: { gitea } });
  useAppStore.setState({
    status: 'ready',
    settings: SETTINGS,
    view: 'settings',
    activeSection: 'settings',
    settingsSection: 'git',
  });
  return render(<SettingsPage />);
}

describe('Git settings layout', () => {
  it('breaks the section into scannable groups instead of one long list', async () => {
    mountGitSettings({ getStatus: vi.fn().mockResolvedValue(DISCONNECTED), connect: vi.fn() });

    const groups = await screen.findAllByRole('heading', { level: 3 });
    expect(groups.map((heading) => heading.textContent)).toEqual([
      'Connections',
      'Sync & history',
      'Commits',
      'Confirmations',
    ]);
  });

  it('keeps every confirmation toggle reachable inside its group', async () => {
    mountGitSettings({ getStatus: vi.fn().mockResolvedValue(DISCONNECTED), connect: vi.fn() });

    await screen.findByText('Confirmations');
    // Regression guard: grouping must not drop rows from the flat list it replaced.
    expect(screen.getAllByRole('checkbox', { name: 'Ask first' })).toHaveLength(19);
    expect(screen.getByText('Reset branch (hard)')).toBeTruthy();
    expect(screen.getByText('Prune worktrees')).toBeTruthy();
  });
});

describe('Gitea connection row in Git settings', () => {
  it('shows the connected account and instance, and offers Disconnect', async () => {
    mountGitSettings({ getStatus: vi.fn().mockResolvedValue(CONNECTED), disconnect: vi.fn() });

    await screen.findByText(/ana@https:\/\/gitea\.example\.com/);
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
    expect(screen.queryByLabelText('Gitea personal access token')).toBeNull();
  });

  it('disconnects and falls back to the connect fields', async () => {
    const disconnect = vi.fn().mockResolvedValue(DISCONNECTED);
    mountGitSettings({ getStatus: vi.fn().mockResolvedValue(CONNECTED), disconnect });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));

    expect(disconnect).toHaveBeenCalled();
    await screen.findByLabelText('Gitea personal access token');
    expect(screen.getByText('Not connected')).toBeTruthy();
  });

  it('connects from Settings without going through a project', async () => {
    const connect = vi.fn().mockResolvedValue(CONNECTED);
    mountGitSettings({ getStatus: vi.fn().mockResolvedValue(DISCONNECTED), connect });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Gitea instance URL'), 'https://gitea.example.com');
    await user.type(screen.getByLabelText('Gitea personal access token'), 'tok123');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(connect).toHaveBeenCalledWith({
      hostUrl: 'https://gitea.example.com',
      token: 'tok123',
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy());
  });

  it('surfaces a rejected token rather than reporting a healthy connection', async () => {
    mountGitSettings({
      getStatus: vi.fn().mockResolvedValue({
        configured: true,
        authenticated: false,
        hostUrl: 'https://gitea.example.com',
        error: 'The access token was rejected by this Gitea instance.',
      }),
      connect: vi.fn(),
    });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('token was rejected')
    );
    expect(screen.getByText(/reconnect required/)).toBeTruthy();
  });
});
