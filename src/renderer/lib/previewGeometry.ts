import type { PreviewBounds } from '@shared/contracts/preview';
import type { ViewportPreset } from '../store/appStore';

export const VIEWPORTS: Record<ViewportPreset, { w: number; h: number } | null> = {
  fill: null,
  mobile: { w: 390, h: 844 },
  tablet: { w: 820, h: 1180 },
  desktop: { w: 1280, h: 800 },
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);

/** Normalizes user input to a loopback http(s) URL, or null if it isn't one. */
export function normalizeLoopback(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    return LOOPBACK_HOSTS.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

type Rect = { left: number; top: number; width: number; height: number };

/**
 * Maps a container rect + viewport preset to native-view bounds (device centered on a matte).
 * All fields are rounded to integers — the setBounds IPC schema rejects floats, and
 * getBoundingClientRect() plus the centering division both produce fractional pixels.
 */
export function computeBounds(
  rect: Rect,
  viewport: ViewportPreset,
  rotated: boolean
): PreviewBounds {
  const preset = VIEWPORTS[viewport];
  if (!preset) {
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }
  let vw = preset.w;
  let vh = preset.h;
  if (rotated) [vw, vh] = [vh, vw];
  const width = Math.min(vw, rect.width);
  const height = Math.min(vh, rect.height);
  return {
    x: Math.round(rect.left + (rect.width - width) / 2),
    y: Math.round(rect.top + (rect.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}
