import type { PaneWidthSettings } from '@shared/contracts/settings';
import { DEFAULT_LAYOUT_SETTINGS } from '@shared/contracts/settings';

export type PaneWidths = PaneWidthSettings;

export const MIN_FILES = 320;
export const MIN_COMMIT = 200;
export const MIN_DIFF = 280;
export const DEFAULT_PANE_WIDTHS = DEFAULT_LAYOUT_SETTINGS.paneWidths;
export const DEFAULT_SIDEBAR_WIDTH = DEFAULT_LAYOUT_SETTINGS.sidebarWidth;

/** One-time migration from legacy localStorage layout keys into settings. */
export function readLegacyLayoutMigration(): {
  sidebarWidth?: number;
  paneWidths?: PaneWidths;
} | null {
  try {
    const sidebarRaw = localStorage.getItem('bureau.ui.sidebarWidth');
    const panesRaw = localStorage.getItem('bureau.ui.paneWidths');
    if (!sidebarRaw && !panesRaw) return null;

    const result: { sidebarWidth?: number; paneWidths?: PaneWidths } = {};
    if (sidebarRaw) {
      const n = Number(sidebarRaw);
      if (Number.isFinite(n)) {
        result.sidebarWidth = Math.max(160, Math.min(360, Math.round(n)));
      }
    }
    if (panesRaw) {
      const parsed = JSON.parse(panesRaw) as PaneWidths;
      result.paneWidths = {
        files: Math.max(MIN_FILES, parsed.files ?? DEFAULT_PANE_WIDTHS.files),
        commit: Math.max(MIN_COMMIT, parsed.commit ?? DEFAULT_PANE_WIDTHS.commit),
      };
    }
    return result;
  } catch {
    return null;
  }
}

export function clearLegacyLayoutKeys(): void {
  localStorage.removeItem('bureau.ui.sidebarWidth');
  localStorage.removeItem('bureau.ui.paneWidths');
}

export function clampPaneWidths(widths: PaneWidths, containerWidth: number): PaneWidths {
  const maxFiles = Math.max(MIN_FILES, containerWidth - MIN_DIFF - MIN_COMMIT - 2);
  const maxCommit = Math.max(MIN_COMMIT, containerWidth - MIN_DIFF - MIN_FILES - 2);
  return {
    files: Math.round(Math.min(Math.max(widths.files, MIN_FILES), maxFiles)),
    commit: Math.round(Math.min(Math.max(widths.commit, MIN_COMMIT), maxCommit)),
  };
}

