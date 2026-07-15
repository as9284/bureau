export type PreviewLoadError = { code: number; description: string };

export type PreviewState = {
  currentUrl: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  failed: PreviewLoadError | null;
  zoomFactor: number;
  consoleErrorCount: number;
};

export type PreviewBounds = { x: number; y: number; width: number; height: number };

/**
 * Keyboard shortcut captured by the embedded preview view in the main process. The view holds
 * focus once the user interacts with the page, so these keys never reach the renderer's own
 * listeners — main forwards them here so fullscreen can always be toggled/exited.
 */
export type PreviewHotkey = { key: 'escape' | 'f11' };

export type PreviewNavigateRequest = { url: string };
export type PreviewSetVisibleRequest = { visible: boolean };
export type PreviewOpenExternalRequest = { url: string };
export type PreviewSetZoomRequest = { factor: number };
