import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/contracts/channels';
import {
  addProjectRequestSchema,
  chooseDirectoryRequestSchema,
  detectRequestSchema,
  previewBoundsSchema,
  previewNavigateSchema,
  previewOpenExternalSchema,
  previewSetVisibleSchema,
  previewSetZoomSchema,
  processTargetRequestSchema,
  projectIdRequestSchema,
  reorderPinnedRequestSchema,
  setPinnedRequestSchema,
  removeProcessRequestSchema,
  saveProcessRequestSchema,
  setEditorPresetSchema,
  setTerminalPresetSchema,
  settingsPatchSchema,
  androidDeviceRequestSchema,
  apkInstallRequestSchema,
  apkLaunchRequestSchema,
  apkUninstallRequestSchema,
  avdBootStatusRequestSchema,
  flutterRunRequestSchema,
  reactNativeDeviceRequestSchema,
  reactNativeProjectRequestSchema,
  logcatPauseRequestSchema,
  logcatStartRequestSchema,
  scrcpyLaunchRequestSchema,
  startAvdRequestSchema,
  stopAvdRequestSchema,
  setActiveVersionRequestSchema,
  killPortRequestSchema,
  runTaskRequestSchema,
  ptyWriteRequestSchema,
  ptyResizeRequestSchema,
} from '@shared/validation/requests';
import { assertTrustedSender, InvalidSenderError } from './senderValidation';
import { throwMappedError, toBureauError } from './errors';
import type { AppServices } from './serviceContracts';
import { registerGitHandlers } from './registerGitHandlers';
import { registerFileHandlers } from './registerFileHandlers';
import type { UpdateService } from '../app/UpdateService';

