import { describe, expect, it } from 'vitest';
import { mapPointerToDevice, shouldForwardKey } from '@renderer/lib/emulatorCoords';

// Device: 1080x2400 portrait. Canvas shows the rotated frame at half scale.
const device = { deviceWidth: 1080, deviceHeight: 2400 };

describe('mapPointerToDevice', () => {
  it('scales portrait coordinates directly', () => {
    expect(
      mapPointerToDevice({
        canvasX: 270,
        canvasY: 600,
        canvasWidth: 540,
        canvasHeight: 1200,
        rotation: 0,
        ...device,
      })
    ).toEqual({ x: 540, y: 1200 });
  });

  it('rotates landscape (90°) coordinates back into the portrait frame', () => {
    // Landscape canvas is 1200x540 (device rotated one quadrant). A point at the
    // very top edge of the canvas maps to the right edge of the portrait panel.
    const mapped = mapPointerToDevice({
      canvasX: 0,
      canvasY: 0,
      canvasWidth: 1200,
      canvasHeight: 540,
      rotation: 1,
      ...device,
    });
    expect(mapped).toEqual({ x: 1079, y: 0 });
    const centre = mapPointerToDevice({
      canvasX: 600,
      canvasY: 270,
      canvasWidth: 1200,
      canvasHeight: 540,
      rotation: 1,
      ...device,
    });
    expect(centre).toEqual({ x: 540, y: 1200 });
  });

  it('inverts both axes for reverse portrait (180°)', () => {
    expect(
      mapPointerToDevice({
        canvasX: 0,
        canvasY: 0,
        canvasWidth: 540,
        canvasHeight: 1200,
        rotation: 2,
        ...device,
      })
    ).toEqual({ x: 1079, y: 2399 });
  });

  it('maps reverse landscape (270°) coordinates', () => {
    expect(
      mapPointerToDevice({
        canvasX: 0,
        canvasY: 0,
        canvasWidth: 1200,
        canvasHeight: 540,
        rotation: 3,
        ...device,
      })
    ).toEqual({ x: 0, y: 2399 });
  });

  it('clamps to the device bounds and rejects degenerate input', () => {
    expect(
      mapPointerToDevice({
        canvasX: 999,
        canvasY: 2000,
        canvasWidth: 540,
        canvasHeight: 1200,
        rotation: 0,
        ...device,
      })
    ).toEqual({ x: 1079, y: 2399 });
    expect(
      mapPointerToDevice({
        canvasX: 1,
        canvasY: 1,
        canvasWidth: 0,
        canvasHeight: 100,
        rotation: 0,
        ...device,
      })
    ).toBeNull();
  });
});

describe('shouldForwardKey', () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false };
  it('forwards plain typing keys', () => {
    expect(shouldForwardKey({ key: 'a', ...base })).toBe(true);
    expect(shouldForwardKey({ key: 'Enter', ...base })).toBe(true);
    expect(shouldForwardKey({ key: 'Backspace', ...base })).toBe(true);
  });
  it('never captures Tab so keyboard focus can leave the canvas', () => {
    expect(shouldForwardKey({ key: 'Tab', ...base })).toBe(false);
  });
  it('leaves app-level chords alone', () => {
    expect(shouldForwardKey({ key: 'c', ...base, ctrlKey: true })).toBe(false);
    expect(shouldForwardKey({ key: 'F4', ...base, altKey: true })).toBe(false);
  });
});
