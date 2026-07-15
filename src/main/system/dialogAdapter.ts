import { BrowserWindow, dialog } from 'electron';

export type DirectoryDialogOptions = {
  title?: string;
  buttonLabel?: string;
};

export type NativeDialogAdapter = {
  showOpenDirectoryDialog(options?: DirectoryDialogOptions): Promise<string | undefined>;
  showOpenFileDialog(options?: {
    title?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | undefined>;
  showSaveFileDialog(options?: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | undefined>;
};

export function createElectronDialogAdapter(): NativeDialogAdapter {
  return {
    async showOpenDirectoryDialog(options?: DirectoryDialogOptions): Promise<string | undefined> {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = parent
        ? await dialog.showOpenDialog(parent, {
            properties: ['openDirectory'],
            title: options?.title,
            buttonLabel: options?.buttonLabel,
          })
        : await dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: options?.title,
            buttonLabel: options?.buttonLabel,
          });

      return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths[0];
    },
    async showOpenFileDialog(options) {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const config = {
        properties: ['openFile'] as ['openFile'],
        title: options?.title,
        filters: options?.filters,
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, config)
        : await dialog.showOpenDialog(config);
      return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths[0];
    },
    async showSaveFileDialog(options) {
      const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const config = {
        title: options?.title,
        defaultPath: options?.defaultPath,
        filters: options?.filters,
      };
      const result = parent
        ? await dialog.showSaveDialog(parent, config)
        : await dialog.showSaveDialog(config);
      return result.canceled ? undefined : result.filePath;
    },
  };
}
