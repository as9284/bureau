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
};

export type AndroidOverview = {
  sdk: AndroidSdkStatus;
  avds: AndroidAvd[];
  devices: AndroidDevice[];
};

export type EmulatorGpuMode = 'auto' | 'host' | 'swiftshader_indirect' | 'angle_indirect' | 'off';
export type StartAvdRequest = {
  name: string;
  options: {
    coldBoot: boolean;
    wipeData: boolean;
    gpu: EmulatorGpuMode;
    dnsServer?: string;
    writableSystem: boolean;
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
  pathForFile(file: File): string;
  onLogcat(listener: (event: LogcatEvent) => void): () => void;
};
