import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AndroidPanel } from '@renderer/features/android/AndroidPanel';
import { useAppStore } from '@renderer/store/appStore';
import type { BureauApiV1 } from '@shared/contracts/api';
import type { AndroidOverview } from '@shared/contracts/android';
import { DEFAULT_CONFIRMATION_SETTINGS } from '@shared/contracts/settings';

const projectId = '11111111-1111-4111-8111-111111111111';
const overview: AndroidOverview = {
  sdk: {
    sdkPath: 'C:\\Android\\Sdk',
    adb: { available: true, path: 'adb.exe' },
    emulator: { available: true, path: 'emulator.exe' },
    scrcpy: { available: true, path: 'scrcpy.exe' },
    flutter: { available: true, path: 'flutter.exe' },
  },
  devices: [
    {
      id: 'emulator-5554',
      type: 'emulator',
      state: 'device',
      model: 'Pixel 8',
      avdName: 'Pixel_8',
    },
  ],
  avds: [{ name: 'Pixel_8', target: 'android-35', apiLevel: 35, state: 'stopped', booted: false }],
};

beforeEach(() => {
  const android = {
    getOverview: vi.fn(async () => overview),
    chooseSdkPath: vi.fn(async () => overview.sdk),
    chooseScrcpyPath: vi.fn(async () => overview.sdk),
    restartAdb: vi.fn(async () => ({ ok: true as const })),
    chooseApk: vi.fn(async () => ({ path: 'C:\\build\\app.apk' })),
    chooseRecordingPath: vi.fn(async () => ({ path: null })),
    startAvd: vi.fn(async () => ({ ok: true as const })),
    stopAvd: vi.fn(async () => ({ ok: true as const })),
    getBootStatus: vi.fn(async () => ({ deviceId: 'emulator-5554', booted: true })),
    listDevices: vi.fn(async () => overview.devices),
    installApk: vi.fn(async () => ({ ok: true as const, message: 'Success' })),
    launchPackage: vi.fn(async () => ({ ok: true as const })),
    uninstallPackage: vi.fn(async () => ({ ok: true as const })),
    listPackages: vi.fn(async () => ({ deviceId: 'emulator-5554', packages: [] })),
    startLogcat: vi.fn(async () => ({ ok: true as const })),
    stopLogcat: vi.fn(async () => undefined),
    pauseLogcat: vi.fn(async () => ({
      deviceId: 'emulator-5554',
      running: true,
      paused: true,
      filter: { priority: 'V' as const },
      lines: [],
    })),
    clearLogcat: vi.fn(async () => ({
      deviceId: 'emulator-5554',
      running: false,
      paused: false,
      filter: { priority: 'V' as const },
      lines: [],
    })),
    getLogcatSnapshot: vi.fn(async () => ({
      deviceId: null,
      running: false,
      paused: false,
      filter: { priority: 'V' as const },
      lines: [],
    })),
    exportLogcat: vi.fn(async () => ({ path: null })),
    launchScrcpy: vi.fn(async () => ({ ok: true as const })),
    stopScrcpy: vi.fn(async () => ({ ok: true as const })),
    runFlutter: vi.fn(async () => ({ ok: true as const })),
    getReactNativeStatus: vi.fn(async () => ({
      detected: true,
      nativeAndroid: true,
      packageManager: 'npm' as const,
      metroPort: 8081,
      autoReverse: true,
      metroProcessId: 'react-native-metro',
      metroStatus: 'idle' as const,
      startScriptAvailable: true,
      androidScriptAvailable: true,
      packageName: 'com.example.mobile',
    })),
    startReactNativeMetro: vi.fn(async () => ({ ok: true as const })),
    stopReactNativeMetro: vi.fn(async () => ({ ok: true as const })),
    runReactNativeAndroid: vi.fn(async () => ({ ok: true as const })),
    reverseReactNativePort: vi.fn(async () => ({ ok: true as const })),
    reloadReactNative: vi.fn(async () => ({ ok: true as const })),
    openReactNativeDevMenu: vi.fn(async () => ({ ok: true as const })),
    pathForFile: vi.fn(() => ''),
    onLogcat: vi.fn(() => () => undefined),
  };
  Object.defineProperty(window, 'bureau', {
    configurable: true,
    value: { android } as unknown as BureauApiV1,
  });
  useAppStore.setState({
    projects: [
      {
        projectId,
        name: 'Mobile app',
        path: 'C:\\mobile',
        canonicalPath: 'c:\\mobile',
        stack: ['flutter'],
        addedAt: new Date().toISOString(),
      },
    ],
    androidByProject: {},
    settings: {
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
  git: {},
  gitBehavior: { pullStrategy: 'ff-only' },
  history: { commitLimit: 30 },
  confirmations: { ...DEFAULT_CONFIRMATION_SETTINGS },
  commit: { defaultSignOff: false, signingPreference: 'off' },
  processes: { logBufferLines: 5000, maxCrashRestarts: 5 },
  preview: { defaultViewport: 'fill', captureConsole: true },
  embeddedTerminal: { fontSize: 12, scrollback: 1000, cursorStyle: 'block' },
  onboarding: { completedVersion: '1.0.0' },
    },
  });
});

