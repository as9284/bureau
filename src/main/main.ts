import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/contracts/channels';
import { createMainWindow } from './app/createMainWindow';
import { createUpdateService } from './app/UpdateService';
import { enforceSingleInstance, setupLifecycle } from './app/lifecycle';
import { registerHandlers } from './ipc/registerHandlers';
import { createAppServices } from './services/createAppServices';

enforceSingleInstance();

app
  .whenReady()
  .then(async () => {
    const { services, settingsStore, supervisor } = await createAppServices();
    const updates = createUpdateService();
    registerHandlers(services, { updates });

    // Shared with the window-state close handler: while the quit guard is blocking a
    // close (prompting / not yet confirmed), nothing may persist-and-destroy the window.
    let closeState: 'idle' | 'prompting' | 'quitting' = 'idle';
    let installDownloadedUpdate = false;
    const mainWindow = createMainWindow(settingsStore, {
      canClose: () =>
        closeState === 'quitting' ||
        (supervisor.runningCount() === 0 && services.files.dirtyFileCount() === 0),
    });

    updates.onState((state) => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.APP_UPDATES_STATE_EVENT, state);
      }
    });
    updates.start();

    // Bridge process supervisor events to the renderer.
    supervisor.onEvent((evt) => {
      if (mainWindow.isDestroyed()) return;
      if (evt.type === 'pty') {
        mainWindow.webContents.send(IPC_CHANNELS.PROCESSES_PTY_EVENT, evt.event);
        return;
      }
      const channel =
        evt.type === 'output'
          ? IPC_CHANNELS.PROCESSES_OUTPUT_EVENT
          : IPC_CHANNELS.PROCESSES_STATUS_EVENT;
      mainWindow.webContents.send(channel, evt.event);
    });

    // Bridge embedded shell-session output to the renderer.
    services.terminal.onEvent((evt) => {
      if (mainWindow.isDestroyed()) return;
      const channel =
        evt.type === 'data' ? IPC_CHANNELS.TERMINAL_DATA_EVENT : IPC_CHANNELS.TERMINAL_EXIT_EVENT;
      mainWindow.webContents.send(channel, evt.event);
    });

    // Attach the embedded web-preview view and bridge its state to the renderer.
    services.preview.attach(mainWindow);
    services.preview.onState((state) => {
      if (mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC_CHANNELS.PREVIEW_STATE_EVENT, state);
    });
    services.preview.onHotkey((hotkey) => {
      if (mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC_CHANNELS.PREVIEW_HOTKEY_EVENT, hotkey);
    });
    services.preview.onConsole((messages) => {
      if (mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC_CHANNELS.PREVIEW_CONSOLE_EVENT, messages);
    });
    services.android.onLogcat((event) => {
      if (!mainWindow.isDestroyed())
        mainWindow.webContents.send(IPC_CHANNELS.ANDROID_LOGCAT_EVENT, event);
    });
    services.android.onDisplay((event) => {
      if (!mainWindow.isDestroyed())
        mainWindow.webContents.send(IPC_CHANNELS.ANDROID_DISPLAY_EVENT, event);
    });
    services.files.onFileEvents((events) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(IPC_CHANNELS.FILES_EVENT, events);
    });
    services.files.onSearchEvents((batch) => {
      if (!mainWindow.isDestroyed())
        mainWindow.webContents.send(IPC_CHANNELS.FILES_SEARCH_EVENT, batch);
    });

    setupLifecycle(settingsStore);

    // ---- Close/quit lifecycle ----
    // When processes are alive, the first close is intercepted and the renderer is asked
    // to confirm. On confirm we gracefully stop everything (streaming progress to an
    // overlay) and then close; on cancel the window simply stays open.
    const SHUTDOWN_TIMEOUT_MS = 8000;

    const fromMainWindow = (event: Electron.IpcMainInvokeEvent): boolean =>
      event.sender === mainWindow.webContents;

    function gracefulShutdownThenClose(): void {
      // Reveal the renderer's shutdown UI (the preview view would cover it).
      services.preview.setVisible(false);
      const running = supervisor.listRunning();
      mainWindow.webContents.send(IPC_CHANNELS.APP_SHUTDOWN_BEGIN, { processes: running });

      const finish = (): void => {
        if (installDownloadedUpdate) {
          updates.quitAndInstall();
          return;
        }
        if (!mainWindow.isDestroyed()) mainWindow.close();
      };
      const guard = setTimeout(finish, SHUTDOWN_TIMEOUT_MS);

      void Promise.all(
        running.map(async ({ projectId, processId }) => {
          await supervisor.stop(projectId, processId).catch(() => undefined);
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send(IPC_CHANNELS.APP_SHUTDOWN_PROGRESS, {
              projectId,
              processId,
            });
          }
        })
      ).finally(() => {
        clearTimeout(guard);
        // Brief beat so the completed state is visible before the window vanishes.
        setTimeout(finish, 450);
      });
    }

    mainWindow.on('close', (event) => {
      if (closeState === 'quitting') return; // confirmed — allow the real close.
      if (supervisor.runningCount() === 0 && services.files.dirtyFileCount() === 0) return;
      event.preventDefault();
      if (closeState === 'prompting') return; // dialog already open.
      closeState = 'prompting';
      mainWindow.webContents.send(IPC_CHANNELS.APP_CLOSE_REQUESTED, {
        processes: supervisor.listRunning(),
        dirtyFiles: services.files.dirtyFileCount(),
      });
    });

    ipcMain.handle(IPC_CHANNELS.APP_CONFIRM_QUIT, (event) => {
      if (!fromMainWindow(event) || closeState === 'quitting') return;
      closeState = 'quitting';
      gracefulShutdownThenClose();
    });

    ipcMain.handle(IPC_CHANNELS.APP_CANCEL_QUIT, (event) => {
      if (!fromMainWindow(event)) return;
      closeState = 'idle';
      installDownloadedUpdate = false;
    });

    ipcMain.handle(IPC_CHANNELS.APP_UPDATES_INSTALL, (event) => {
      if (!fromMainWindow(event) || closeState !== 'idle' || !updates.canInstall()) return false;
      installDownloadedUpdate = true;
      if (supervisor.runningCount() === 0 && services.files.dirtyFileCount() === 0) {
        closeState = 'quitting';
        return updates.quitAndInstall();
      }
      mainWindow.close();
      return true;
    });

    // Best-effort backstop: stop anything still running as the app exits.
    app.on('before-quit', () => {
      void supervisor.stopAll();
      void services.terminal.dispose();
      void services.android.dispose();
      void services.files.dispose();
    });
  })
  .catch((error) => {
    console.error('Bureau failed to start:', error);
    process.exit(1);
  });
