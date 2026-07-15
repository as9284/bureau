import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { applyAccentColor } from '../lib/appearance';

type Hsv = { h: number; s: number; v: number };

type AccentColorPickerProps = {
  value: string;
  isActive: boolean;
  onChange: (hex: string) => void;
};

/** A self-contained accent color picker: a trigger swatch + popover (SV square, hue slider, hex). */
export function AccentColorPicker({ value, isActive, onChange }: AccentColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexText, setHexText] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<null | 'sv' | 'hue'>(null);
  const latestRef = useRef<Hsv>(hsv);

  // Re-sync from external changes (preset clicks) unless the user is mid-drag.
  useEffect(() => {
    if (draggingRef.current) return;
    const next = hexToHsv(value);
    latestRef.current = next;
    setHsv(next);
    setHexText(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const preview = (next: Hsv) => {
    latestRef.current = next;
    setHsv(next);
    const hex = hsvToHex(next);
    setHexText(hex);
    applyAccentColor(hex); // live, no persistence round-trip
  };

  const commit = () => onChange(hsvToHex(latestRef.current));

  const svFromEvent = (e: ReactPointerEvent): Hsv => {
    const rect = svRef.current!.getBoundingClientRect();
    const s = clamp01((e.clientX - rect.left) / rect.width);
    const v = clamp01(1 - (e.clientY - rect.top) / rect.height);
    return { ...latestRef.current, s, v };
  };

  const hueFromEvent = (e: ReactPointerEvent): Hsv => {
    const rect = hueRef.current!.getBoundingClientRect();
    const h = clamp01((e.clientX - rect.left) / rect.width) * 360;
    return { ...latestRef.current, h };
  };

  const onSvDown = (e: ReactPointerEvent) => {
    svRef.current?.setPointerCapture(e.pointerId);
    draggingRef.current = 'sv';
    preview(svFromEvent(e));
  };
  const onSvMove = (e: ReactPointerEvent) => {
    if (draggingRef.current === 'sv') preview(svFromEvent(e));
  };
  const onHueDown = (e: ReactPointerEvent) => {
    hueRef.current?.setPointerCapture(e.pointerId);
    draggingRef.current = 'hue';
    preview(hueFromEvent(e));
  };
  const onHueMove = (e: ReactPointerEvent) => {
    if (draggingRef.current === 'hue') preview(hueFromEvent(e));
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    commit();
  };

  const onHexInput = (raw: string) => {
    setHexText(raw);
    const norm = normalizeHex(raw);
    if (norm) {
      const next = hexToHsv(norm);
      latestRef.current = next;
      setHsv(next);
      applyAccentColor(norm);
    }
  };
  const onHexCommit = () => {
    const norm = normalizeHex(hexText);
    if (norm) onChange(norm);
    else setHexText(value);
  };

  const hueColor = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const swatchBackground = isActive ? value : CONIC_GRADIENT;

  return (
    <div className="accent-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className={['accent-custom', isActive ? 'active' : ''].join(' ')}
        style={{ background: swatchBackground }}
        aria-label="Custom accent color"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="color-picker" role="dialog" aria-label="Custom accent color">
          <div
            ref={svRef}
            className="cp-sv"
            style={{
              background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), ${hueColor}`,
            }}
            onPointerDown={onSvDown}
            onPointerMove={onSvMove}
            onPointerUp={endDrag}
          >
            <span
              className="cp-sv-thumb"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>

          <div
            ref={hueRef}
            className="cp-hue"
            onPointerDown={onHueDown}
            onPointerMove={onHueMove}
            onPointerUp={endDrag}
          >
            <span className="cp-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>

          <div className="cp-hex-row">
            <span className="cp-preview" style={{ background: hsvToHex(hsv) }} />
            <input
              className="cp-hex"
              value={hexText}
              spellCheck={false}
              aria-label="Hex color"
              onChange={(e) => onHexInput(e.target.value)}
              onBlur={onHexCommit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onHexCommit();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const CONIC_GRADIENT =
  'conic-gradient(#d96b6b, #d9bc6b, #6bbf80, #6ba3d9, #9a6bd9, #d96b9a, #d96b6b)';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeHex(input: string): string | null {
  const trimmed = input.trim().replace(/^#?/, '#');
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function hexToRgb(hex: string): [number, number, number] {
  const int = parseInt(hex.replace('#', ''), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.round(clamp01(n / 255) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) [rp, gp, bp] = [c, x, 0];
  else if (h < 120) [rp, gp, bp] = [x, c, 0];
  else if (h < 180) [rp, gp, bp] = [0, c, x];
  else if (h < 240) [rp, gp, bp] = [0, x, c];
  else if (h < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return [(rp + m) * 255, (gp + m) * 255, (bp + m) * 255];
}

function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(normalizeHex(hex) ?? '#7c9cff');
  return rgbToHsv(r, g, b);
}

function hsvToHex(hsv: Hsv): string {
  const [r, g, b] = hsvToRgb(hsv);
  return rgbToHex(r, g, b);
}
