import { WebContentsView, session, shell, type BrowserWindow } from 'electron';
import type { PreviewBounds, PreviewHotkey, PreviewState } from '@shared/contracts/preview';

const PARTITION = 'bureau:preview';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']);

function isLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      LOOPBACK_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export type PreviewViewManager = {
  attach(window: BrowserWindow): void;
  setBounds(bounds: PreviewBounds): void;
  navigate(url: string): void;
  reload(): void;
  back(): void;
  forward(): void;
  setVisible(visible: boolean): void;
  openExternal(url: string): void;
  openDevTools(): void;
  setZoomFactor(factor: number): void;
  clearConsoleErrors(): void;
  onState(listener: (state: PreviewState) => void): () => void;
  onHotkey(listener: (hotkey: PreviewHotkey) => void): () => void;
  destroy(): void;
};

export function createPreviewViewManager(): PreviewViewManager {
  let window: BrowserWindow | undefined;
  let view: WebContentsView | undefined;
  let lastBounds: PreviewBounds | undefined;
  let failed: PreviewState['failed'] = null;
  let zoomFactor = 1;
  let consoleErrorCount = 0;
  const listeners = new Set<(state: PreviewState) => void>();
  const hotkeyListeners = new Set<(hotkey: PreviewHotkey) => void>();

  function emitHotkey(hotkey: PreviewHotkey): void {
    for (const listener of hotkeyListeners) listener(hotkey);
  }

  function emit(): void {
    const wc = view?.webContents;
    const state: PreviewState = {
      currentUrl: wc && !wc.isDestroyed() ? wc.getURL() || null : null,
      loading: wc && !wc.isDestroyed() ? wc.isLoading() : false,
      canGoBack: wc && !wc.isDestroyed() ? wc.navigationHistory.canGoBack() : false,
      canGoForward: wc && !wc.isDestroyed() ? wc.navigationHistory.canGoForward() : false,
      failed,
      zoomFactor,
      consoleErrorCount,
    };
    for (const listener of listeners) listener(state);
  }

  function hardenSession(): void {
    const preview = session.fromPartition(PARTITION);
    preview.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    preview.on('will-download', (event) => event.preventDefault());
  }

  function ensureView(): WebContentsView | undefined {
    if (view || !window) return view;
    hardenSession();

    view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    view.setVisible(false);
    window.contentView.addChildView(view);
    if (lastBounds) view.setBounds(lastBounds);

    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event, url) => {
      if (!isLoopback(url)) event.preventDefault();
    });
    wc.on('did-start-loading', () => {
      failed = null;
      emit();
    });
    wc.on('did-stop-loading', () => emit());
    wc.on('did-navigate', () => emit());
    wc.on('did-navigate-in-page', () => emit());
    wc.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return; // -3 = aborted
      failed = { code: errorCode, description: errorDescription };
      emit();
    });
    wc.on('console-message', (event) => {
      // New event-object API (the positional-args form was deprecated in Electron 36).
      if (event.level === 'warning' || event.level === 'error') {
        consoleErrorCount += 1;
        emit();
      }
    });
    // The view holds keyboard focus once the page is interacted with, so F11/Escape never
    // reach the renderer. Capture them here and forward so fullscreen is always escapable.
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isAutoRepeat) return;
      if (input.key === 'Escape') {
        emitHotkey({ key: 'escape' });
      } else if (input.key === 'F11') {
        event.preventDefault();
        emitHotkey({ key: 'f11' });
      }
    });
    try {
      wc.setZoomFactor(zoomFactor);
    } catch {
      // ignore
    }

    return view;
  }

  return {
    attach(win) {
      window = win;
    },

    setBounds(bounds) {
      lastBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
      ensureView()?.setBounds(lastBounds);
    },

    navigate(url) {
      if (!isLoopback(url)) return;
      const v = ensureView();
      if (!v) return;
      failed = null;
      void v.webContents.loadURL(url).catch(() => undefined);
    },

    reload() {
      failed = null;
      view?.webContents.reload();
    },

    back() {
      if (view?.webContents.navigationHistory.canGoBack())
        view.webContents.navigationHistory.goBack();
    },

    forward() {
      if (view?.webContents.navigationHistory.canGoForward()) {
        view.webContents.navigationHistory.goForward();
      }
    },

    setVisible(visible) {
      view?.setVisible(visible);
    },

    openExternal(url) {
      void shell.openExternal(url);
    },

    openDevTools() {
      view?.webContents.openDevTools({ mode: 'detach' });
    },

    setZoomFactor(factor) {
      zoomFactor = Math.min(3, Math.max(0.5, factor));
      try {
        ensureView()?.webContents.setZoomFactor(zoomFactor);
      } catch {
        // ignore
      }
      emit();
    },

    clearConsoleErrors() {
      consoleErrorCount = 0;
      emit();
    },

    onState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onHotkey(listener) {
      hotkeyListeners.add(listener);
      return () => hotkeyListeners.delete(listener);
    },

    destroy() {
      if (view && window) {
        window.contentView.removeChildView(view);
        view.webContents.close();
        view = undefined;
      }
    },
  };
}
