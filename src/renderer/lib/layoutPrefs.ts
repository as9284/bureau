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

/**
 * Width for the list pane of a two-pane mode (stash, history), which reserves room for the
 * diff but not for a commit pane. `preferred` is the mode's own minimum comfortable width,
 * so this both raises the shared files width up to it and caps it to what the container has.
 */
export function clampListPaneWidth(preferred: number, containerWidth: number): number {
  const maximum = Math.max(MIN_FILES, containerWidth - MIN_DIFF - 1);
  return Math.round(Math.min(preferred, maximum));
}

/**
 * Fits the files and commit panes into `containerWidth`, reserving MIN_DIFF for the diff
 * between them and a pixel for each separator.
 *
 * The two panes are clamped in sequence, not independently: each ceiling has to account for
 * how wide the other pane *actually* ended up. Budgeting both against the other's minimum
 * lets both take their maximum at once and overflow the row by the difference.
 *
 * Below MIN_FILES + MIN_COMMIT + MIN_DIFF the row cannot fit at any widths; the panes stop
 * at their minimums and the stacked layout (see the container query in GitWorkbench.css)
 * takes over before that point.
 */
export function clampPaneWidths(widths: PaneWidths, containerWidth: number): PaneWidths {
  const budget = containerWidth - MIN_DIFF - 2;
  const files = Math.round(
    Math.min(Math.max(widths.files, MIN_FILES), Math.max(MIN_FILES, budget - MIN_COMMIT))
  );
  const commit = Math.round(
    Math.min(Math.max(widths.commit, MIN_COMMIT), Math.max(MIN_COMMIT, budget - files))
  );
  return { files, commit };
}
