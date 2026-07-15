import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, type ViewportPreset } from '../../store/appStore';
import { IconButton } from '../../components/IconButton';
import { Dropdown } from '../../components/Dropdown';
import {
  ChevronIcon,
  CollapseIcon,
  ExpandIcon,
  ExternalIcon,
  RestartIcon,
} from '../../components/icons';
import { computeBounds, normalizeLoopback } from '../../lib/previewGeometry';

const VIEWPORT_ORDER: ViewportPreset[] = ['fill', 'mobile', 'tablet', 'desktop'];
const VIEWPORT_LABEL: Record<ViewportPreset, string> = {
  fill: 'Fill',
  mobile: 'Mobile',
  tablet: 'Tablet',
  desktop: 'Desktop',
};

type Frame = { left: number; top: number; width: number; height: number } | null;

function sourceLabel(source: string): string {
  try {
    const url = new URL(source);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || url.host;
  } catch {
    return source.split('/').pop() || source;
  }
}

export function PreviewTab() {
  const previewUrl = useAppStore((s) => s.previewUrl);
  const previewState = useAppStore((s) => s.previewState);
  const viewport = useAppStore((s) => s.previewViewport);
  const rotated = useAppStore((s) => s.previewRotated);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const processes = useAppStore((s) =>
    selectedProjectId ? s.processesByProject[selectedProjectId] : undefined
  );
  const previewNavigate = useAppStore((s) => s.previewNavigate);
  const previewReload = useAppStore((s) => s.previewReload);
  const previewReloadHard = useAppStore((s) => s.previewReloadHard);
  const previewRecents = useAppStore((s) => s.previewRecents);
  const previewBack = useAppStore((s) => s.previewBack);
  const previewForward = useAppStore((s) => s.previewForward);
  const previewOpenExternal = useAppStore((s) => s.previewOpenExternal);
  const previewOpenDevTools = useAppStore((s) => s.previewOpenDevTools);
  const setPreviewZoom = useAppStore((s) => s.setPreviewZoom);
  const clearPreviewConsole = useAppStore((s) => s.clearPreviewConsole);
  const previewConsole = useAppStore((s) => s.previewConsole);
  const previewConsoleOpen = useAppStore((s) => s.previewConsoleOpen);
  const togglePreviewConsole = useAppStore((s) => s.togglePreviewConsole);
  const setPreviewViewport = useAppStore((s) => s.setPreviewViewport);
  const togglePreviewRotate = useAppStore((s) => s.togglePreviewRotate);
  const fullscreen = useAppStore((s) => s.previewFullscreen);
  const togglePreviewFullscreen = useAppStore((s) => s.togglePreviewFullscreen);
  const setPreviewFullscreen = useAppStore((s) => s.setPreviewFullscreen);
  const pushToast = useAppStore((s) => s.pushToast);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const consoleListRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState('');
  const [frame, setFrame] = useState<Frame>(null);
  const [consoleErrorsOnly, setConsoleErrorsOnly] = useState(false);

  const consoleMessages = useMemo(
    () =>
      consoleErrorsOnly
        ? previewConsole.filter((m) => m.level === 'error' || m.level === 'warning')
        : previewConsole,
    [previewConsole, consoleErrorsOnly]
  );

  const failed = previewState?.failed ?? null;
  const showView = Boolean(previewUrl) && !failed;
  const zoom = previewState?.zoomFactor ?? 1;
  const consoleErrors = previewState?.consoleErrorCount ?? 0;

  const candidateUrls = useMemo(() => {
    const urls = new Set<string>();
    if (previewUrl) urls.add(previewUrl);
    for (const runtime of processes?.runtimes ?? []) {
      if (runtime.detectedUrl) urls.add(runtime.detectedUrl);
    }
    for (const definition of processes?.definitions ?? []) {
      if (definition.urlPattern) urls.add(definition.urlPattern);
    }
    for (const recent of previewRecents) urls.add(recent);
    return [...urls];
  }, [previewUrl, processes, previewRecents]);

  const applyLayout = useCallback(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const bounds = computeBounds(rect, viewport, rotated);
    window.bureau.preview.setBounds(bounds);
    setFrame(
      viewport === 'fill'
        ? null
        : {
            left: bounds.x - rect.left,
            top: bounds.y - rect.top,
            width: bounds.width,
            height: bounds.height,
          }
    );
  }, [viewport, rotated]);

  useEffect(() => {
    setAddress(previewState?.currentUrl ?? previewUrl ?? '');
  }, [previewState?.currentUrl, previewUrl]);

  useEffect(() => {
    window.bureau.preview.setVisible({ visible: showView });
    if (!showView) setFrame(null);
  }, [showView]);

  useEffect(() => () => void window.bureau.preview.setVisible({ visible: false }), []);

  useLayoutEffect(() => {
    if (showView) applyLayout();
  }, [showView, applyLayout, fullscreen, previewConsoleOpen]);

  // Keep the console pinned to the latest output while it's open.
  useEffect(() => {
    if (!previewConsoleOpen) return;
    const list = consoleListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [consoleMessages, previewConsoleOpen]);

  useEffect(() => {
    // Handles F11/Escape when focus is in the app chrome. When focus is inside the embedded
    // preview view, these keys are captured in main and delivered via preview.onHotkey below.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'F11' && previewUrl) {
        event.preventDefault();
        togglePreviewFullscreen();
      } else if (event.key === 'Escape' && fullscreen) {
        event.preventDefault();
        setPreviewFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const unsubHotkey = window.bureau.preview.onHotkey((hotkey) => {
      if (hotkey.key === 'f11' && previewUrl) {
        togglePreviewFullscreen();
      } else if (hotkey.key === 'escape' && fullscreen) {
        setPreviewFullscreen(false);
      }
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      unsubHotkey();
    };
  }, [previewUrl, fullscreen, togglePreviewFullscreen, setPreviewFullscreen]);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => applyLayout());
    observer.observe(el);
    window.addEventListener('resize', applyLayout);
    window.addEventListener('scroll', applyLayout, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', applyLayout);
      window.removeEventListener('scroll', applyLayout, true);
    };
  }, [applyLayout]);

  useEffect(() => {
    if (!failed || !previewUrl) return;
    const timer = setTimeout(() => previewReload(), 2500);
    return () => clearTimeout(timer);
  }, [failed, previewUrl, previewReload]);

  const submitAddress = (): void => {
    const url = normalizeLoopback(address);
    if (!url) {
      pushToast('error', 'Enter a localhost URL, e.g. http://localhost:3000');
      return;
    }
    previewNavigate(url);
  };

  return (
    <div className={['preview-tab', fullscreen ? 'fullscreen' : ''].join(' ')}>
      <div className="preview-toolbar">
        <IconButton label="Back" disabled={!previewState?.canGoBack} onClick={() => previewBack()}>
          <ChevronIcon size={16} style={{ transform: 'rotate(180deg)' }} />
        </IconButton>
        <IconButton
          label="Forward"
          disabled={!previewState?.canGoForward}
          onClick={() => previewForward()}
        >
          <ChevronIcon size={16} />
        </IconButton>
        <IconButton
          label="Reload (Shift-click to ignore cache)"
          disabled={!previewUrl}
          onClick={(e) => (e.shiftKey ? previewReloadHard() : previewReload())}
        >
          <RestartIcon size={14} />
        </IconButton>

        {candidateUrls.length > 1 && (
          <Dropdown
            className="preview-url-switcher"
            label="Preview URL"
            value={previewUrl ?? ''}
            options={candidateUrls.map((url) => ({ value: url, label: url }))}
            onChange={(url) => previewNavigate(url)}
          />
        )}

        <input
          className="preview-address mono"
          value={address}
          spellCheck={false}
          placeholder="http://localhost:3000"
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAddress();
          }}
        />

        <div className="preview-zoom">
          <IconButton
            label="Zoom out"
            disabled={!previewUrl}
            onClick={() => setPreviewZoom(Math.max(0.5, zoom - 0.1))}
          >
            −
          </IconButton>
          <button
            type="button"
            className="preview-zoom__value mono"
            disabled={!previewUrl}
            title="Reset zoom to 100%"
            onClick={() => setPreviewZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton
            label="Zoom in"
            disabled={!previewUrl}
            onClick={() => setPreviewZoom(Math.min(3, zoom + 0.1))}
          >
            +
          </IconButton>
        </div>

        <div className="preview-viewports">
          {VIEWPORT_ORDER.map((preset) => (
            <button
              key={preset}
              type="button"
              className={['preview-vp', viewport === preset ? 'active' : ''].join(' ')}
              onClick={() => setPreviewViewport(preset)}
            >
              {VIEWPORT_LABEL[preset]}
            </button>
          ))}
        </div>
        <IconButton
          label="Rotate"
          disabled={viewport === 'fill'}
          onClick={() => togglePreviewRotate()}
        >
          <RestartIcon size={14} />
        </IconButton>
        <IconButton
          label="Open in browser"
          disabled={!previewUrl}
          onClick={() => previewOpenExternal()}
        >
          <ExternalIcon size={15} />
        </IconButton>
        <IconButton label="DevTools" disabled={!previewUrl} onClick={() => previewOpenDevTools()}>
          <span className="preview-devtools-glyph">{'{}'}</span>
        </IconButton>
        <button
          type="button"
          className={[
            'preview-console-badge',
            previewConsoleOpen ? 'is-open' : '',
            consoleErrors > 0 ? 'active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          disabled={!previewUrl}
          aria-pressed={previewConsoleOpen}
          title="Toggle the in-app console"
          onClick={() => togglePreviewConsole()}
        >
          Console{consoleErrors > 0 ? ` ${consoleErrors}` : ''}
        </button>
        <IconButton
          label={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F11)'}
          className={fullscreen ? 'active' : ''}
          disabled={!previewUrl}
          onClick={() => togglePreviewFullscreen()}
        >
          {fullscreen ? <CollapseIcon size={15} /> : <ExpandIcon size={15} />}
        </IconButton>
      </div>

      <div
        className={['preview-surface', viewport !== 'fill' ? 'matte' : ''].join(' ')}
        ref={surfaceRef}
      >
        {showView && frame && (
          <>
            <div
              className="preview-frame"
              style={{
                left: frame.left,
                top: frame.top,
                width: frame.width,
                height: frame.height,
              }}
            />
            <div
              className="preview-frame-size mono"
              style={{ left: frame.left, top: Math.max(4, frame.top - 22) }}
            >
              {Math.round(frame.width)} × {Math.round(frame.height)}
            </div>
          </>
        )}
        {!showView && (
          <div className="preview-overlay">
            {failed ? (
              <>
                <h2>Can’t reach the server</h2>
                <p className="mono">{previewUrl}</p>
                <p>{failed.description} — reconnecting…</p>
                <button type="button" className="button secondary" onClick={() => previewReload()}>
                  Retry now
                </button>
              </>
            ) : (
              <>
                <h2>No preview yet</h2>
                <p>
                  Enter a local URL above, or open one from a running process in the Processes tab.
                </p>
              </>
            )}
          </div>
        )}
      </div>
      {previewConsoleOpen && (
        <div className="preview-console">
          <div className="preview-console__header">
            <span className="preview-console__title">Console</span>
            <span className="preview-console__count mono">{consoleMessages.length}</span>
            <div className="preview-console__spacer" />
            <button
              type="button"
              className={['preview-console__btn', consoleErrorsOnly ? 'active' : '']
                .filter(Boolean)
                .join(' ')}
              aria-pressed={consoleErrorsOnly}
              onClick={() => setConsoleErrorsOnly((value) => !value)}
            >
              Errors only
            </button>
            <button
              type="button"
              className="preview-console__btn"
              onClick={() => clearPreviewConsole()}
            >
              Clear
            </button>
            <IconButton label="Close console" onClick={() => togglePreviewConsole()}>
              <CollapseIcon size={14} />
            </IconButton>
          </div>
          <div className="preview-console__list" ref={consoleListRef}>
            {consoleMessages.length === 0 ? (
              <div className="preview-console__empty">No console output captured yet.</div>
            ) : (
              consoleMessages.map((message) => (
                <div key={message.id} className={`preview-console__row is-${message.level}`}>
                  <span className="preview-console__level">{message.level}</span>
                  <span className="preview-console__text mono">{message.text}</span>
                  {message.source ? (
                    <span className="preview-console__source mono">
                      {sourceLabel(message.source)}
                      {message.line ? `:${message.line}` : ''}
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
