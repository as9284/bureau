import { ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/channels';
import type { BureauApiV1, Unsubscribe } from '@shared/contracts/api';
import type { AppCapabilities } from '@shared/contracts/capabilities';
import type {
  AddProjectRequest,
  ProjectIdRequest,
  RemoveProcessRequest,
  SaveProcessRequest,
  StackDetectionResult,
  TrackedProject,
} from '@shared/contracts/projects';
import type {
  LogSnapshot,
  ProcessOutputEvent,
  ProcessStatusEvent,
  ProcessTargetRequest,
  ProjectProcesses,
} from '@shared/contracts/processes';
import type { OkResult, Result } from '@shared/contracts/errors';
import type {
  PreviewBounds,
  PreviewConsoleMessage,
  PreviewHotkey,
  PreviewNavigateRequest,
  PreviewOpenExternalRequest,
  PreviewSetVisibleRequest,
  PreviewState,
} from '@shared/contracts/preview';
import type {
  CloseRequestedEvent,
  ShutdownBeginEvent,
  ShutdownProgressEvent,
} from '@shared/contracts/lifecycle';
import { createGitBridge } from './gitBridge';
import type { ChooseDirectoryRequest, ChooseDirectoryResult } from '@shared/contracts/system';
import type {
  EditorPreset,
  PublicSettings,
  SettingsPatch,
  TerminalPreset,
} from '@shared/contracts/settings';
import type {
  AndroidDevice,
  AndroidOverview,
  AndroidPackagesResult,
  AndroidSdkStatus,
  ApkInstallRequest,
  ApkInstallResult,
  ApkLaunchRequest,
  ApkUninstallRequest,
  AvdBootStatus,
  AvdBootStatusRequest,
  FilePickerResult,
  FlutterRunRequest,
  LogcatEvent,
  LogcatPauseRequest,
  LogcatSnapshot,
  LogcatStartRequest,
  ScrcpyLaunchRequest,
  StartAvdRequest,
  StopAvdRequest,
  AndroidDeviceRequest,
  ReactNativeDeviceRequest,
  ReactNativeProjectRequest,
  ReactNativeProjectStatus,
} from '@shared/contracts/android';
import type { ProjectToolchains, SetActiveVersionRequest } from '@shared/contracts/toolchains';
import type { KillPortRequest, ProjectPorts } from '@shared/contracts/ports';
import type { ProjectTasks, RunTaskRequest } from '@shared/contracts/tasks';
import { createFilesBridge } from './filesBridge';
import type { AppUpdateState } from '@shared/contracts/updates';

function invoke<T>(channel: string, arg?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, arg) as Promise<T>;
}

const gitBridge = createGitBridge(invoke);

