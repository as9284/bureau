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
  const previewBack = useAppStore((s) => s.previewBack);
  const previewForward = useAppStore((s) => s.previewForward);
  const previewOpenExternal = useAppStore((s) => s.previewOpenExternal);
  const previewOpenDevTools = useAppStore((s) => s.previewOpenDevTools);
  const setPreviewZoom = useAppStore((s) => s.setPreviewZoom);
  const clearPreviewConsole = useAppStore((s) => s.clearPreviewConsole);
  const setPreviewViewport = useAppStore((s) => s.setPreviewViewport);
  const togglePreviewRotate = useAppStore((s) => s.togglePreviewRotate);
  const fullscreen = useAppStore((s) => s.previewFullscreen);
  const togglePreviewFullscreen = useAppStore((s) => s.togglePreviewFullscreen);
  const setPreviewFullscreen = useAppStore((s) => s.setPreviewFullscreen);
  const pushToast = useAppStore((s) => s.pushToast);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState('');
  const [frame, setFrame] = useState<Frame>(null);

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
    return [...urls];
  }, [previewUrl, processes]);

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
  }, [showView, applyLayout, fullscreen]);

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
        <IconButton label="Reload" disabled={!previewUrl} onClick={() => previewReload()}>
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
          <span className="preview-zoom__value mono">{Math.round(zoom * 100)}%</span>
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
          className={['preview-console-badge', consoleErrors > 0 ? 'active' : ''].join(' ')}
          disabled={!previewUrl}
          title="Console errors — click to clear count, open DevTools for details"
          onClick={() => {
            previewOpenDevTools();
            clearPreviewConsole();
          }}
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
    </div>
  );
}
