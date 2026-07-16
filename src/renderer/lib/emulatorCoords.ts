import type { EmulatorDisplayRotation } from '@shared/contracts/android';

// The emulator expects mouse/touch coordinates in the *unrotated* (native
// portrait) device frame. The displayed frame is rotated by `rotation`
// quadrants, so pointer positions must be rotated back before scaling — the
// same transform Android Studio's embedded emulator view applies.

export type PointerMapInput = {
  /** Pointer position within the canvas, in CSS pixels. */
  canvasX: number;
  canvasY: number;
  /** Rendered canvas size in CSS pixels. */
  canvasWidth: number;
  canvasHeight: number;
  /** Rotation of the displayed frame, in 90° quadrants. */
  rotation: EmulatorDisplayRotation;
  /** Native (unrotated) device screen size in device pixels. */
  deviceWidth: number;
  deviceHeight: number;
};

export function mapPointerToDevice(input: PointerMapInput): { x: number; y: number } | null {
  const { canvasWidth, canvasHeight, deviceWidth, deviceHeight } = input;
  if (canvasWidth <= 0 || canvasHeight <= 0 || deviceWidth <= 0 || deviceHeight <= 0) return null;
  const u = input.canvasX / canvasWidth;
  const v = input.canvasY / canvasHeight;
  let nx: number;
  let ny: number;
  switch (input.rotation) {
    case 1:
      nx = 1 - v;
      ny = u;
      break;
    case 2:
      nx = 1 - u;
      ny = 1 - v;
      break;
    case 3:
      nx = v;
      ny = 1 - u;
      break;
    default:
      nx = u;
      ny = v;
      break;
  }
  return {
    x: clamp(Math.round(nx * deviceWidth), 0, deviceWidth - 1),
    y: clamp(Math.round(ny * deviceHeight), 0, deviceHeight - 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keys the embedded display must not swallow so keyboard users can escape it. */
export function shouldForwardKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.key === 'Tab') return false;
  // Reserve app/browser chords (copy, paste, devtools, …); plain typing and
  // Shift-modified characters are forwarded.
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return true;
}