function subscribe<T>(channel: string, listener: (payload: T) => void): Unsubscribe {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const filesBridge = createFilesBridge(invoke, subscribe);

export const bureauApi = Object.freeze({
  files: filesBridge,
  app: {
    getCapabilities: () => invoke<AppCapabilities>(IPC_CHANNELS.APP_GET_CAPABILITIES),
    minimizeWindow: () => invoke<void>(IPC_CHANNELS.APP_WINDOW_MINIMIZE),
    toggleMaximizeWindow: () => invoke<void>(IPC_CHANNELS.APP_WINDOW_TOGGLE_MAXIMIZE),
    closeWindow: () => invoke<void>(IPC_CHANNELS.APP_WINDOW_CLOSE),
    confirmQuit: () => invoke<void>(IPC_CHANNELS.APP_CONFIRM_QUIT),
    cancelQuit: () => invoke<void>(IPC_CHANNELS.APP_CANCEL_QUIT),
    setDirtyFiles: (input: { count: number }) =>
      invoke<void>(IPC_CHANNELS.APP_SET_DIRTY_FILES, input),
    getUpdateState: () => invoke<AppUpdateState>(IPC_CHANNELS.APP_UPDATES_GET_STATE),
    checkForUpdates: () => invoke<AppUpdateState>(IPC_CHANNELS.APP_UPDATES_CHECK),
    installUpdate: () => invoke<boolean>(IPC_CHANNELS.APP_UPDATES_INSTALL),
    onCloseRequested: (listener: (event: CloseRequestedEvent) => void) =>
      subscribe<CloseRequestedEvent>(IPC_CHANNELS.APP_CLOSE_REQUESTED, listener),
    onShutdownBegin: (listener: (event: ShutdownBeginEvent) => void) =>
      subscribe<ShutdownBeginEvent>(IPC_CHANNELS.APP_SHUTDOWN_BEGIN, listener),
    onShutdownProgress: (listener: (event: ShutdownProgressEvent) => void) =>
      subscribe<ShutdownProgressEvent>(IPC_CHANNELS.APP_SHUTDOWN_PROGRESS, listener),
    onUpdateState: (listener: (state: AppUpdateState) => void) =>
      subscribe<AppUpdateState>(IPC_CHANNELS.APP_UPDATES_STATE_EVENT, listener),
  },
  projects: {
    list: () => invoke<TrackedProject[]>(IPC_CHANNELS.PROJECTS_LIST),
    detect: (input: AddProjectRequest) =>
      invoke<StackDetectionResult>(IPC_CHANNELS.PROJECTS_DETECT, input),
    add: (input: AddProjectRequest) =>
      invoke<Result<{ project: TrackedProject }>>(IPC_CHANNELS.PROJECTS_ADD, input),
    remove: (input: ProjectIdRequest) => invoke<void>(IPC_CHANNELS.PROJECTS_REMOVE, input),
    touch: (input: ProjectIdRequest) => invoke<TrackedProject>(IPC_CHANNELS.PROJECTS_TOUCH, input),
  },
  processes: {
    list: (input: ProjectIdRequest) => invoke<ProjectProcesses>(IPC_CHANNELS.PROCESSES_LIST, input),
    start: (input: ProcessTargetRequest) => invoke<OkResult>(IPC_CHANNELS.PROCESSES_START, input),
    stop: (input: ProcessTargetRequest) => invoke<OkResult>(IPC_CHANNELS.PROCESSES_STOP, input),
    restart: (input: ProcessTargetRequest) =>
      invoke<OkResult>(IPC_CHANNELS.PROCESSES_RESTART, input),
    stopAll: (input: ProjectIdRequest) => invoke<void>(IPC_CHANNELS.PROCESSES_STOP_ALL, input),
    getLog: (input: ProcessTargetRequest) =>
      invoke<LogSnapshot>(IPC_CHANNELS.PROCESSES_GET_LOG, input),
    saveDefinition: (input: SaveProcessRequest) =>
      invoke<ProjectProcesses>(IPC_CHANNELS.PROCESSES_SAVE_DEFINITION, input),
    removeDefinition: (input: RemoveProcessRequest) =>
      invoke<ProjectProcesses>(IPC_CHANNELS.PROCESSES_REMOVE_DEFINITION, input),
    writePty: (input: { projectId: string; processId: string; data: string }) =>
      invoke<void>(IPC_CHANNELS.PROCESSES_PTY_WRITE, input),
    resizePty: (input: { projectId: string; processId: string; cols: number; rows: number }) =>
      invoke<void>(IPC_CHANNELS.PROCESSES_PTY_RESIZE, input),
    onOutput: (listener: (event: ProcessOutputEvent) => void) =>
      subscribe<ProcessOutputEvent>(IPC_CHANNELS.PROCESSES_OUTPUT_EVENT, listener),
    onStatus: (listener: (event: ProcessStatusEvent) => void) =>
      subscribe<ProcessStatusEvent>(IPC_CHANNELS.PROCESSES_STATUS_EVENT, listener),
    onPty: (listener: (event: { projectId: string; processId: string; data: string }) => void) =>
      subscribe(IPC_CHANNELS.PROCESSES_PTY_EVENT, listener),
  },
  preview: {
    setBounds: (bounds: PreviewBounds) => invoke<void>(IPC_CHANNELS.PREVIEW_SET_BOUNDS, bounds),
    navigate: (input: PreviewNavigateRequest) => invoke<void>(IPC_CHANNELS.PREVIEW_NAVIGATE, input),
    reload: () => invoke<void>(IPC_CHANNELS.PREVIEW_RELOAD),
    reloadHard: () => invoke<void>(IPC_CHANNELS.PREVIEW_RELOAD_HARD),
    back: () => invoke<void>(IPC_CHANNELS.PREVIEW_BACK),
    forward: () => invoke<void>(IPC_CHANNELS.PREVIEW_FORWARD),
    setVisible: (input: PreviewSetVisibleRequest) =>
      invoke<void>(IPC_CHANNELS.PREVIEW_SET_VISIBLE, input),
    openExternal: (input: PreviewOpenExternalRequest) =>
      invoke<void>(IPC_CHANNELS.PREVIEW_OPEN_EXTERNAL, input),
    openDevTools: () => invoke<void>(IPC_CHANNELS.PREVIEW_OPEN_DEVTOOLS),
    setZoom: (input: { factor: number }) => invoke<void>(IPC_CHANNELS.PREVIEW_SET_ZOOM, input),
    clearConsole: () => invoke<void>(IPC_CHANNELS.PREVIEW_CLEAR_CONSOLE),
    onState: (listener: (state: PreviewState) => void) =>
      subscribe<PreviewState>(IPC_CHANNELS.PREVIEW_STATE_EVENT, listener),
    onHotkey: (listener: (hotkey: PreviewHotkey) => void) =>
      subscribe<PreviewHotkey>(IPC_CHANNELS.PREVIEW_HOTKEY_EVENT, listener),
    onConsole: (listener: (messages: PreviewConsoleMessage[]) => void) =>
      subscribe<PreviewConsoleMessage[]>(IPC_CHANNELS.PREVIEW_CONSOLE_EVENT, listener),
  },
  system: {
    chooseDirectory: (input: ChooseDirectoryRequest) =>
      invoke<ChooseDirectoryResult>(IPC_CHANNELS.SYSTEM_CHOOSE_DIRECTORY, input),
    openInEditor: (input: { projectId: string }) =>
      invoke<OkResult>(IPC_CHANNELS.SYSTEM_OPEN_IN_EDITOR, input),
    openInTerminal: (input: { projectId: string }) =>
      invoke<OkResult>(IPC_CHANNELS.SYSTEM_OPEN_IN_TERMINAL, input),
    openInExplorer: (input: { projectId: string }) =>
      invoke<OkResult>(IPC_CHANNELS.SYSTEM_OPEN_IN_EXPLORER, input),
  },
  operations: gitBridge.operations,
  github: gitBridge.github,
  git: gitBridge.git,
  settings: {
    get: () => invoke<PublicSettings>(IPC_CHANNELS.SETTINGS_GET),
    update: (patch: SettingsPatch) => invoke<PublicSettings>(IPC_CHANNELS.SETTINGS_UPDATE, patch),
    chooseGitExecutable: () => invoke<PublicSettings>(IPC_CHANNELS.SETTINGS_CHOOSE_GIT_EXECUTABLE),
    clearGitExecutable: () => invoke<PublicSettings>(IPC_CHANNELS.SETTINGS_CLEAR_GIT_EXECUTABLE),
    chooseCustomEditor: () => invoke<PublicSettings>(IPC_CHANNELS.SETTINGS_CHOOSE_CUSTOM_EDITOR),
    setEditorPreset: (input: { preset: EditorPreset | 'none' }) =>
      invoke<PublicSettings>(IPC_CHANNELS.SETTINGS_SET_EDITOR_PRESET, input),
    chooseCustomTerminal: () =>
      invoke<PublicSettings>(IPC_CHANNELS.SETTINGS_CHOOSE_CUSTOM_TERMINAL),
    setTerminalPreset: (input: { preset: TerminalPreset | 'auto' }) =>
      invoke<PublicSettings>(IPC_CHANNELS.SETTINGS_SET_TERMINAL_PRESET, input),
  },
  android: {
    getOverview: () => invoke<AndroidOverview>(IPC_CHANNELS.ANDROID_GET_OVERVIEW),
    chooseSdkPath: () => invoke<AndroidSdkStatus>(IPC_CHANNELS.ANDROID_CHOOSE_SDK),
    chooseScrcpyPath: () => invoke<AndroidSdkStatus>(IPC_CHANNELS.ANDROID_CHOOSE_SCRCPY),
    restartAdb: () => invoke<OkResult>(IPC_CHANNELS.ANDROID_ADB_RESTART),
    chooseApk: () => invoke<FilePickerResult>(IPC_CHANNELS.ANDROID_CHOOSE_APK),
    chooseRecordingPath: () => invoke<FilePickerResult>(IPC_CHANNELS.ANDROID_CHOOSE_RECORDING),
    startAvd: (input: StartAvdRequest) => invoke<OkResult>(IPC_CHANNELS.ANDROID_AVD_START, input),
    stopAvd: (input: StopAvdRequest) => invoke<OkResult>(IPC_CHANNELS.ANDROID_AVD_STOP, input),
    getBootStatus: (input: AvdBootStatusRequest) =>
      invoke<AvdBootStatus>(IPC_CHANNELS.ANDROID_AVD_BOOT_STATUS, input),
    listDevices: () => invoke<AndroidDevice[]>(IPC_CHANNELS.ANDROID_DEVICES_LIST),
    installApk: (input: ApkInstallRequest) =>
      invoke<ApkInstallResult>(IPC_CHANNELS.ANDROID_APK_INSTALL, input),
    launchPackage: (input: ApkLaunchRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_APK_LAUNCH, input),
    uninstallPackage: (input: ApkUninstallRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_APK_UNINSTALL, input),
    listPackages: (input: AndroidDeviceRequest) =>
      invoke<AndroidPackagesResult>(IPC_CHANNELS.ANDROID_PACKAGES_LIST, input),
    startLogcat: (input: LogcatStartRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_LOGCAT_START, input),
    stopLogcat: () => invoke<void>(IPC_CHANNELS.ANDROID_LOGCAT_STOP),
    pauseLogcat: (input: LogcatPauseRequest) =>
      invoke<LogcatSnapshot>(IPC_CHANNELS.ANDROID_LOGCAT_PAUSE, input),
    clearLogcat: () => invoke<LogcatSnapshot>(IPC_CHANNELS.ANDROID_LOGCAT_CLEAR),
    getLogcatSnapshot: () => invoke<LogcatSnapshot>(IPC_CHANNELS.ANDROID_LOGCAT_SNAPSHOT),
    exportLogcat: () => invoke<FilePickerResult>(IPC_CHANNELS.ANDROID_LOGCAT_EXPORT),
    launchScrcpy: (input: ScrcpyLaunchRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_SCRCPY_START, input),
    stopScrcpy: (input: AndroidDeviceRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_SCRCPY_STOP, input),
    runFlutter: (input: FlutterRunRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_FLUTTER_RUN, input),
    getReactNativeStatus: (input: ReactNativeProjectRequest) =>
      invoke<ReactNativeProjectStatus>(IPC_CHANNELS.ANDROID_REACT_NATIVE_STATUS, input),
    startReactNativeMetro: (input: ReactNativeProjectRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_REACT_NATIVE_METRO_START, input),
    stopReactNativeMetro: (input: ReactNativeProjectRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_REACT_NATIVE_METRO_STOP, input),
    runReactNativeAndroid: (input: ReactNativeDeviceRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_REACT_NATIVE_RUN, input),
    reverseReactNativePort: (input: ReactNativeDeviceRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_REACT_NATIVE_REVERSE, input),
    reloadReactNative: (input: ReactNativeDeviceRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_REACT_NATIVE_RELOAD, input),
    openReactNativeDevMenu: (input: ReactNativeDeviceRequest) =>
      invoke<OkResult>(IPC_CHANNELS.ANDROID_REACT_NATIVE_DEV_MENU, input),
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    onLogcat: (listener: (event: LogcatEvent) => void) =>
      subscribe<LogcatEvent>(IPC_CHANNELS.ANDROID_LOGCAT_EVENT, listener),
  },
  toolchains: {
    get: (input: ProjectIdRequest) => invoke<ProjectToolchains>(IPC_CHANNELS.TOOLCHAINS_GET, input),
    setActive: (input: SetActiveVersionRequest) =>
      invoke<OkResult & { toolchains: ProjectToolchains }>(
        IPC_CHANNELS.TOOLCHAINS_SET_ACTIVE,
        input
      ),
  },
  ports: {
    list: (input: ProjectIdRequest) => invoke<ProjectPorts>(IPC_CHANNELS.PORTS_LIST, input),
    kill: (input: KillPortRequest) => invoke<OkResult>(IPC_CHANNELS.PORTS_KILL, input),
  },
  tasks: {
    list: (input: ProjectIdRequest) => invoke<ProjectTasks>(IPC_CHANNELS.TASKS_LIST, input),
    run: (input: RunTaskRequest) => invoke<OkResult>(IPC_CHANNELS.TASKS_RUN, input),
  },
}) as unknown as BureauApiV1;
