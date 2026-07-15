import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}));

import { attachWindowStatePersistence } from '../../../src/main/app/windowState';
import type { SettingsStore } from '../../../src/main/settings/SettingsStore';
import type { BrowserWindow } from 'electron';

function makeFakeWindow() {
  const window = new EventEmitter() as EventEmitter & {
    destroy: ReturnType<typeof vi.fn>;
    isMaximized: () => boolean;
    getBounds: () => { x: number; y: number; width: number; height: number };
    getNormalBounds: () => { x: number; y: number; width: number; height: number };
  };
  window.destroy = vi.fn();
  window.isMaximized = () => false;
  window.getBounds = () => ({ x: 10, y: 10, width: 1200, height: 800 });
  window.getNormalBounds = window.getBounds;
  return window;
}

function makeFakeStore() {
  return { setWindowBounds: vi.fn().mockResolvedValue(undefined) } as unknown as SettingsStore;
}

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('attachWindowStatePersistence close handling', () => {
  it('persists bounds and destroys the window on a normal close', async () => {
    const window = makeFakeWindow();
    const store = makeFakeStore();
    attachWindowStatePersistence(window as unknown as BrowserWindow, store);

    const event = { preventDefault: vi.fn() };
    window.emit('close', event);
    await flushAsync();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(store.setWindowBounds).toHaveBeenCalled();
    expect(window.destroy).toHaveBeenCalled();
  });

  it('does NOT destroy the window while the quit guard is blocking the close', async () => {
    const window = makeFakeWindow();
    const store = makeFakeStore();
    attachWindowStatePersistence(window as unknown as BrowserWindow, store, () => false);

    const event = { preventDefault: vi.fn() };
    window.emit('close', event);
    await flushAsync();

    // Regression: destroy() here would bypass the quit-confirm dialog entirely.
    expect(window.destroy).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(store.setWindowBounds).not.toHaveBeenCalled();
  });

  it('destroys normally once the guard allows the close (after confirm)', async () => {
    const window = makeFakeWindow();
    const store = makeFakeStore();
    let allowed = false;
    attachWindowStatePersistence(window as unknown as BrowserWindow, store, () => allowed);

    window.emit('close', { preventDefault: vi.fn() });
    await flushAsync();
    expect(window.destroy).not.toHaveBeenCalled();

    allowed = true; // quit confirmed → guard opens
    const event = { preventDefault: vi.fn() };
    window.emit('close', event);
    await flushAsync();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(window.destroy).toHaveBeenCalled();
  });
});
