/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import { app, BrowserWindow, Menu, nativeTheme } from 'electron';
import path from 'node:path';
import type { SettingsStore } from '../settings/SettingsStore';
import { configureSecurityPolicy } from './securityPolicy';
import {
  attachWindowStatePersistence,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  resolveWindowState,
} from './windowState';

const PRELOAD_PATH = path.join(__dirname, 'index.js');

const WINDOW_BACKGROUND = {
  dark: '#181818',
  light: '#f4f4f5',
} as const;

function resolveWindowBackground(settingsStore?: SettingsStore): string {
  if (!settingsStore) return WINDOW_BACKGROUND.dark;
  const theme = settingsStore.get().appearance.theme;
  if (theme === 'light') return WINDOW_BACKGROUND.light;
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light;
  }
  return WINDOW_BACKGROUND.dark;
}

function resolveAppIcon(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'icon.ico');
  }
  return path.join(app.getAppPath(), 'assets', 'icon.ico');
}

export type MainWindowOptions = {
  /** Gate consulted by the window-state close handler; false = a quit guard owns this close. */
  canClose?: () => boolean;
};

export function createMainWindow(
  settingsStore?: SettingsStore,
  options?: MainWindowOptions
): BrowserWindow {
  Menu.setApplicationMenu(null);

  const savedState = settingsStore ? resolveWindowState(settingsStore.get().window) : undefined;

  const mainWindow = new BrowserWindow({
    width: savedState?.width ?? DEFAULT_WINDOW_WIDTH,
    height: savedState?.height ?? DEFAULT_WINDOW_HEIGHT,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: 'Bureau',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    backgroundColor: resolveWindowBackground(settingsStore),
    icon: resolveAppIcon(),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.setMenuBarVisibility(false);

  const devServerUrl =
    process.env.NODE_ENV === 'development' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : undefined;
  configureSecurityPolicy(mainWindow, devServerUrl ?? undefined);

  if (process.env.NODE_ENV === 'development' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(
      new URL('/src/renderer/index.html', MAIN_WINDOW_VITE_DEV_SERVER_URL).toString()
    );
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/src/renderer/index.html`)
    );
  }

  if (savedState?.maximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (settingsStore) {
    attachWindowStatePersistence(mainWindow, settingsStore, options?.canClose);
  }

  return mainWindow;
}
