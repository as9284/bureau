import { describe, expect, it } from 'vitest';
import {
  clampListPaneWidth,
  clampPaneWidths,
  MIN_COMMIT,
  MIN_DIFF,
  MIN_FILES,
} from '@renderer/lib/layoutPrefs';

/** What the three-pane row actually occupies: both panes, the diff, and a px per separator. */
function rowWidth(widths: { files: number; commit: number }): number {
  return widths.files + widths.commit + MIN_DIFF + 2;
}

/** The narrowest container the row can fit in at all; below this the panes stack instead. */
const FLOOR = MIN_FILES + MIN_COMMIT + MIN_DIFF + 2;

describe('clampPaneWidths', () => {
  it('keeps the preferred widths when the container has room', () => {
    expect(clampPaneWidths({ files: 340, commit: 280 }, 1400)).toEqual({ files: 340, commit: 280 });
  });

  it('shrinks panes to fit a container narrower than the preferred widths', () => {
    // The regression: widths were only re-clamped on drag, so a container that
    // narrowed underneath them kept the old pixel widths and overflowed.
    const widths = clampPaneWidths({ files: 520, commit: 420 }, 900);
    expect(rowWidth(widths)).toBeLessThanOrEqual(900);
  });

  it('fits at every container width a resize sweeps through', () => {
    // Both panes oversized at once is the case that used to overflow: each ceiling was
    // budgeted against the other pane's *minimum*, so both could take their maximum.
    for (let containerWidth = FLOOR; containerWidth <= 1600; containerWidth += 1) {
      const widths = clampPaneWidths({ files: 520, commit: 420 }, containerWidth);
      expect(rowWidth(widths)).toBeLessThanOrEqual(containerWidth);
    }
  });

  it('restores the preferred widths when the container widens again', () => {
    // Why the component keeps `preferredWidths` separate from the rendered widths:
    // clamping is a pure projection, so narrowing then widening is a round trip
    // rather than a one-way ratchet down.
    const preferred = { files: 520, commit: 420 };
    clampPaneWidths(preferred, 700);
    expect(clampPaneWidths(preferred, 1600)).toEqual(preferred);
  });

  it('floors at the pane minimums rather than collapsing them', () => {
    expect(clampPaneWidths({ files: 340, commit: 280 }, 200)).toEqual({
      files: MIN_FILES,
      commit: MIN_COMMIT,
    });
  });
});

describe('clampListPaneWidth', () => {
  it('honours the mode minimum when the container has room', () => {
    expect(clampListPaneWidth(360, 1400)).toBe(360);
  });

  it('caps the list pane so the diff beside it still fits', () => {
    // The regression: stash/history applied Math.max(files, 360) *after* clamping,
    // which could push the pane back past what the container could hold.
    const width = clampListPaneWidth(360, 700);
    expect(width + MIN_DIFF).toBeLessThanOrEqual(700);
  });

  it('never returns less than the files minimum', () => {
    expect(clampListPaneWidth(360, 100)).toBe(MIN_FILES);
  });
});