afterEach(cleanup);

describe('AndroidPanel', () => {
  it('renders AVDs, device controls, and the logcat filter bar', async () => {
    render(<AndroidPanel projectId={projectId} />);
    expect(await screen.findByText('Pixel_8')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Android device' })).toHaveTextContent('Pixel 8');
    expect(screen.getByLabelText('Logcat tag filter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled();
    expect(
      screen.getByRole('separator', { name: 'Resize virtual devices and device actions' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('separator', { name: 'Resize Android tools and Logcat' })
    ).toBeInTheDocument();
  });

  it('keeps the Android workspace visible when it is reopened', async () => {
    const first = render(<AndroidPanel projectId={projectId} />);
    expect(await screen.findByText('Pixel_8')).toBeInTheDocument();
    await waitFor(() =>
      expect(useAppStore.getState().androidByProject[projectId]?.overview).toBe(overview)
    );

    first.unmount();
    render(<AndroidPanel projectId={projectId} />);

    expect(document.querySelector('.android-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('Pixel_8')).toBeInTheDocument();
  });

  it('shows AVD launch options and makes wipe data explicit', async () => {
    const user = userEvent.setup();
    render(<AndroidPanel projectId={projectId} />);
    await screen.findByText('Pixel_8');
    await user.click(screen.getByRole('button', { name: 'Start Pixel_8' }));
    expect(screen.getByRole('dialog', { name: 'Start Pixel_8' })).toHaveClass('dialog--form');
    await user.click(screen.getByRole('checkbox', { name: /Wipe data/ }));
    expect(screen.getByRole('button', { name: 'Wipe and start' })).toBeInTheDocument();
  });

  it('closes the AVD launch dialog on Escape', async () => {
    const user = userEvent.setup();
    render(<AndroidPanel projectId={projectId} />);
    await screen.findByText('Pixel_8');
    await user.click(screen.getByRole('button', { name: 'Start Pixel_8' }));
    expect(screen.getByRole('dialog', { name: 'Start Pixel_8' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Start Pixel_8' })).not.toBeInTheDocument();
  });

  it('requires a destructive confirmation before uninstalling a package', async () => {
    const user = userEvent.setup();
    render(<AndroidPanel projectId={projectId} />);
    await screen.findByText('Pixel_8');
    await user.type(screen.getByLabelText('Package'), 'com.example.app');
    await user.click(screen.getByRole('button', { name: 'Uninstall' }));
    expect(screen.getByRole('alertdialog', { name: 'Uninstall package?' })).toBeInTheDocument();
    expect(screen.getByText(/permanently removes com.example.app/)).toBeInTheDocument();
  });

  it('runs a detected React Native project on the selected device', async () => {
    const user = userEvent.setup();
    useAppStore.setState((state) => ({
      projects: state.projects.map((project) => ({
        ...project,
        stack: ['node', 'react-native'],
      })),
    }));
    render(<AndroidPanel projectId={projectId} />);
    expect(await screen.findByText('React Native')).toBeInTheDocument();
    expect(screen.getByText('Metro idle on :8081')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run Android' }));
    await waitFor(() =>
      expect(window.bureau.android.runReactNativeAndroid).toHaveBeenCalledWith({
        projectId,
        deviceId: 'emulator-5554',
        port: 8081,
      })
    );
  });
});
