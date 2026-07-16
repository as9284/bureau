import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ArrowLeft } from '@phosphor-icons/react/ArrowLeft';
import { ArrowSquareOut } from '@phosphor-icons/react/ArrowSquareOut';
import { ArrowsClockwise } from '@phosphor-icons/react/ArrowsClockwise';
import { Camera } from '@phosphor-icons/react/Camera';
import { ClipboardText } from '@phosphor-icons/react/ClipboardText';
import { CornersIn } from '@phosphor-icons/react/CornersIn';
import { CornersOut } from '@phosphor-icons/react/CornersOut';
import { DeviceMobile } from '@phosphor-icons/react/DeviceMobile';
import { FloppyDisk } from '@phosphor-icons/react/FloppyDisk';
import { House } from '@phosphor-icons/react/House';
import { MapPin } from '@phosphor-icons/react/MapPin';
import { Power } from '@phosphor-icons/react/Power';
import { SpeakerHigh } from '@phosphor-icons/react/SpeakerHigh';
import { SpeakerLow } from '@phosphor-icons/react/SpeakerLow';
import { SquaresFour } from '@phosphor-icons/react/SquaresFour';
import type {
  AndroidAvd,
  EmulatorButton,
  EmulatorDisplayFrame,
  EmulatorDisplayRotation,
  EmulatorSnapshot,
} from '@shared/contracts/android';
import type { BureauError } from '@shared/contracts/errors';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { TextField } from '../../components/TextField';
import { useModalDismiss } from '../../lib/useModalDismiss';
import { mapPointerToDevice, shouldForwardKey } from '../../lib/emulatorCoords';
import { useAppStore } from '../../store/appStore';
import { errorHeading, toError } from '../../lib/error';

type DisplayState = 'idle' | 'connecting' | 'streaming' | 'error';

// Streams above the panel size waste bandwidth; the emulator downscales to fit.
// Raw RGBA frames are width*height*4 bytes each, so the total pixel budget is
// what actually bounds IPC bandwidth (≈6 MB/frame at the cap).
const MAX_STREAM_DIMENSION = 2048;
const MAX_STREAM_PIXELS = 1_600_000;
const MAX_STREAM_SCALE = 1.5;
const RESIZE_DEBOUNCE_MS = 250;

/** Stream size for a panel: CSS size × capped DPR, clamped to the pixel budget. */
function streamSize(container: HTMLElement | null): { width: number; height: number } {
  const scale = Math.min(window.devicePixelRatio || 1, MAX_STREAM_SCALE);
  let width = Math.min(
    MAX_STREAM_DIMENSION,
    Math.max(16, Math.round((container?.clientWidth ?? 480) * scale))
  );
  let height = Math.min(
    MAX_STREAM_DIMENSION,
    Math.max(16, Math.round((container?.clientHeight ?? 800) * scale))
  );
  if (width * height > MAX_STREAM_PIXELS) {
    const shrink = Math.sqrt(MAX_STREAM_PIXELS / (width * height));
    width = Math.max(16, Math.floor(width * shrink));
    height = Math.max(16, Math.floor(height * shrink));
  }
  return { width, height };
}

