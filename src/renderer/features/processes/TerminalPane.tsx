import { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

/**
 * Build an xterm theme from the graphite design tokens (tokens.css). xterm's `theme`
 * needs concrete color strings, not CSS `var()`, so we resolve the custom properties
 * off `documentElement` at mount — this keeps the terminal on-palette and following the
 * active light/dark theme instead of the previous hard-coded off-token colors.
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

function monoFontFamily(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--font-family-mono').trim() ||
    "'Geist Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
  );
}

export function TerminalPane({
  projectId,
  processId,
  active,
}: {
  projectId: string;
  processId: string;
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      convertEol: true,
      fontFamily: monoFontFamily(),
      fontSize: 12,
      theme: themeFromTokens(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const onData = term.onData((data) => {
      void window.bureau.processes.writePty({ projectId, processId, data });
    });

    const unsub = window.bureau.processes.onPty((event) => {
      if (event.projectId !== projectId || event.processId !== processId) return;
      term.write(event.data);
    });

    const resize = (): void => {
      fit.fit();
      void window.bureau.processes.resizePty({
        projectId,
        processId,
        cols: term.cols,
        rows: term.rows,
      });
    };
    const observer = new ResizeObserver(() => resize());
    observer.observe(hostRef.current);
    resize();

    return () => {
      onData.dispose();
      unsub();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [projectId, processId]);

  useEffect(() => {
    if (active) fitRef.current?.fit();
  }, [active]);

  return <div className="terminal-pane" ref={hostRef} />;
}