export function registerHandlers(
  services: AppServices,
  options?: { updates?: UpdateService }
): () => void {
  const handlers: Array<{ channel: string; remove: () => void }> = [];

  function register<T, R>(
    channel: string,
    operation: string,
    handler: (args: T, event: Electron.IpcMainInvokeEvent) => Promise<R>
  ): void {
    if (ipcMain.eventNames().includes(channel)) {
      throw new Error(`Handler already registered for channel ${channel}`);
    }

    const wrapped = async (event: Electron.IpcMainInvokeEvent, args: unknown): Promise<R> => {
      try {
        assertTrustedSender(event);
        return await handler(args as T, event);
      } catch (error) {
        if (error instanceof InvalidSenderError) {
          throwMappedError(
            toBureauError({
              code: 'INVALID_SENDER',
              message: error.message,
              operation,
              retryable: false,
            }),
            operation
          );
        }
        throwMappedError(error, operation);
      }
    };

    ipcMain.handle(channel, wrapped);
    handlers.push({ channel, remove: () => ipcMain.removeHandler(channel) });
  }

  register(IPC_CHANNELS.APP_GET_CAPABILITIES, 'app.getCapabilities', async () => {
    return services.capabilities.getCapabilities();
  });

  register(IPC_CHANNELS.APP_WINDOW_MINIMIZE, 'app.window.minimize', async (_args, event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  register(
    IPC_CHANNELS.APP_WINDOW_TOGGLE_MAXIMIZE,
    'app.window.toggleMaximize',
    async (_args, event) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;
      if (window.isMaximized()) {
        window.unmaximize();
      } else {
        window.maximize();
      }
    }
  );

  register(IPC_CHANNELS.APP_WINDOW_CLOSE, 'app.window.close', async (_args, event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  register(IPC_CHANNELS.APP_SET_DIRTY_FILES, 'app.setDirtyFiles', async (args: unknown) => {
    const input = z.object({ count: z.number().int().min(0).max(1000) }).parse(args);
    services.files.setDirtyFileCount(input.count);
  });

  if (options?.updates) {
    register(IPC_CHANNELS.APP_UPDATES_GET_STATE, 'app.updates.getState', async () =>
      options.updates!.getState()
    );
    register(IPC_CHANNELS.APP_UPDATES_CHECK, 'app.updates.check', async () =>
      options.updates!.checkForUpdates()
    );
  }

  register(IPC_CHANNELS.PROJECTS_LIST, 'projects.list', async () => {
    return services.projects.list();
  });

  register(IPC_CHANNELS.PROJECTS_DETECT, 'projects.detect', async (args: unknown) => {
    const input = detectRequestSchema.parse(args);
    return services.projects.detect(input);
  });

  register(IPC_CHANNELS.PROJECTS_ADD, 'projects.add', async (args: unknown) => {
    const input = addProjectRequestSchema.parse(args);
    return services.projects.add(input);
  });

  register(IPC_CHANNELS.PROJECTS_REMOVE, 'projects.remove', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.projects.remove(input);
  });

  register(IPC_CHANNELS.PROJECTS_TOUCH, 'projects.touch', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.projects.touch(input);
  });

  register(IPC_CHANNELS.PROJECTS_SET_PINNED, 'projects.setPinned', async (args: unknown) => {
    const input = setPinnedRequestSchema.parse(args);
    return services.projects.setPinned(input);
  });

  register(
    IPC_CHANNELS.PROJECTS_REORDER_PINNED,
    'projects.reorderPinned',
    async (args: unknown) => {
      const input = reorderPinnedRequestSchema.parse(args);
      return services.projects.reorderPinned(input);
    }
  );

  registerFileHandlers(services, register);

  register(IPC_CHANNELS.PROCESSES_LIST, 'processes.list', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.processes.list(input);
  });

  register(IPC_CHANNELS.PROCESSES_START, 'processes.start', async (args: unknown) => {
    const input = processTargetRequestSchema.parse(args);
    return services.processes.start(input);
  });

  register(IPC_CHANNELS.PROCESSES_STOP, 'processes.stop', async (args: unknown) => {
    const input = processTargetRequestSchema.parse(args);
    return services.processes.stop(input);
  });

  register(IPC_CHANNELS.PROCESSES_RESTART, 'processes.restart', async (args: unknown) => {
    const input = processTargetRequestSchema.parse(args);
    return services.processes.restart(input);
  });

  register(IPC_CHANNELS.PROCESSES_STOP_ALL, 'processes.stopAll', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.processes.stopAll(input);
  });

  register(IPC_CHANNELS.PROCESSES_GET_LOG, 'processes.getLog', async (args: unknown) => {
    const input = processTargetRequestSchema.parse(args);
    return services.processes.getLog(input);
  });

  register(
    IPC_CHANNELS.PROCESSES_SAVE_DEFINITION,
    'processes.saveDefinition',
    async (args: unknown) => {
      const input = saveProcessRequestSchema.parse(args);
      return services.processes.saveDefinition(input);
    }
  );

  register(
    IPC_CHANNELS.PROCESSES_REMOVE_DEFINITION,
    'processes.removeDefinition',
    async (args: unknown) => {
      const input = removeProcessRequestSchema.parse(args);
      return services.processes.removeDefinition(input);
    }
  );

  register(IPC_CHANNELS.PROCESSES_PTY_WRITE, 'processes.ptyWrite', async (args: unknown) => {
    const input = ptyWriteRequestSchema.parse(args);
    return services.processes.writePty(input);
  });

  register(IPC_CHANNELS.PROCESSES_PTY_RESIZE, 'processes.ptyResize', async (args: unknown) => {
    const input = ptyResizeRequestSchema.parse(args);
    return services.processes.resizePty(input);
  });

  register(IPC_CHANNELS.PREVIEW_SET_BOUNDS, 'preview.setBounds', async (args: unknown) => {
    services.preview.setBounds(previewBoundsSchema.parse(args));
  });

  register(IPC_CHANNELS.PREVIEW_NAVIGATE, 'preview.navigate', async (args: unknown) => {
    services.preview.navigate(previewNavigateSchema.parse(args).url);
  });

  register(IPC_CHANNELS.PREVIEW_RELOAD, 'preview.reload', async () => {
    services.preview.reload();
  });

  register(IPC_CHANNELS.PREVIEW_RELOAD_HARD, 'preview.reloadHard', async () => {
    services.preview.reloadHard();
  });

  register(IPC_CHANNELS.PREVIEW_BACK, 'preview.back', async () => {
    services.preview.back();
  });

  register(IPC_CHANNELS.PREVIEW_FORWARD, 'preview.forward', async () => {
    services.preview.forward();
  });

  register(IPC_CHANNELS.PREVIEW_SET_VISIBLE, 'preview.setVisible', async (args: unknown) => {
    services.preview.setVisible(previewSetVisibleSchema.parse(args).visible);
  });

  register(IPC_CHANNELS.PREVIEW_OPEN_EXTERNAL, 'preview.openExternal', async (args: unknown) => {
    services.preview.openExternal(previewOpenExternalSchema.parse(args).url);
  });

  register(IPC_CHANNELS.PREVIEW_OPEN_DEVTOOLS, 'preview.openDevTools', async () => {
    services.preview.openDevTools();
  });

  register(IPC_CHANNELS.PREVIEW_SET_ZOOM, 'preview.setZoom', async (args: unknown) => {
    const input = previewSetZoomSchema.parse(args);
    services.preview.setZoomFactor(input.factor);
  });

  register(IPC_CHANNELS.PREVIEW_CLEAR_CONSOLE, 'preview.clearConsole', async () => {
    services.preview.clearConsoleErrors();
  });

  register(
    IPC_CHANNELS.SYSTEM_CHOOSE_DIRECTORY,
    'system.chooseDirectory',
    async (args: unknown) => {
      const input = chooseDirectoryRequestSchema.parse(args ?? {});
      return services.system.chooseDirectory(input);
    }
  );

  register(IPC_CHANNELS.SYSTEM_OPEN_IN_EDITOR, 'system.openInEditor', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.system.openInEditor(input);
  });

  register(IPC_CHANNELS.SYSTEM_OPEN_IN_TERMINAL, 'system.openInTerminal', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.system.openInTerminal(input);
  });

  register(IPC_CHANNELS.SYSTEM_OPEN_IN_EXPLORER, 'system.openInExplorer', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.system.openInExplorer(input);
  });

  registerGitHandlers(services, register);

  register(IPC_CHANNELS.ANDROID_GET_OVERVIEW, 'android.getOverview', async () =>
    services.android.getOverview()
  );
  register(IPC_CHANNELS.ANDROID_CHOOSE_SDK, 'android.chooseSdkPath', async () =>
    services.android.chooseSdkPath()
  );
  register(IPC_CHANNELS.ANDROID_CHOOSE_SCRCPY, 'android.chooseScrcpyPath', async () =>
    services.android.chooseScrcpyPath()
  );
  register(IPC_CHANNELS.ANDROID_ADB_RESTART, 'android.restartAdb', async () =>
    services.android.restartAdb()
  );
  register(IPC_CHANNELS.ANDROID_CHOOSE_APK, 'android.chooseApk', async () =>
    services.android.chooseApk()
  );
  register(IPC_CHANNELS.ANDROID_CHOOSE_RECORDING, 'android.chooseRecordingPath', async () =>
    services.android.chooseRecordingPath()
  );
  register(IPC_CHANNELS.ANDROID_AVD_START, 'android.avd.start', async (args: unknown) =>
    services.android.startAvd(startAvdRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.ANDROID_AVD_STOP, 'android.avd.stop', async (args: unknown) =>
    services.android.stopAvd(stopAvdRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.ANDROID_AVD_BOOT_STATUS, 'android.avd.bootStatus', async (args: unknown) =>
    services.android.getBootStatus(avdBootStatusRequestSchema.parse(args).deviceId)
  );
  register(IPC_CHANNELS.ANDROID_DEVICES_LIST, 'android.devices.list', async () =>
    services.android.listDevices()
  );
  register(IPC_CHANNELS.ANDROID_APK_INSTALL, 'android.apk.install', async (args: unknown) =>
    services.android.installApk(apkInstallRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.ANDROID_APK_LAUNCH, 'android.apk.launch', async (args: unknown) =>
    services.android.launchPackage(apkLaunchRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.ANDROID_APK_UNINSTALL, 'android.apk.uninstall', async (args: unknown) =>
    services.android.uninstallPackage(apkUninstallRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.ANDROID_PACKAGES_LIST, 'android.packages.list', async (args: unknown) =>
    services.android.listPackages(androidDeviceRequestSchema.parse(args).deviceId)
  );
  register(IPC_CHANNELS.ANDROID_LOGCAT_START, 'android.logcat.start', async (args: unknown) =>
    services.android.startLogcat(logcatStartRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.ANDROID_LOGCAT_STOP, 'android.logcat.stop', async () =>
    services.android.stopLogcat()
  );
  register(IPC_CHANNELS.ANDROID_LOGCAT_PAUSE, 'android.logcat.pause', async (args: unknown) =>
    services.android.pauseLogcat(logcatPauseRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.ANDROID_LOGCAT_CLEAR, 'android.logcat.clear', async () =>
    services.android.clearLogcat()
  );
  register(IPC_CHANNELS.ANDROID_LOGCAT_SNAPSHOT, 'android.logcat.snapshot', async () =>
    services.android.getLogcatSnapshot()
  );
  register(IPC_CHANNELS.ANDROID_LOGCAT_EXPORT, 'android.logcat.export', async () =>
    services.android.exportLogcat()
  );
  register(IPC_CHANNELS.ANDROID_SCRCPY_START, 'android.scrcpy.start', async (args: unknown) =>
    services.android.launchScrcpy(scrcpyLaunchRequestSchema.parse(args))
  );
  register(IPC_CHANNELS.ANDROID_SCRCPY_STOP, 'android.scrcpy.stop', async (args: unknown) =>
    services.android.stopScrcpy(androidDeviceRequestSchema.parse(args).deviceId)
  );
  register(IPC_CHANNELS.ANDROID_FLUTTER_RUN, 'android.flutter.run', async (args: unknown) =>
    services.android.runFlutter(flutterRunRequestSchema.parse(args))
  );
  register(
    IPC_CHANNELS.ANDROID_REACT_NATIVE_STATUS,
    'android.reactNative.status',
    async (args: unknown) =>
      services.android.getReactNativeStatus(reactNativeProjectRequestSchema.parse(args))
  );
  register(
    IPC_CHANNELS.ANDROID_REACT_NATIVE_METRO_START,
    'android.reactNative.metro.start',
    async (args: unknown) =>
      services.android.startReactNativeMetro(reactNativeProjectRequestSchema.parse(args))
  );
  register(
    IPC_CHANNELS.ANDROID_REACT_NATIVE_METRO_STOP,
    'android.reactNative.metro.stop',
    async (args: unknown) =>
      services.android.stopReactNativeMetro(reactNativeProjectRequestSchema.parse(args))
  );
  register(
    IPC_CHANNELS.ANDROID_REACT_NATIVE_RUN,
    'android.reactNative.run',
    async (args: unknown) =>
      services.android.runReactNativeAndroid(reactNativeDeviceRequestSchema.parse(args))
  );
  register(
    IPC_CHANNELS.ANDROID_REACT_NATIVE_REVERSE,
    'android.reactNative.reverse',
    async (args: unknown) =>
      services.android.reverseReactNativePort(reactNativeDeviceRequestSchema.parse(args))
  );
  register(
    IPC_CHANNELS.ANDROID_REACT_NATIVE_RELOAD,
    'android.reactNative.reload',
    async (args: unknown) =>
      services.android.reloadReactNative(reactNativeDeviceRequestSchema.parse(args))
  );
  register(
    IPC_CHANNELS.ANDROID_REACT_NATIVE_DEV_MENU,
    'android.reactNative.devMenu',
    async (args: unknown) =>
      services.android.openReactNativeDevMenu(reactNativeDeviceRequestSchema.parse(args))
  );

  register(IPC_CHANNELS.SETTINGS_GET, 'settings.get', async () => {
    return services.settings.get();
  });

  register(IPC_CHANNELS.SETTINGS_UPDATE, 'settings.update', async (args: unknown) => {
    const patch = settingsPatchSchema.parse(args);
    return services.settings.update(patch);
  });

  register(IPC_CHANNELS.SETTINGS_CHOOSE_GIT_EXECUTABLE, 'settings.chooseGitExecutable', async () =>
    services.settings.chooseGitExecutable()
  );

  register(IPC_CHANNELS.SETTINGS_CLEAR_GIT_EXECUTABLE, 'settings.clearGitExecutable', async () =>
    services.settings.clearGitExecutable()
  );

  register(IPC_CHANNELS.SETTINGS_CHOOSE_CUSTOM_EDITOR, 'settings.chooseCustomEditor', async () => {
    return services.settings.chooseCustomEditor();
  });

  register(IPC_CHANNELS.SETTINGS_SET_EDITOR_PRESET, 'settings.setEditorPreset', async (args) => {
    const input = setEditorPresetSchema.parse(args);
    return services.settings.setEditorPreset(input);
  });

  register(
    IPC_CHANNELS.SETTINGS_CHOOSE_CUSTOM_TERMINAL,
    'settings.chooseCustomTerminal',
    async () => {
      return services.settings.chooseCustomTerminal();
    }
  );

  register(
    IPC_CHANNELS.SETTINGS_SET_TERMINAL_PRESET,
    'settings.setTerminalPreset',
    async (args) => {
      const input = setTerminalPresetSchema.parse(args);
      return services.settings.setTerminalPreset(input);
    }
  );

  register(IPC_CHANNELS.TOOLCHAINS_GET, 'toolchains.get', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.toolchains.getProjectToolchains(input);
  });

  register(IPC_CHANNELS.TOOLCHAINS_SET_ACTIVE, 'toolchains.setActive', async (args: unknown) => {
    const input = setActiveVersionRequestSchema.parse(args);
    return services.toolchains.setActiveVersion(input);
  });

  register(IPC_CHANNELS.PORTS_LIST, 'ports.list', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.ports.list(input);
  });

  register(IPC_CHANNELS.PORTS_KILL, 'ports.kill', async (args: unknown) => {
    const input = killPortRequestSchema.parse(args);
    return services.ports.kill(input);
  });

  register(IPC_CHANNELS.TASKS_LIST, 'tasks.list', async (args: unknown) => {
    const input = projectIdRequestSchema.parse(args);
    return services.tasks.list(input);
  });

  register(IPC_CHANNELS.TASKS_RUN, 'tasks.run', async (args: unknown) => {
    const input = runTaskRequestSchema.parse(args);
    return services.tasks.run(input);
  });

  return () => {
    for (const { remove } of handlers) {
      remove();
    }
  };
}
