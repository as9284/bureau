import { writeFile } from 'node:fs/promises';
import type {
  AndroidOverview,
  AndroidSdkStatus,
  ApkInstallRequest,
  ApkLaunchRequest,
  ApkUninstallRequest,
  AvdBootStatus,
  EmulatorButtonRequest,
  EmulatorDisplayStopRequest,
  EmulatorPasteRequest,
  EmulatorRotateRequest,
  EmulatorScreenshotRequest,
  EmulatorSnapshotListResult,
  EmulatorSnapshotRequest,
  FilePickerResult,
  FlutterRunRequest,
  GeoFixRequest,
  LogcatPauseRequest,
  LogcatStartRequest,
  ScrcpyLaunchRequest,
  StartAvdRequest,
  StopAvdRequest,
  ReactNativeDeviceRequest,
  ReactNativeProjectRequest,
} from '@shared/contracts/android';
import type { OkResult } from '@shared/contracts/errors';
import type { ProcessApplicationService } from '../processes/ProcessApplicationService';
import type { SettingsStore } from '../settings/SettingsStore';
import type { NativeDialogAdapter } from '../system/dialogAdapter';
import type { AdbService } from './AdbService';
import type { AvdService } from './AvdService';
import type { EmulatorDisplayService } from './EmulatorDisplayService';
import type { LogcatStreamer } from './LogcatStreamer';
import type { ScrcpyLauncher } from './ScrcpyLauncher';
import type { SdkResolver } from './SdkResolver';
import type { ReactNativeService } from './ReactNativeService';
import { parseSnapshotList } from './parsers';
import { toBureauError } from '../ipc/errors';

export type AndroidApplicationService = ReturnType<typeof createAndroidApplicationService>;

