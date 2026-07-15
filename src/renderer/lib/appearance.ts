import type { AppearanceSettings, ThemePreference } from '@shared/contracts/settings';

export function resolveTheme(preference: ThemePreference): 'dark' | 'light' {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return preference;
}

export function applyAppearance(appearance: AppearanceSettings): void {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(appearance.theme);
  root.dataset.density = appearance.density;
  applyAccentColor(appearance.accentColor);
}

/**
 * Sets the single accent source variable (+ readable on-accent text). Every other
 * accent token — hover/pressed/soft/focus/focus-ring/selected/status-info — derives
 * from `--color-accent-primary` via `color-mix` in tokens.css, so this alone recolors
 * the whole app. Exported so the color picker can preview live without a round-trip.
 */
export function applyAccentColor(hex: string): void {
  const root = document.documentElement;
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  root.style.setProperty('--color-accent-primary', hex);
  root.style.setProperty(
    '--color-text-on-accent',
    relativeLuminance(rgb) > 0.55 ? '#141414' : '#ffffff'
  );
}

export function watchSystemTheme(preference: ThemePreference, onChange: () => void): () => void {
  if (preference !== 'system') return () => undefined;
  const media = window.matchMedia('(prefers-color-scheme: light)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
