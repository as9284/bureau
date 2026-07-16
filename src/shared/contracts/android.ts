import type { OkResult, Result } from './errors';
import type { PackageManager } from './projects';
import type { ProcessStatus } from './processes';

export type AndroidToolCapability = {
  available: boolean;
  path: string | null;
};

export type AndroidSdkStatus = {
  sdkPath: string | null;
  adb: AndroidToolCapability;
  emulator: AndroidToolCapability;
  scrcpy: AndroidToolCapability;
  flutter: AndroidToolCapability;
};

export type AndroidDeviceState = 'device' | 'offline' | 'unauthorized' | 'unknown';
export type AndroidDevice = {
  id: string;
  type: 'emulator' | 'physical';
  state: AndroidDeviceState;
  model?: string;
  product?: string;
  transportId?: string;
  avdName?: string;
  apiLevel?: number;
};

export type AvdState = 'stopped' | 'starting' | 'booting' | 'running' | 'error';
export type AndroidAvd = {
  name: string;
  target?: string;
  apiLevel?: number;
  state: AvdState;
  serial?: string;
  booted: boolean;
  error?: string;
  /** gRPC control port when the emulator exposes one (embedded display available). */
  grpcPort?: number | null;
};

export type AndroidOverview = {
  sdk: AndroidSdkStatus;
  avds: AndroidAvd[];
  devices: AndroidDevice[];
};

export type EmulatorGpuMode = 'auto' | 'host' | 'swiftshader_indirect' | 'angle_indirect' | 'off';
export type EmulatorDisplayMode = 'embedded' | 'window';
export type StartAvdRequest = {
  name: string;
  options: {
    coldBoot: boolean;
    wipeData: boolean;
    gpu: EmulatorGpuMode;
    dnsServer?: string;
    writableSystem: boolean;
    /** Omitted → resolved from settings (android.emulatorDisplayMode). */
    displayMode?: EmulatorDisplayMode;
  };
  confirmedWipe: boolean;
};

export type StopAvdRequest = { name: string; deviceId?: string };
export type AvdBootStatusRequest = { deviceId: string };
export type AvdBootStatus = { deviceId: string; booted: boolean };
export type AndroidDeviceRequest = { deviceId?: string };

export type ApkInstallRequest = AndroidDeviceRequest & { apkPath: string; replace: boolean };
export type ApkInstallResult = Result<{ packageName?: string; message: string }>;
export type ApkLaunchRequest = AndroidDeviceRequest & { packageName: string; activity?: string };
export type ApkUninstallRequest = AndroidDeviceRequest & {
  packageName: string;
  confirmed: boolean;
};
export type AndroidPackagesResult = { deviceId: string; packages: string[] };
export type FilePickerResult = { path: string | null };

export type LogcatPriority = 'V' | 'D' | 'I' | 'W' | 'E' | 'F' | 'S';
export type LogcatFilter = {
  tag?: string;
  priority: LogcatPriority;
  packageName?: string;
  regex?: string;
};
export type LogcatLine = {
  seq: number;
  timestamp?: string;
  pid?: number;
  tid?: number;
  priority: Exclude<LogcatPriority, 'S'>;
  tag: string;
  packageName?: string;
  message: string;
};
export type LogcatStartRequest = { deviceId?: string; filter: LogcatFilter };
export type LogcatPauseRequest = { paused: boolean };
export type LogcatSnapshot = {
  deviceId: string | null;
  running: boolean;
  paused: boolean;
  filter: LogcatFilter;
  lines: LogcatLine[];
};
export type LogcatEvent = { deviceId: string; running: boolean; lines: LogcatLine[] };

export type ScrcpyLaunchRequest = AndroidDeviceRequest & {
  bitrateMbps: number;
  maxSize?: number;
  recordPath?: string;
};

export type FlutterRunRequest = { projectId: string; deviceId?: string };

// ---------- Embedded emulator display ----------

export type EmulatorDisplayState = 'connecting' | 'streaming' | 'stopped' | 'error';
/** Number of 90° content rotations (matches the emulator's SkinRotation enum). */
export type EmulatorDisplayRotation = 0 | 1 | 2 | 3;
export type EmulatorDisplayFrame = {
  seq: number;
  width: number;
  height: number;
  rotation: EmulatorDisplayRotation;
  /** rgba8888 is raw pixels (width*height*4 bytes) — cheap for the emulator to
   *  produce, drawn via putImageData; png is a compressed still (screenshots). */
  format: 'png' | 'rgba8888';
  data: Uint8Array;
};
export type EmulatorDisplayEvent = {
  avdName: string;
  state: EmulatorDisplayState;
  /** Native (unrotated) device screen size, once known. */
  deviceWidth: number | null;
  deviceHeight: number | null;
  error?: string;
  frame?: EmulatorDisplayFrame;
};
export type EmulatorDisplayStartRequest = { avdName: string; width: number; height: number };
export type EmulatorDisplayStopRequest = { avdName: string };
/** x/y are device-frame coordinates (renderer maps from canvas via rotation transform). */
export type EmulatorMouseRequest = { avdName: string; x: number; y: number; buttons: number };
export type EmulatorKeyEventType = 'keydown' | 'keyup' | 'keypress';
export type EmulatorKeyRequest = {
  avdName: string;
  eventType: EmulatorKeyEventType;
  key?: string;
  text?: string;
};
export type EmulatorButton = 'back' | 'home' | 'overview' | 'power' | 'volumeUp' | 'volumeDown';
export type EmulatorButtonRequest = { avdName: string; deviceId?: string; button: EmulatorButton };
export type EmulatorRotateRequest = { deviceId?: string };
export type EmulatorPasteRequest = { avdName: string };
export type EmulatorScreenshotRequest = { avdName: string };
export type EmulatorSnapshot = { name: string; sizeLabel?: string };
export type EmulatorSnapshotListResult = { deviceId: string; snapshots: EmulatorSnapshot[] };
export type EmulatorSnapshotRequest = { deviceId?: string; name: string };
export type GeoFixRequest = { deviceId?: string; latitude: number; longitude: number };

