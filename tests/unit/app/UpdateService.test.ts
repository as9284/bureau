import { describe, expect, it, vi } from 'vitest';
import { createUpdateService, type UpdateServiceDependencies } from '@main/app/UpdateService';

type UpdaterListener = (...args: unknown[]) => void;

function createUpdater() {
  const listeners = new Map<string, UpdaterListener>();
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: UpdaterListener) => {
      listeners.set(event, listener);
      return updater;
    }),
  };

  return {
    updater: updater as unknown as UpdateServiceDependencies['updater'],
    emit(event: string, ...args: unknown[]) {
      listeners.get(event)?.(...args);
    },
    calls: updater,
  };
}

describe('UpdateService', () => {
  it('does not activate for development or locally packaged builds', () => {
    const fake = createUpdater();
    const service = createUpdateService({
      app: { isPackaged: false, getVersion: () => '1.0.0' },
      updater: fake.updater,
      platform: 'win32',
      hasConfiguration: () => false,
    });

    service.start();

    expect(service.getState()).toEqual({ kind: 'disabled', currentVersion: '1.0.0' });
    expect(fake.calls.checkForUpdates).not.toHaveBeenCalled();
  });

  it('downloads updates in the background and only installs an acquired update', () => {
    const fake = createUpdater();
    const service = createUpdateService({
      app: { isPackaged: true, getVersion: () => '1.0.0' },
      updater: fake.updater,
      platform: 'win32',
      hasConfiguration: () => true,
    });

    service.start();

    expect(fake.calls.autoDownload).toBe(true);
    expect(fake.calls.autoInstallOnAppQuit).toBe(false);
    expect(fake.calls.checkForUpdates).toHaveBeenCalledOnce();
    expect(service.getState()).toEqual({ kind: 'checking', currentVersion: '1.0.0' });

    fake.emit('update-available');
    expect(service.getState()).toEqual({ kind: 'available', currentVersion: '1.0.0' });

    expect(service.quitAndInstall()).toBe(false);
    fake.emit('update-downloaded', { version: '1.0.1' });

    expect(service.getState()).toEqual({
      kind: 'downloaded',
      currentVersion: '1.0.0',
      availableVersion: '1.0.1',
    });
    expect(service.quitAndInstall()).toBe(true);
    expect(fake.calls.quitAndInstall).toHaveBeenCalledWith(false, true);
  });
});
