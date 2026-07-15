import { writeFile } from 'node:fs/promises';
import type {
  AndroidOverview,
  AndroidSdkStatus,
  ApkInstallRequest,
  ApkLaunchRequest,
  ApkUninstallRequest,
  AvdBootStatus,
  FilePickerResult,
  FlutterRunRequest,
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
import type { LogcatStreamer } from './LogcatStreamer';
import type { ScrcpyLauncher } from './ScrcpyLauncher';
import type { SdkResolver } from './SdkResolver';
import type { ReactNativeService } from './ReactNativeService';
import { toBureauError } from '../ipc/errors';

export type AndroidApplicationService = ReturnType<typeof createAndroidApplicationService>;

export function createAndroidApplicationService(params: {
  resolver: SdkResolver;
  avds: AvdService;
  adb: AdbService;
  logcat: LogcatStreamer;
  scrcpy: ScrcpyLauncher;
  settingsStore: SettingsStore;
  processes: ProcessApplicationService;
  dialog: NativeDialogAdapter;
  reactNative: ReactNativeService;
}) {
  const { resolver, avds, adb, logcat, scrcpy, settingsStore, processes, dialog, reactNative } =
    params;

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

  async function dispose(): Promise<void> {
    await logcat.stop();
    scrcpy.dispose();
    await avds.dispose();
  }

  return {
    getOverview,
    chooseSdkPath,
    chooseScrcpyPath,
    restartAdb,
    chooseApk,
    chooseRecordingPath,
    startAvd: (input: StartAvdRequest) => avds.start(input),
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
    onLogcat: logcat.onEvent,
    dispose,
  };
}

function isDomainError(error: unknown): error is import('@shared/contracts/errors').BureauError {
  return typeof error === 'object' && error !== null && 'code' in error && 'operation' in error;
}