export function createAndroidApplicationService(params: {
  resolver: SdkResolver;
  avds: AvdService;
  adb: AdbService;
  logcat: LogcatStreamer;
  scrcpy: ScrcpyLauncher;
  display: EmulatorDisplayService;
  settingsStore: SettingsStore;
  processes: ProcessApplicationService;
  dialog: NativeDialogAdapter;
  reactNative: ReactNativeService;
  /** Injected so tests can avoid the electron clipboard. */
  readHostClipboard: () => string;
}) {
  const {
    resolver,
    avds,
    adb,
    logcat,
    scrcpy,
    display,
    settingsStore,
    processes,
    dialog,
    reactNative,
    readHostClipboard,
  } = params;

  async function getOverview(): Promise<AndroidOverview> {
    const sdk = await resolver.resolve();
    const [devices, avdList] = await Promise.all([
      sdk.adb.available ? adb.listDevices().catch(() => []) : Promise.resolve([]),
      sdk.emulator.available ? avds.list().catch(() => []) : Promise.resolve([]),
    ]);
    return { sdk, devices, avds: avdList };
  }

  async function chooseSdkPath(): Promise<AndroidSdkStatus> {
    const selected = await dialog.showOpenDirectoryDialog({
      title: 'Choose Android SDK folder',
      buttonLabel: 'Use SDK',
    });
    if (selected) await settingsStore.update({ android: { sdkPath: selected } });
    return resolver.resolve();
  }

  async function chooseScrcpyPath(): Promise<AndroidSdkStatus> {
    const selected = await dialog.showOpenFileDialog({
      title: 'Choose scrcpy executable',
      filters:
        process.platform === 'win32' ? [{ name: 'Applications', extensions: ['exe'] }] : undefined,
    });
    if (selected) await settingsStore.update({ android: { scrcpyPath: selected } });
    return resolver.resolve();
  }

  async function restartAdb(): Promise<OkResult> {
    try {
      await adb.restartServer();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: isDomainError(error)
          ? error
          : toBureauError({
              code: 'ADB_UNAVAILABLE',
              message: error instanceof Error ? error.message : 'ADB could not be restarted.',
              operation: 'android.adb.restart',
              retryable: true,
            }),
      };
    }
  }

  async function chooseApk(): Promise<FilePickerResult> {
    return {
      path:
        (await dialog.showOpenFileDialog({
          title: 'Choose APK',
          filters: [{ name: 'Android packages', extensions: ['apk'] }],
        })) ?? null,
    };
  }

  async function chooseRecordingPath(): Promise<FilePickerResult> {
    return {
      path:
        (await dialog.showSaveFileDialog({
          title: 'Save scrcpy recording',
          defaultPath: 'android-recording.mp4',
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
        })) ?? null,
    };
  }

  async function exportLogcat(): Promise<FilePickerResult> {
    const target = await dialog.showSaveFileDialog({
      title: 'Export logcat',
      defaultPath: 'logcat.txt',
      filters: [{ name: 'Text', extensions: ['txt', 'log'] }],
    });
    if (!target) return { path: null };
    const text = logcat
      .snapshot()
      .lines.map((line) =>
        `${line.timestamp ?? ''} ${line.pid ?? ''} ${line.priority}/${line.tag}: ${line.message}`.trim()
      )
      .join('\n');
    await writeFile(target, text + (text ? '\n' : ''), 'utf8');
    return { path: target };
  }

  async function startLogcat(input: LogcatStartRequest): Promise<OkResult> {
    try {
      await logcat.start(input.deviceId, input.filter);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: isDomainError(error)
          ? error
          : toBureauError({
              code: 'COMMAND_FAILED',
              message: error instanceof Error ? error.message : 'Logcat could not be started.',
              operation: 'android.logcat.start',
              retryable: true,
            }),
      };
    }
  }

  async function runFlutter(input: FlutterRunRequest): Promise<OkResult> {
    try {
      const device = await adb.selectDevice(input.deviceId);
      const status = await resolver.resolve();
      if (!status.flutter.path)
        return {
          ok: false,
          error: toBureauError({
            code: 'RUNTIME_NOT_FOUND',
            message: 'Flutter was not found on PATH.',
            operation: 'android.flutter.run',
            retryable: true,
          }),
        };
      const processId = `flutter-${device.id
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')}`.slice(0, 64);
      await processes.saveDefinition({
        projectId: input.projectId,
        definition: {
          id: processId,
          label: `Flutter on ${device.model ?? device.id}`,
          command: status.flutter.path,
          args: ['run', '-d', device.id],
          cwd: '.',
          env: {},
          runMode: 'log',
          autoRestart: false,
          runOnOpen: false,
        },
      });
      return processes.start({ projectId: input.projectId, processId });
    } catch (error) {
      return {
        ok: false,
        error: isDomainError(error)
          ? error
          : toBureauError({
              code: 'COMMAND_FAILED',
              message: error instanceof Error ? error.message : 'Flutter could not be started.',
              operation: 'android.flutter.run',
            }),
      };
    }
  }

  const BUTTON_KEYS: Record<string, string> = {
    back: 'GoBack',
    home: 'GoHome',
    overview: 'AppSwitch',
    power: 'Power',
  };
  const VOLUME_KEYCODES: Record<string, string> = { volumeUp: '24', volumeDown: '25' };

  async function pressDisplayButton(input: EmulatorButtonRequest): Promise<OkResult> {
    const key = BUTTON_KEYS[input.button];
    if (key) return display.pressKey(input.avdName, key);
    try {
      // Volume is not a W3C key value the emulator understands — inject via adb instead.
      const device = await adb.selectDevice(input.deviceId);
      const result = await adb.run(
        ['-s', device.id, 'shell', 'input', 'keyevent', VOLUME_KEYCODES[input.button]],
        10_000
      );
      if (result.code !== 0) throw new Error(result.stderr || 'The key event was rejected.');
      return { ok: true };
    } catch (error) {
      return commandFailure(error, 'android.display.button');
    }
  }

  // The qemu console echoes OK/KO per command; adb exits 0 either way, so KO is the
  // real failure signal for `adb emu …`.
  async function runEmuConsole(
    deviceId: string | undefined,
    command: string[],
    operation: string,
    timeoutMs = 15_000
  ): Promise<{ deviceId: string; stdout: string }> {
    const device = await adb.selectDevice(deviceId);
    const result = await adb.run(['-s', device.id, 'emu', ...command], timeoutMs);
    if (result.code !== 0 || /^KO\b/m.test(result.stdout)) {
      const detail = result.stdout.match(/^KO:?\s*(.*)$/m)?.[1];
      throw toBureauError({
        code: 'COMMAND_FAILED',
        message: detail || result.stderr || 'The emulator console rejected the command.',
        operation,
        subjectId: device.id,
        retryable: true,
      });
    }
    return { deviceId: device.id, stdout: result.stdout };
  }

  async function rotateDevice(input: EmulatorRotateRequest): Promise<OkResult> {
    try {
      await runEmuConsole(input.deviceId, ['rotate'], 'android.display.rotate');
      return { ok: true };
    } catch (error) {
      return commandFailure(error, 'android.display.rotate');
    }
  }

  async function pasteToDevice(input: EmulatorPasteRequest): Promise<OkResult> {
    try {
      const text = readHostClipboard();
      if (!text) {
        return {
          ok: false,
          error: toBureauError({
            code: 'INVALID_REQUEST',
            message: 'The clipboard does not contain text.',
            operation: 'android.display.paste',
          }),
        };
      }
      await display.setClipboard(input.avdName, text);
      // Short single-line text is typed directly so it lands in the focused field;
      // longer or multi-line content stays on the device clipboard for in-app paste.
      if (text.length <= 256 && !/[\r\n]/.test(text)) await display.typeText(input.avdName, text);
      return { ok: true };
    } catch (error) {
      return commandFailure(error, 'android.display.paste');
    }
  }

  async function saveScreenshot(input: EmulatorScreenshotRequest): Promise<FilePickerResult> {
    const png = await display.screenshotPng(input.avdName);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = await dialog.showSaveFileDialog({
      title: 'Save emulator screenshot',
      defaultPath: `${input.avdName}-${stamp}.png`,
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    });
    if (!target) return { path: null };
    await writeFile(target, png);
    return { path: target };
  }

  async function listSnapshots(deviceId?: string): Promise<EmulatorSnapshotListResult> {
    const result = await runEmuConsole(
      deviceId,
      ['avd', 'snapshot', 'list'],
      'android.snapshot.list'
    );
    return { deviceId: result.deviceId, snapshots: parseSnapshotList(result.stdout) };
  }

  async function snapshotAction(
    action: 'save' | 'load',
    input: EmulatorSnapshotRequest
  ): Promise<OkResult> {
    try {
      // Saving/loading a snapshot pauses the VM; allow it a generous window.
      await runEmuConsole(
        input.deviceId,
        ['avd', 'snapshot', action, input.name],
        `android.snapshot.${action}`,
        120_000
      );
      return { ok: true };
    } catch (error) {
      return commandFailure(error, `android.snapshot.${action}`);
    }
  }

  async function sendGeoFix(input: GeoFixRequest): Promise<OkResult> {
    try {
      // qemu expects `geo fix <longitude> <latitude>`.
      await runEmuConsole(
        input.deviceId,
        ['geo', 'fix', String(input.longitude), String(input.latitude)],
        'android.geo.fix'
      );
      return { ok: true };
    } catch (error) {
      return commandFailure(error, 'android.geo.fix');
    }
  }

  function commandFailure(error: unknown, operation: string): OkResult {
    return {
      ok: false,
      error: isDomainError(error)
        ? error
        : toBureauError({
            code: 'COMMAND_FAILED',
            message: error instanceof Error ? error.message : 'The emulator command failed.',
            operation,
            retryable: true,
          }),
    };
  }

  async function dispose(): Promise<void> {
    await logcat.stop();
    scrcpy.dispose();
    display.dispose();
    await avds.dispose();
  }

  return {
    getOverview,
    chooseSdkPath,
    chooseScrcpyPath,
    restartAdb,
    chooseApk,
    chooseRecordingPath,
    startAvd: (input: StartAvdRequest) =>
      avds.start({
        ...input,
        options: {
          ...input.options,
          displayMode:
            input.options.displayMode ?? settingsStore.get().android.emulatorDisplayMode,
        },
      }),
    stopAvd: (input: StopAvdRequest) => avds.stop(input),
    getBootStatus: async (deviceId: string): Promise<AvdBootStatus> => ({
      deviceId,
      booted: await adb.bootStatus(deviceId),
    }),
    listDevices: () => adb.listDevices(),
    installApk: (input: ApkInstallRequest) => adb.install(input),
    launchPackage: (input: ApkLaunchRequest) => adb.launch(input),
    uninstallPackage: (input: ApkUninstallRequest) => adb.uninstall(input),
    listPackages: (deviceId?: string) => adb.listPackages(deviceId),
    startLogcat,
    stopLogcat: () => logcat.stop(),
    pauseLogcat: (input: LogcatPauseRequest) => logcat.setPaused(input.paused),
    clearLogcat: () => logcat.clear(),
    getLogcatSnapshot: () => logcat.snapshot(),
    exportLogcat,
    launchScrcpy: (input: ScrcpyLaunchRequest) => scrcpy.launch(input),
    stopScrcpy: (deviceId?: string) => scrcpy.stop({ deviceId }),
    runFlutter,
    getReactNativeStatus: (input: ReactNativeProjectRequest) =>
      reactNative.getStatus(input.projectId),
    startReactNativeMetro: (input: ReactNativeProjectRequest) =>
      reactNative.startMetro(input.projectId),
    stopReactNativeMetro: (input: ReactNativeProjectRequest) =>
      reactNative.stopMetro(input.projectId),
    runReactNativeAndroid: (input: ReactNativeDeviceRequest) => reactNative.runAndroid(input),
    reverseReactNativePort: (input: ReactNativeDeviceRequest) => reactNative.reversePort(input),
    reloadReactNative: (input: ReactNativeDeviceRequest) => reactNative.reload(input),
    openReactNativeDevMenu: (input: ReactNativeDeviceRequest) => reactNative.openDevMenu(input),
    startDisplay: display.start,
    stopDisplay: (input: EmulatorDisplayStopRequest) => display.stop(input.avdName),
    sendDisplayMouse: display.sendMouse,
    sendDisplayKey: display.sendKey,
    pressDisplayButton,
    rotateDevice,
    pasteToDevice,
    saveScreenshot,
    listSnapshots,
    saveSnapshot: (input: EmulatorSnapshotRequest) => snapshotAction('save', input),
    loadSnapshot: (input: EmulatorSnapshotRequest) => snapshotAction('load', input),
    sendGeoFix,
    onLogcat: logcat.onEvent,
    onDisplay: display.onEvent,
    dispose,
  };
}

function isDomainError(error: unknown): error is import('@shared/contracts/errors').BureauError {
  return typeof error === 'object' && error !== null && 'code' in error && 'operation' in error;
}
