import { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { DEFAULT_EMBEDDED_TERMINAL_SETTINGS } from '@shared/contracts/settings';
import { useAppStore } from '../store/appStore';

/**
 * Build an xterm theme from the graphite design tokens (tokens.css). xterm's `theme`
 * needs concrete color strings, not CSS `var()`, so we resolve the custom properties
 * off `documentElement` at mount — this keeps the terminal on-palette and following the
 * active light/dark theme instead of hard-coded off-token colors.
 */
function themeFromTokens(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;

  const background = token('--color-surface-sunken', '#141414');
  const foreground = token('--color-text-primary', '#ededed');
  const muted = token('--color-text-muted', '#858585');
  const secondary = token('--color-text-secondary', '#b4b4b4');
  const accent = token('--color-accent-primary', '#7c9cff');
  const success = token('--color-status-success', '#6db87a');
  const warning = token('--color-status-warning', '#c9a24d');
  const danger = token('--color-status-danger', '#d46a6a');
  const addText = token('--color-diff-add-text', '#8fd49a');
  const delText = token('--color-diff-del-text', '#e88a8a');
  const accentHover = token('--color-accent-hover', '#96afff');

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: token('--color-accent-soft', 'rgba(124,156,255,0.24)'),
    // 16 ANSI colors mapped to graphite-friendly status hues.
    black: token('--color-surface-overlay', '#282828'),
    red: danger,
    green: success,
    yellow: warning,
    blue: accent,
    magenta: accentHover,
    cyan: token('--color-status-info', accent),
    white: secondary,
    brightBlack: muted,
    brightRed: delText,
    brightGreen: addText,
    brightYellow: warning,
    brightBlue: accentHover,
    brightMagenta: accentHover,
    brightCyan: token('--color-status-info', accent),
    brightWhite: foreground,
  };
}

function terminalFontFamily(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--font-family-terminal').trim() ||
    "'JetBrainsMono NF', 'CaskaydiaCove NF', 'Cascadia Code NF', 'MesloLGS NF', 'FiraCode NF', 'Hack NF', 'Geist Mono', monospace"
  );
}

/**
 * How an XtermSurface talks to whatever is on the other end. Both callers own a pty in
 * main; they differ in which channel carries it (a stored process vs a shell session), so
 * that difference lives here rather than in two near-identical xterm setups.
 *
 * Must be referentially stable for the lifetime of the pane — a new object tears the
 * terminal down and rebuilds it, losing the on-screen scrollback.
 */
export type XtermTransport = {
  /** User keystrokes leaving the terminal. */
  onInput(data: string): void;
  /** Attach output. Call `write` with anything to render; return an unsubscribe. */
  subscribe(write: (data: string) => void): () => void;
  /** The grid was measured or re-measured. */
  onResize(cols: number, rows: number): void;
};

/**
 * The xterm view: theming, fitting, and live settings. Owns no transport of its own.
 */
export function XtermSurface({
  transport,
  active,
  autoFocus = false,
  className = 'terminal-pane',
}: {
  transport: XtermTransport;
  active: boolean;
  /** Focus the terminal when it becomes the active pane. */
  autoFocus?: boolean;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalSettings = useAppStore((s) => s.settings?.embeddedTerminal);
  // Read via a ref so changing these does not tear down and recreate the pane
  // (that would drop scrollback); a separate effect applies them live instead.
  const settingsRef = useRef(terminalSettings);
  settingsRef.current = terminalSettings;

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      convertEol: true,
      fontFamily: terminalFontFamily(),
      fontSize: settingsRef.current?.fontSize ?? DEFAULT_EMBEDDED_TERMINAL_SETTINGS.fontSize,
      scrollback: settingsRef.current?.scrollback ?? DEFAULT_EMBEDDED_TERMINAL_SETTINGS.scrollback,
      cursorStyle:
        settingsRef.current?.cursorStyle ?? DEFAULT_EMBEDDED_TERMINAL_SETTINGS.cursorStyle,
      theme: themeFromTokens(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const onData = term.onData((data) => transport.onInput(data));
    const unsubscribe = transport.subscribe((data) => term.write(data));

    const resize = (): void => {
      fit.fit();
      transport.onResize(term.cols, term.rows);
    };
    const observer = new ResizeObserver(() => resize());
    observer.observe(hostRef.current);
    resize();

    return () => {
      onData.dispose();
      unsubscribe();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [transport]);

  useEffect(() => {
    if (!active) return;
    fitRef.current?.fit();
    if (autoFocus) termRef.current?.focus();
  }, [active, autoFocus]);

  // Apply terminal settings to the live instance; a font-size change alters the cell
  // grid, so refit and tell the pty about the new dimensions.
  useEffect(() => {
    const term = termRef.current;
    if (!term || !terminalSettings) return;
    term.options.fontSize = terminalSettings.fontSize;
    term.options.scrollback = terminalSettings.scrollback;
    term.options.cursorStyle = terminalSettings.cursorStyle;
    fitRef.current?.fit();
    transport.onResize(term.cols, term.rows);
  }, [terminalSettings, transport]);

  return <div className={className} ref={hostRef} />;
}
