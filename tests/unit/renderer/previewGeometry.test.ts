import { describe, it, expect } from 'vitest';
import { computeBounds, normalizeLoopback } from '@renderer/lib/previewGeometry';

describe('normalizeLoopback', () => {
  it('accepts loopback URLs and adds a scheme', () => {
    expect(normalizeLoopback('localhost:3000')).toBe('http://localhost:3000/');
    expect(normalizeLoopback('http://127.0.0.1:8080/app')).toBe('http://127.0.0.1:8080/app');
  });

  it('rejects non-loopback and invalid URLs', () => {
    expect(normalizeLoopback('https://example.com')).toBeNull();
    expect(normalizeLoopback('')).toBeNull();
    expect(normalizeLoopback('not a url')).toBeNull();
  });
});

describe('computeBounds', () => {
  const rect = { left: 100, top: 40, width: 1000, height: 800 };

  it('fills the container for the fill preset', () => {
    expect(computeBounds(rect, 'fill', false)).toEqual({ x: 100, y: 40, width: 1000, height: 800 });
  });

  it('centers a device viewport within the container', () => {
    const bounds = computeBounds(rect, 'mobile', false);
    expect(bounds.width).toBe(375);
    expect(bounds.height).toBe(800); // clamped to container height (812 > 800)
    expect(bounds.x).toBe(Math.round(100 + (1000 - 375) / 2)); // 412.5 → 413
  });

  it('swaps dimensions when rotated', () => {
    const bounds = computeBounds(rect, 'mobile', true);
    expect(bounds.width).toBe(812);
    expect(bounds.height).toBe(375);
  });

  it('always returns integer bounds (setBounds IPC rejects floats)', () => {
    // A fractional container rect (real getBoundingClientRect output) must still
    // yield integers on every field, for both fill and device presets.
    const fractional = { left: 100.4, top: 40.6, width: 1000.3, height: 799.7 };
    for (const preset of ['fill', 'mobile', 'tablet', 'desktop'] as const) {
      const b = computeBounds(fractional, preset, false);
      expect(Number.isInteger(b.x)).toBe(true);
      expect(Number.isInteger(b.y)).toBe(true);
      expect(Number.isInteger(b.width)).toBe(true);
      expect(Number.isInteger(b.height)).toBe(true);
    }
  });
});