export type ReactNativeProjectRequest = { projectId: string };
export type ReactNativeDeviceRequest = ReactNativeProjectRequest & {
  deviceId?: string;
  port?: number;
  packageName?: string;
};
export type ReactNativeProjectStatus = {
  detected: boolean;
  nativeAndroid: boolean;
  packageManager?: PackageManager;
  metroPort: number;
  autoReverse: boolean;
  metroProcessId: string;
  metroStatus: ProcessStatus;
  androidProcessId?: string;
  androidStatus?: ProcessStatus;
  startScriptAvailable: boolean;
  androidScriptAvailable: boolean;
  packageName?: string;
  reason?: string;
};

export type AndroidApi = {
  getOverview(): Promise<AndroidOverview>;
  chooseSdkPath(): Promise<AndroidSdkStatus>;
  chooseScrcpyPath(): Promise<AndroidSdkStatus>;
  restartAdb(): Promise<OkResult>;
  chooseApk(): Promise<FilePickerResult>;
  chooseRecordingPath(): Promise<FilePickerResult>;
  startAvd(input: StartAvdRequest): Promise<OkResult>;
  stopAvd(input: StopAvdRequest): Promise<OkResult>;
  getBootStatus(input: AvdBootStatusRequest): Promise<AvdBootStatus>;
  listDevices(): Promise<AndroidDevice[]>;
  installApk(input: ApkInstallRequest): Promise<ApkInstallResult>;
  launchPackage(input: ApkLaunchRequest): Promise<OkResult>;
  uninstallPackage(input: ApkUninstallRequest): Promise<OkResult>;
  listPackages(input: AndroidDeviceRequest): Promise<AndroidPackagesResult>;
  startLogcat(input: LogcatStartRequest): Promise<OkResult>;
  stopLogcat(): Promise<void>;
  pauseLogcat(input: LogcatPauseRequest): Promise<LogcatSnapshot>;
  clearLogcat(): Promise<LogcatSnapshot>;
  getLogcatSnapshot(): Promise<LogcatSnapshot>;
  exportLogcat(): Promise<FilePickerResult>;
  launchScrcpy(input: ScrcpyLaunchRequest): Promise<OkResult>;
  stopScrcpy(input: AndroidDeviceRequest): Promise<OkResult>;
  runFlutter(input: FlutterRunRequest): Promise<OkResult>;
  getReactNativeStatus(input: ReactNativeProjectRequest): Promise<ReactNativeProjectStatus>;
  startReactNativeMetro(input: ReactNativeProjectRequest): Promise<OkResult>;
  stopReactNativeMetro(input: ReactNativeProjectRequest): Promise<OkResult>;
  runReactNativeAndroid(input: ReactNativeDeviceRequest): Promise<OkResult>;
  reverseReactNativePort(input: ReactNativeDeviceRequest): Promise<OkResult>;
  reloadReactNative(input: ReactNativeDeviceRequest): Promise<OkResult>;
  openReactNativeDevMenu(input: ReactNativeDeviceRequest): Promise<OkResult>;
  startDisplay(input: EmulatorDisplayStartRequest): Promise<OkResult>;
  stopDisplay(input: EmulatorDisplayStopRequest): Promise<OkResult>;
  sendDisplayMouse(input: EmulatorMouseRequest): Promise<OkResult>;
  sendDisplayKey(input: EmulatorKeyRequest): Promise<OkResult>;
  pressDisplayButton(input: EmulatorButtonRequest): Promise<OkResult>;
  rotateDevice(input: EmulatorRotateRequest): Promise<OkResult>;
  pasteToDevice(input: EmulatorPasteRequest): Promise<OkResult>;
  saveScreenshot(input: EmulatorScreenshotRequest): Promise<FilePickerResult>;
  listSnapshots(input: AndroidDeviceRequest): Promise<EmulatorSnapshotListResult>;
  saveSnapshot(input: EmulatorSnapshotRequest): Promise<OkResult>;
  loadSnapshot(input: EmulatorSnapshotRequest): Promise<OkResult>;
  sendGeoFix(input: GeoFixRequest): Promise<OkResult>;
  pathForFile(file: File): string;
  onLogcat(listener: (event: LogcatEvent) => void): () => void;
  onDisplay(listener: (event: EmulatorDisplayEvent) => void): () => void;
};
