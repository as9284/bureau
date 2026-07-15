import { dialog } from 'electron';
import type { ExecutablePickerAdapter } from '../settings/SettingsApplicationService';

export function createElectronExecutablePickerAdapter(): ExecutablePickerAdapter {
  return {
    async showOpenExecutableDialog(options): Promise<string | undefined> {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        title: options?.title ?? 'Choose executable',
        filters: options?.filters,
      });
      return result.canceled || result.filePaths.length === 0 ? undefined : result.filePaths[0];
    },
  };
}
