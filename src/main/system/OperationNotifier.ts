import { BrowserWindow, Notification } from 'electron';
import type { OperationRecord } from '@shared/contracts/operationLog';
import type { PublicSettings } from '@shared/contracts/settings';

const LONG_RUNNING_MS = 10_000;

export function createOperationNotifier(params: {
  getSettings: () => PublicSettings;
}): (record: OperationRecord) => void {
  return (record) => {
    if (record.state !== 'succeeded' && record.state !== 'failed' && record.state !== 'cancelled') {
      return;
    }

    const settings = params.getSettings();
    if (!settings.notifications.enabled) return;

    const startedAt = new Date(record.startedAt).getTime();
    const endedAt = new Date(record.endedAt ?? Date.now()).getTime();
    const durationMs = endedAt - startedAt;
    if (settings.notifications.longRunningOnly && durationMs < LONG_RUNNING_MS) return;

    const focused =
      BrowserWindow.getFocusedWindow()?.isFocused() ??
      BrowserWindow.getAllWindows().some((w) => w.isFocused());
    if (focused) return;

    if (!Notification.isSupported()) return;

    const title =
      record.state === 'succeeded'
        ? 'Operation completed'
        : record.state === 'cancelled'
          ? 'Operation cancelled'
          : 'Operation failed';

    new Notification({
      title,
      body: record.summary,
      silent: false,
    }).show();
  };
}
