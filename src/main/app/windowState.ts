import { BrowserWindow, screen } from 'electron';
import type { SettingsStore } from '../settings/SettingsStore';
import type { PublicSettings } from '@shared/contracts/settings';

export const DEFAULT_WINDOW_WIDTH = 1180;
export const DEFAULT_WINDOW_HEIGHT = 780;

export const MIN_WINDOW_WIDTH = DEFAULT_WINDOW_WIDTH;
export const MIN_WINDOW_HEIGHT = DEFAULT_WINDOW_HEIGHT;

type SavedWindowState = NonNullable<PublicSettings['window']>;

export type ResolvedWindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
};

function clampDimension(value: number | undefined, fallback: number, minimum: number): number {
  const resolved = value ?? fallback;
  return Math.max(minimum, resolved);
}

function isPositionOnScreen(x: number, y: number, width: number, height: number): boolean {
  const rect = { x, y, width, height };
  const workArea = screen.getDisplayMatching(rect).workArea;

  return (
    rect.x + rect.width > workArea.x &&
    rect.x < workArea.x + workArea.width &&
    rect.y + rect.height > workArea.y &&
    rect.y < workArea.y + workArea.height
  );
}

export function resolveWindowState(saved?: SavedWindowState): ResolvedWindowState {
  const width = clampDimension(saved?.width, DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH);
  const height = clampDimension(saved?.height, DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT);

  const maximized = saved?.maximized ?? false;
  const state: ResolvedWindowState = { width, height, maximized };

  if (saved?.x !== undefined && saved?.y !== undefined) {
    if (isPositionOnScreen(saved.x, saved.y, width, height)) {
      state.x = saved.x;
      state.y = saved.y;
    }
  }

  return state;
}

async function persistWindowState(
  window: BrowserWindow,
  settingsStore: SettingsStore
): Promise<void> {
  const maximized = window.isMaximized();
  const bounds = maximized ? window.getNormalBounds() : window.getBounds();

  await settingsStore.setWindowBounds({
    width: Math.max(MIN_WINDOW_WIDTH, bounds.width),
    height: Math.max(MIN_WINDOW_HEIGHT, bounds.height),
    x: bounds.x,
    y: bounds.y,
    maximized,
  });
}

export function attachWindowStatePersistence(
  window: BrowserWindow,
  settingsStore: SettingsStore,
  /**
   * When provided and returning false, this close is owned by another handler
   * (e.g. the quit guard prompting about running processes) — do NOT persist
   * bounds and, critically, do NOT destroy the window.
   */
  canClose?: () => boolean
): void {
  let saveTimer: NodeJS.Timeout | undefined;
  let closing = false;

  const scheduleSave = (): void => {
    if (closing) {
      return;
    }
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      void persistWindowState(window, settingsStore);
    }, 400);
  };

  window.on('resize', scheduleSave);
  window.on('move', scheduleSave);
  window.on('maximize', () => {
    void persistWindowState(window, settingsStore);
  });
  window.on('unmaximize', () => {
    void persistWindowState(window, settingsStore);
  });

  window.on('close', (event) => {
    if (closing) {
      return;
    }
    if (canClose && !canClose()) {
      // The quit guard is blocking this close (it prompts the user instead).
      // Destroying the window here would bypass that prompt entirely.
      return;
    }
    event.preventDefault();
    closing = true;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    void persistWindowState(window, settingsStore).finally(() => {
      window.destroy();
    });
  });
}