export function EmulatorDisplay({
  avd,
  onPopOut,
}: {
  avd: AndroidAvd | null;
  onPopOut(avd: AndroidAvd): void;
}) {
  const pushToast = useAppStore((state) => state.pushToast);
  const announce = useAppStore((state) => state.announce);
  const [displayState, setDisplayState] = useState<DisplayState>('idle');
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [gpsOpen, setGpsOpen] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deviceDimsRef = useRef<{ width: number; height: number } | null>(null);
  const rotationRef = useRef<EmulatorDisplayRotation>(0);
  const pendingFrameRef = useRef<EmulatorDisplayFrame | null>(null);
  const drawBusyRef = useRef(false);
  const pressedRef = useRef(false);
  const mouseButtonsRef = useRef(1);
  const moveScheduledRef = useRef(false);

  const avdName = avd?.name ?? null;
  const grpcPort = avd?.grpcPort ?? null;
  const serial = avd?.serial;
  const streamable = Boolean(avdName && grpcPort);

  // Immersive mode: the pane becomes a fixed overlay above the app chrome.
  // The canvas and stream survive the toggle (same DOM nodes), so the existing
  // ResizeObserver re-requests the stream at the fullscreen size.
  const enterImmersive = useCallback((): void => {
    setImmersive(true);
    announce('Emulator immersive mode on. Press Escape to exit.');
    requestAnimationFrame(() => canvasRef.current?.focus());
  }, [announce]);

  const exitImmersive = useCallback((): void => {
    setImmersive(false);
    announce('Emulator immersive mode off');
  }, [announce]);

  useEffect(() => {
    if (!avdName) setImmersive(false);
  }, [avdName]);

  const drawFrame = useCallback((frame: EmulatorDisplayFrame): void => {
    pendingFrameRef.current = frame;
    if (drawBusyRef.current) return;
    drawBusyRef.current = true;
    void (async () => {
      // Decode strictly one frame at a time; a newer frame replaces the queued one.
      while (pendingFrameRef.current) {
        const next = pendingFrameRef.current;
        pendingFrameRef.current = null;
        try {
          const canvas = canvasRef.current;
          if (!canvas) continue;
          if (next.format === 'rgba8888') {
            if (next.data.length !== next.width * next.height * 4) continue;
            if (canvas.width !== next.width) canvas.width = next.width;
            if (canvas.height !== next.height) canvas.height = next.height;
            // IPC-delivered bytes are always plain ArrayBuffer-backed; the cast
            // avoids copying multi-megabyte frames just to satisfy ArrayBufferLike.
            const pixels = new ImageData(
              new Uint8ClampedArray(
                next.data.buffer as ArrayBuffer,
                next.data.byteOffset,
                next.data.length
              ),
              next.width,
              next.height
            );
            canvas.getContext('2d')?.putImageData(pixels, 0, 0);
          } else {
            // Copy into a fresh ArrayBuffer-backed view (Blob rejects ArrayBufferLike).
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(next.data)], { type: 'image/png' })
            );
            if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
            if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
            canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
            bitmap.close();
          }
        } catch {
          // A torn frame decodes as garbage; the next frame recovers the view.
        }
      }
      drawBusyRef.current = false;
    })();
  }, []);

  // Stream lifecycle: subscribe to display events for this AVD, request the
  // stream at panel size, and re-request when the panel is resized.
  useEffect(() => {
    if (!avdName || !streamable) {
      setDisplayState('idle');
      setDisplayError(null);
      return;
    }
    let disposed = false;
    setDisplayState('connecting');
    setDisplayError(null);

    const unsubscribe = window.bureau.android.onDisplay((event) => {
      if (disposed || event.avdName !== avdName) return;
      if (event.deviceWidth && event.deviceHeight) {
        deviceDimsRef.current = { width: event.deviceWidth, height: event.deviceHeight };
      }
      if (event.state === 'error' || event.state === 'stopped') {
        // Never leave a dead stream looking live: a frozen canvas is worse than
        // an explicit disconnect the user can retry.
        setDisplayState('error');
        setDisplayError(
          event.error ??
            (event.state === 'stopped'
              ? 'The emulator display stream ended.'
              : 'The emulator display stream failed.')
        );
        announce(`Emulator display for ${avdName} disconnected`);
        return;
      }
      if (event.state === 'connecting') setDisplayState('connecting');
      if (event.frame) {
        rotationRef.current = event.frame.rotation;
        drawFrame(event.frame);
        setDisplayState((current) => {
          if (current !== 'streaming') announce(`Emulator display for ${avdName} connected`);
          return 'streaming';
        });
      }
    });

    const start = (): void => {
      const { width, height } = streamSize(containerRef.current);
      void window.bureau.android.startDisplay({ avdName, width, height }).then((result) => {
        if (!disposed && !result.ok) {
          setDisplayState('error');
          setDisplayError(result.error.message);
        }
      });
    };
    start();

    let resizeTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(start, RESIZE_DEBOUNCE_MS);
    });
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      disposed = true;
      observer.disconnect();
      window.clearTimeout(resizeTimer);
      unsubscribe();
      pendingFrameRef.current = null;
      void window.bureau.android.stopDisplay({ avdName });
    };
  }, [announce, avdName, drawFrame, streamable]);

  const toastFailure = useCallback(
    (cause: unknown, operation: string): void => {
      const error = toError(cause, operation);
      pushToast('error', `${errorHeading(error)}: ${error.message}`);
    },
    [pushToast]
  );

  const run = useCallback(
    async (
      operation: string,
      action: () => Promise<{ ok: true } | { ok: false; error: BureauError }>
    ) => {
      try {
        const result = await action();
        if (!result.ok) toastFailure(result.error, operation);
      } catch (cause) {
        toastFailure(cause, operation);
      }
    },
    [toastFailure]
  );

  const sendPointerAt = useCallback(
    (clientX: number, clientY: number, buttons: number): void => {
      const canvas = canvasRef.current;
      const dims = deviceDimsRef.current;
      if (!canvas || !dims || !avdName) return;
      const rect = canvas.getBoundingClientRect();
      const mapped = mapPointerToDevice({
        canvasX: clientX - rect.left,
        canvasY: clientY - rect.top,
        canvasWidth: rect.width,
        canvasHeight: rect.height,
        rotation: rotationRef.current,
        deviceWidth: dims.width,
        deviceHeight: dims.height,
      });
      if (!mapped) return;
      void window.bureau.android.sendDisplayMouse({
        avdName,
        x: mapped.x,
        y: mapped.y,
        buttons,
      });
    },
    [avdName]
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0 && event.button !== 2) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus();
    pressedRef.current = true;
    mouseButtonsRef.current = event.button === 2 ? 2 : 1;
    sendPointerAt(event.clientX, event.clientY, mouseButtonsRef.current);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!pressedRef.current || moveScheduledRef.current) return;
    moveScheduledRef.current = true;
    const { clientX, clientY } = event;
    requestAnimationFrame(() => {
      moveScheduledRef.current = false;
      if (pressedRef.current) sendPointerAt(clientX, clientY, mouseButtonsRef.current);
    });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    sendPointerAt(event.clientX, event.clientY, 0);
  };

  const pasteClipboard = useCallback((): void => {
    if (!avdName) return;
    void run('android.display.paste', () => window.bureau.android.pasteToDevice({ avdName }));
  }, [avdName, run]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      pasteClipboard();
      return;
    }
    if (!avdName || !shouldForwardKey(event)) return;
    event.preventDefault();
    void window.bureau.android.sendDisplayKey({ avdName, eventType: 'keydown', key: event.key });
  };

  const onKeyUp = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    if (!avdName || !shouldForwardKey(event)) return;
    event.preventDefault();
    void window.bureau.android.sendDisplayKey({ avdName, eventType: 'keyup', key: event.key });
  };

  const pressButton = (button: EmulatorButton): void => {
    if (!avdName) return;
    void run('android.display.button', () =>
      window.bureau.android.pressDisplayButton({ avdName, deviceId: serial, button })
    );
  };

  const streaming = displayState === 'streaming';

  return (
    <section
      className={
        immersive
          ? 'android-pane emulator-pane emulator-pane--immersive'
          : 'android-pane emulator-pane'
      }
      aria-labelledby="emulator-display-title"
      onKeyDownCapture={(event) => {
        // Escape leaves immersive mode — unless a dialog is open, which owns Escape.
        if (immersive && event.key === 'Escape' && !snapshotsOpen && !gpsOpen) {
          event.preventDefault();
          event.stopPropagation();
          exitImmersive();
        }
      }}
    >
      <div className="android-pane__header">
        <h2 id="emulator-display-title">Emulator</h2>
        <span className="mono">{avdName ?? 'none'}</span>
      </div>
      {avd && (
        <div className="emulator-toolbar" role="toolbar" aria-label="Emulator controls">
          <IconButton
            label="Rotate device"
            disabled={!serial}
            onClick={() =>
              void run('android.display.rotate', () =>
                window.bureau.android.rotateDevice({ deviceId: serial })
              )
            }
          >
            <ArrowsClockwise size={15} />
          </IconButton>
          <IconButton label="Back" disabled={!streaming} onClick={() => pressButton('back')}>
            <ArrowLeft size={15} />
          </IconButton>
          <IconButton label="Home" disabled={!streaming} onClick={() => pressButton('home')}>
            <House size={15} />
          </IconButton>
          <IconButton
            label="Recent apps"
            disabled={!streaming}
            onClick={() => pressButton('overview')}
          >
            <SquaresFour size={15} />
          </IconButton>
          <span className="emulator-toolbar__divider" aria-hidden />
          <IconButton label="Volume up" disabled={!serial} onClick={() => pressButton('volumeUp')}>
            <SpeakerHigh size={15} />
          </IconButton>
          <IconButton
            label="Volume down"
            disabled={!serial}
            onClick={() => pressButton('volumeDown')}
          >
            <SpeakerLow size={15} />
          </IconButton>
          <IconButton label="Power" disabled={!streaming} onClick={() => pressButton('power')}>
            <Power size={15} />
          </IconButton>
          <span className="emulator-toolbar__divider" aria-hidden />
          <IconButton
            label="Paste clipboard text into device"
            disabled={!streaming}
            onClick={pasteClipboard}
          >
            <ClipboardText size={15} />
          </IconButton>
          <IconButton
            label="Save screenshot"
            disabled={!streaming}
            onClick={() =>
              void (async () => {
                try {
                  const result = await window.bureau.android.saveScreenshot({ avdName: avd.name });
                  if (result.path) pushToast('success', `Screenshot saved to ${result.path}`);
                } catch (cause) {
                  toastFailure(cause, 'android.display.screenshot');
                }
              })()
            }
          >
            <Camera size={15} />
          </IconButton>
          <IconButton label="Snapshots" disabled={!serial} onClick={() => setSnapshotsOpen(true)}>
            <FloppyDisk size={15} />
          </IconButton>
          <IconButton label="Set GPS location" disabled={!serial} onClick={() => setGpsOpen(true)}>
            <MapPin size={15} />
          </IconButton>
          <span className="emulator-toolbar__divider" aria-hidden />
          <IconButton
            label="Open in separate window"
            onClick={() => {
              exitImmersive();
              onPopOut(avd);
            }}
          >
            <ArrowSquareOut size={15} />
          </IconButton>
          <IconButton
            label={immersive ? 'Exit immersive mode' : 'Immersive mode'}
            onClick={immersive ? exitImmersive : enterImmersive}
          >
            {immersive ? <CornersIn size={15} /> : <CornersOut size={15} />}
          </IconButton>
        </div>
      )}
      <div ref={containerRef} className="emulator-stage">
        {!avd && (
          <div className="android-empty">
            <DeviceMobile size={30} />
            <strong>No running emulator</strong>
            <span>Start a virtual device to see and control it here.</span>
          </div>
        )}
        {avd && !streamable && (
          <div className="android-empty">
            <DeviceMobile size={30} />
            <strong>Embedded display unavailable</strong>
            <span>
              {avd.name} is running without a control port. Stop it and start it again from Bureau
              to attach the embedded display.
            </span>
          </div>
        )}
        {avd && streamable && displayState === 'error' && (
          <div className="emulator-stage__error" role="alert">
            <strong>Display disconnected</strong>
            <span>{displayError}</span>
            <Button
              onClick={() => {
                setDisplayState('connecting');
                setDisplayError(null);
                const { width, height } = streamSize(containerRef.current);
                void window.bureau.android.startDisplay({ avdName: avd.name, width, height });
              }}
            >
              Retry
            </Button>
          </div>
        )}
        {avd && streamable && displayState === 'connecting' && (
          <div className="emulator-stage__connecting" aria-live="off">
            <span className="emulator-stage__pulse" aria-hidden />
            Connecting to {avd.name}…
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="emulator-stage__canvas"
          data-visible={streaming || undefined}
          tabIndex={streaming ? 0 : -1}
          aria-label={`${avdName ?? 'Emulator'} screen. Click to interact; keyboard input is forwarded to the device.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>
      {snapshotsOpen && avd && (
        <SnapshotsDialog
          serial={serial}
          onClose={() => setSnapshotsOpen(false)}
          onToast={pushToast}
        />
      )}
      {gpsOpen && avd && (
        <GpsDialog serial={serial} onClose={() => setGpsOpen(false)} onToast={pushToast} />
      )}
    </section>
  );
}

type ToastFn = (tone: 'info' | 'success' | 'error', message: string) => void;

function SnapshotsDialog({
  serial,
  onClose,
  onToast,
}: {
  serial?: string;
  onClose(): void;
  onToast: ToastFn;
}) {
  const [snapshots, setSnapshots] = useState<EmulatorSnapshot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDismiss(onClose, dialogRef);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const result = await window.bureau.android.listSnapshots({ deviceId: serial });
      setSnapshots(result.snapshots);
      setLoadError(null);
    } catch (cause) {
      setSnapshots([]);
      setLoadError(toError(cause, 'android.snapshot.list').message);
    }
  }, [serial]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (
    key: string,
    operation: string,
    action: () => Promise<{ ok: true } | { ok: false; error: BureauError }>,
    success: string
  ): Promise<void> => {
    setBusy(key);
    try {
      const result = await action();
      if (result.ok) {
        onToast('success', success);
        await refresh();
      } else {
        onToast('error', `${errorHeading(result.error)}: ${result.error.message}`);
      }
    } catch (cause) {
      const error = toError(cause, operation);
      onToast('error', `${errorHeading(error)}: ${error.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="overlay-root" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="dialog dialog--form android-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="emulator-snapshots-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="emulator-snapshots-title">Emulator snapshots</h2>
        </div>
        <div className="dialog__body emulator-snapshots">
          {loadError && (
            <div className="android-banner error" role="alert">
              <span>{loadError}</span>
            </div>
          )}
          {snapshots === null ? (
            <p className="emulator-snapshots__hint">Loading snapshots…</p>
          ) : snapshots.length === 0 ? (
            <p className="emulator-snapshots__hint">
              No snapshots yet. Save the current device state below.
            </p>
          ) : (
            <ul className="emulator-snapshots__list">
              {snapshots.map((snapshot) => (
                <li key={snapshot.name}>
                  <span className="mono">{snapshot.name}</span>
                  {snapshot.sizeLabel && <span className="mono">{snapshot.sizeLabel}</span>}
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        `load-${snapshot.name}`,
                        'android.snapshot.load',
                        () =>
                          window.bureau.android.loadSnapshot({
                            deviceId: serial,
                            name: snapshot.name,
                          }),
                        `Snapshot ${snapshot.name} loaded`
                      )
                    }
                  >
                    {busy === `load-${snapshot.name}` ? 'Loading…' : 'Load'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="emulator-snapshots__save">
            <TextField
              aria-label="New snapshot name"
              placeholder="snapshot-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              variant="primary"
              disabled={busy !== null || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)}
              onClick={() =>
                void act(
                  'save',
                  'android.snapshot.save',
                  () => window.bureau.android.saveSnapshot({ deviceId: serial, name }),
                  `Snapshot ${name} saved`
                ).then(() => setName(''))
              }
            >
              {busy === 'save' ? 'Saving…' : 'Save snapshot'}
            </Button>
          </div>
        </div>
        <div className="dialog__footer">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

function GpsDialog({
  serial,
  onClose,
  onToast,
}: {
  serial?: string;
  onClose(): void;
  onToast: ToastFn;
}) {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDismiss(onClose, dialogRef);
  const lat = Number.parseFloat(latitude);
  const lng = Number.parseFloat(longitude);
  const valid =
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  return (
    <div className="overlay-root" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="dialog dialog--form android-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="emulator-gps-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="emulator-gps-title">Set GPS location</h2>
        </div>
        <div className="dialog__body android-options">
          <label>
            Latitude
            <TextField
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              placeholder="37.4220"
              inputMode="decimal"
            />
          </label>
          <label>
            Longitude
            <TextField
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              placeholder="-122.0841"
              inputMode="decimal"
            />
          </label>
        </div>
        <div className="dialog__footer">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid || busy}
            onClick={() =>
              void (async () => {
                setBusy(true);
                try {
                  const result = await window.bureau.android.sendGeoFix({
                    deviceId: serial,
                    latitude: lat,
                    longitude: lng,
                  });
                  if (result.ok) {
                    onToast('success', 'GPS location updated');
                    onClose();
                  } else {
                    onToast('error', `${errorHeading(result.error)}: ${result.error.message}`);
                  }
                } catch (cause) {
                  const error = toError(cause, 'android.geo.fix');
                  onToast('error', `${errorHeading(error)}: ${error.message}`);
                } finally {
                  setBusy(false);
                }
              })()
            }
          >
            {busy ? 'Setting…' : 'Set location'}
          </Button>
        </div>
      </div>
    </div>
  );
}
