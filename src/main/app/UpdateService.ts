import { app } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { autoUpdater, type AppUpdater } from 'electron-updater';
import type { AppUpdateState } from '@shared/contracts/updates';

type UpdateListener = (state: AppUpdateState) => void;

export type UpdateServiceDependencies = {
  app: Pick<typeof app, 'getVersion' | 'isPackaged'>;
  updater: Pick<
    AppUpdater,
    'autoDownload' | 'autoInstallOnAppQuit' | 'checkForUpdates' | 'quitAndInstall' | 'on'
  >;
  platform: NodeJS.Platform;
  hasConfiguration: () => boolean;
};

export type UpdateService = {
  start(): void;
  getState(): AppUpdateState;
  checkForUpdates(): AppUpdateState;
  canInstall(): boolean;
  quitAndInstall(): boolean;
  onState(listener: UpdateListener): () => void;
};

export function hasPackagedUpdateConfiguration(): boolean {
  return existsSync(path.join(process.resourcesPath, 'app-update.yml'));
}

export function createUpdateService(
  dependencies: UpdateServiceDependencies = {
    app,
    updater: autoUpdater,
    platform: process.platform,
    hasConfiguration: hasPackagedUpdateConfiguration,
  }
): UpdateService {
  const { updater } = dependencies;
  const listeners = new Set<UpdateListener>();
  const currentVersion = dependencies.app.getVersion();
  let started = false;
  let state: AppUpdateState = { kind: 'disabled', currentVersion };

  const publish = (next: AppUpdateState): void => {
    state = next;
    for (const listener of listeners) listener(state);
  };

  const setReady = (): void => publish({ kind: 'idle', currentVersion });

  const check = (): void => {
    publish({ kind: 'checking', currentVersion });
    void updater.checkForUpdates().catch(() => {
      publish({ kind: 'error', currentVersion });
    });
  };

  function start(): void {
    if (started) return;
    started = true;

    if (
      !dependencies.app.isPackaged ||
      !['win32', 'darwin'].includes(dependencies.platform) ||
      !dependencies.hasConfiguration()
    ) {
      publish({ kind: 'disabled', currentVersion });
      return;
    }

    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.on('checking-for-update', () => publish({ kind: 'checking', currentVersion }));
    updater.on('update-available', () => publish({ kind: 'available', currentVersion }));
    updater.on('update-not-available', setReady);
    updater.on('download-progress', (progress) => {
      const raw = typeof progress?.percent === 'number' ? progress.percent : 0;
      publish({ kind: 'downloading', currentVersion, percent: Math.max(0, Math.min(100, Math.round(raw))) });
    });
    updater.on('update-downloaded', (info) => {
      publish({ kind: 'downloaded', currentVersion, availableVersion: info.version });
    });
    updater.on('error', () => publish({ kind: 'error', currentVersion }));

    setReady();
    check();
  }

  return {
    start,
    getState: () => state,
    checkForUpdates: () => {
      if (
        !started ||
        state.kind === 'disabled' ||
        state.kind === 'downloading' ||
        state.kind === 'downloaded'
      )
        return state;
      check();
      return state;
    },
    canInstall: () => state.kind === 'downloaded',
    quitAndInstall: () => {
      if (state.kind !== 'downloaded') return false;
      updater.quitAndInstall(false, true);
      return true;
    },
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
