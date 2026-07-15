import { app, BrowserWindow } from 'electron';
import type { SettingsStore } from '../settings/SettingsStore';
import { createMainWindow } from './createMainWindow';

export function enforceSingleInstance(): void {
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  });
}

export function setupLifecycle(settingsStore?: SettingsStore): void {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(settingsStore);
    }
  });
}
