import type { PaneWidthSettings } from '@shared/contracts/settings';
import { DEFAULT_LAYOUT_SETTINGS } from '@shared/contracts/settings';

export type PaneWidths = PaneWidthSettings;

export const MIN_FILES = 320;
export const MIN_COMMIT = 200;
export const MIN_DIFF = 280;
export const DEFAULT_PANE_WIDTHS = DEFAULT_LAYOUT_SETTINGS.paneWidths;

/** One-time migration from legacy localStorage layout keys into settings. */
export function readLegacyLayoutMigration(): {
  paneWidths?: PaneWidths;
} | null {
  try {
    const panesRaw = localStorage.getItem('bureau.ui.paneWidths');
    if (!panesRaw) return null;

    const parsed = JSON.parse(panesRaw) as PaneWidths;
    const result: { paneWidths?: PaneWidths } = {
      paneWidths: {
        files: Math.max(MIN_FILES, parsed.files ?? DEFAULT_PANE_WIDTHS.files),
        commit: Math.max(MIN_COMMIT, parsed.commit ?? DEFAULT_PANE_WIDTHS.commit),
      },
    };
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
