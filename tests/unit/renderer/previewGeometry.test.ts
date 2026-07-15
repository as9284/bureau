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

// Framed device sizing intentionally remains renderer-only.
describe('computeBounds', () => {
  const rect = { left: 100, top: 40, width: 1000, height: 800 };

  it('fills the container for the fill preset', () => {
    expect(computeBounds(rect, 'fill', false)).toEqual({ x: 100, y: 40, width: 1000, height: 800 });
  });

  it('centers a device viewport within the container', () => {
    const bounds = computeBounds(rect, 'mobile', false);
    expect(bounds.width).toBe(390);
    expect(bounds.height).toBe(800); // clamped to container height (844 > 800)
    expect(bounds.x).toBe(Math.round(100 + (1000 - 390) / 2));
  });

  it('swaps dimensions when rotated', () => {
    const bounds = computeBounds(rect, 'mobile', true);
    expect(bounds.width).toBe(844); // landscape long edge fits the 1000-wide container
    expect(bounds.height).toBe(390);
  });

  it('keeps device framing in the renderer-only fallback', () => {
    const bounds = computeBounds({ left: 0, top: 0, width: 1440, height: 1000 }, 'tablet', false);
    expect(bounds).toEqual({ x: 310, y: 0, width: 820, height: 1000 });
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
