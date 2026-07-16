import type { ClientReadableStream } from '@grpc/grpc-js';
import type {
  EmulatorDisplayEvent,
  EmulatorDisplayRotation,
  EmulatorDisplayStartRequest,
  EmulatorKeyRequest,
  EmulatorMouseRequest,
} from '@shared/contracts/android';
import type { OkResult } from '@shared/contracts/errors';
import { toBureauError } from '../ipc/errors';
import {
  createEmulatorControllerClient,
  IMG_FORMAT_PNG,
  IMG_FORMAT_RGBA8888,
  isCancelledError,
  KEY_EVENT_TYPE,
  type EmulatorControllerClient,
  type ImageMessage,
} from './EmulatorControllerClient';

export type EmulatorDisplayService = ReturnType<typeof createEmulatorDisplayService>;

// Frames are forwarded at most every FRAME_MIN_INTERVAL_MS; the latest frame is
// never dropped — it is deferred so the display converges on the final image.
// 16ms tracks the guest's default 60Hz refresh; the emulator only emits on
// change, so an idle screen costs nothing and this only binds during animation.
const FRAME_MIN_INTERVAL_MS = 16;
const CONNECT_TIMEOUT_MS = 15_000;

type Session = {
  client: EmulatorControllerClient;
  stream: ClientReadableStream<ImageMessage> | null;
  width: number;
  height: number;
  deviceWidth: number | null;
  deviceHeight: number | null;
  lastEmitAt: number;
  pendingFrame: ImageMessage | null;
  flushTimer: NodeJS.Timeout | null;
};

export function createEmulatorDisplayService(deps: {
  resolveGrpcPort: (avdName: string) => Promise<number | null>;
  clientFactory?: (host: string, port: number) => EmulatorControllerClient;
}) {
  const clientFactory = deps.clientFactory ?? createEmulatorControllerClient;
  const sessions = new Map<string, Session>();
  const listeners = new Set<(event: EmulatorDisplayEvent) => void>();

  function emit(event: EmulatorDisplayEvent): void {
    for (const listener of listeners) listener(event);
  }

  function baseEvent(avdName: string, session?: Session): Omit<EmulatorDisplayEvent, 'state'> {
    return {
      avdName,
      deviceWidth: session?.deviceWidth ?? null,
      deviceHeight: session?.deviceHeight ?? null,
    };
  }

  function emitFrame(avdName: string, session: Session, image: ImageMessage): void {
    const rotationRaw = image.format?.rotation?.rotation ?? 0;
    const rotation = (
      rotationRaw >= 0 && rotationRaw <= 3 ? rotationRaw : 0
    ) as EmulatorDisplayRotation;
    const width = image.format?.width ?? 0;
    const height = image.format?.height ?? 0;
    // A raw frame must be exactly width*height*4 bytes or the renderer cannot
    // interpret it; a mismatched frame (mid-rotation resize) is dropped.
    if (!width || !height || image.image.length !== width * height * 4) return;
    session.lastEmitAt = Date.now();
    emit({
      ...baseEvent(avdName, session),
      state: 'streaming',
      frame: {
        seq: image.seq ?? 0,
        width,
        height,
        rotation,
        format: 'rgba8888',
        data: image.image,
      },
    });
  }

  function scheduleFrame(avdName: string, session: Session, image: ImageMessage): void {
    if (!image.image?.length) return;
    const elapsed = Date.now() - session.lastEmitAt;
    if (elapsed >= FRAME_MIN_INTERVAL_MS) {
      emitFrame(avdName, session, image);
      return;
    }
    session.pendingFrame = image;
    session.flushTimer ??= setTimeout(() => {
      session.flushTimer = null;
      if (session.pendingFrame) {
        const pending = session.pendingFrame;
        session.pendingFrame = null;
        emitFrame(avdName, session, pending);
      }
    }, FRAME_MIN_INTERVAL_MS - elapsed);
  }

  function teardown(avdName: string, session: Session): void {
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.flushTimer = null;
    session.pendingFrame = null;
    closeStream(session);
    session.client.close();
    sessions.delete(avdName);
  }

  /** Detaches the live stream so its late end/error events are ignored. */
  function closeStream(session: Session): void {
    const stream = session.stream;
    session.stream = null;
    stream?.cancel();
  }

  function openStream(avdName: string, session: Session): void {
    // Raw RGBA avoids per-frame PNG encoding in the emulator (the dominant
    // latency cost); the caller bounds width/height so bandwidth stays sane.
    const stream = session.client.streamScreenshot({
      format: IMG_FORMAT_RGBA8888,
      width: session.width,
      height: session.height,
    });
    session.stream = stream;
    // A cancelled stream still emits end/error asynchronously, by which time a
    // resize may already have opened its replacement. Every handler is keyed to
    // its own stream so a superseded one can never tear down the live session.
    const isCurrent = (): boolean => session.stream === stream;
    stream.on('data', (image: ImageMessage) => {
      if (isCurrent()) scheduleFrame(avdName, session, image);
    });
    stream.on('error', (error: Error) => {
      if (!isCurrent() || isCancelledError(error)) return;
      teardown(avdName, session);
      emit({ ...baseEvent(avdName, session), state: 'error', error: error.message });
    });
    stream.on('end', () => {
      if (!isCurrent()) return;
      teardown(avdName, session);
      emit({ ...baseEvent(avdName, session), state: 'stopped' });
    });
  }

  async function start(input: EmulatorDisplayStartRequest): Promise<OkResult> {
    const existing = sessions.get(input.avdName);
    if (existing?.stream && existing.width === input.width && existing.height === input.height) {
      return { ok: true };
    }
    if (existing) {
      // Same emulator, new viewport: swap the stream on the live connection.
      closeStream(existing);
      existing.width = input.width;
      existing.height = input.height;
      // Frames queued at the old size would draw once at the wrong scale.
      existing.pendingFrame = null;
      openStream(input.avdName, existing);
      return { ok: true };
    }
    emit({ avdName: input.avdName, state: 'connecting', deviceWidth: null, deviceHeight: null });
    try {
      const port = await deps.resolveGrpcPort(input.avdName);
      if (!port) {
        const error = toBureauError({
          code: 'EMULATOR_GRPC_UNAVAILABLE',
          message:
            'This emulator does not expose a gRPC control port. Restart the AVD from Bureau to enable the embedded display.',
          operation: 'android.display.start',
          subjectId: input.avdName,
        });
        emit({ ...baseEvent(input.avdName), state: 'error', error: error.message });
        return { ok: false, error };
      }
      const client = clientFactory('127.0.0.1', port);
      const session: Session = {
        client,
        stream: null,
        width: input.width,
        height: input.height,
        deviceWidth: null,
        deviceHeight: null,
        lastEmitAt: 0,
        pendingFrame: null,
        flushTimer: null,
      };
      try {
        await client.waitForReady(CONNECT_TIMEOUT_MS);
        const status = await client.getStatus();
        for (const entry of status.hardwareConfig?.entry ?? []) {
          if (entry.key === 'hw.lcd.width') session.deviceWidth = Number(entry.value) || null;
          if (entry.key === 'hw.lcd.height') session.deviceHeight = Number(entry.value) || null;
        }
      } catch (error) {
        client.close();
        throw error;
      }
      sessions.set(input.avdName, session);
      openStream(input.avdName, session);
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not connect to the emulator display.';
      emit({ ...baseEvent(input.avdName), state: 'error', error: message });
      return {
        ok: false,
        error: toBureauError({
          code: 'EMULATOR_GRPC_UNAVAILABLE',
          message,
          operation: 'android.display.start',
          subjectId: input.avdName,
          retryable: true,
        }),
      };
    }
  }

  async function stop(avdName: string): Promise<OkResult> {
    const session = sessions.get(avdName);
    if (session) {
      teardown(avdName, session);
      emit({ ...baseEvent(avdName, session), state: 'stopped' });
    }
    return { ok: true };
  }

  function requireSession(avdName: string, operation: string): Session {
    const session = sessions.get(avdName);
    if (!session)
      throw toBureauError({
        code: 'INVALID_REQUEST',
        message: 'The embedded display is not connected to this emulator.',
        operation,
        subjectId: avdName,
      });
    return session;
  }

  async function inputResult(operation: string, action: () => Promise<void>): Promise<OkResult> {
    try {
      await action();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: isDomainError(error)
          ? error
          : toBureauError({
              code: 'COMMAND_FAILED',
              message:
                error instanceof Error ? error.message : 'The emulator rejected the input event.',
              operation,
              retryable: true,
            }),
      };
    }
  }

  async function sendMouse(input: EmulatorMouseRequest): Promise<OkResult> {
    return inputResult('android.display.mouse', () =>
      requireSession(input.avdName, 'android.display.mouse').client.sendMouse({
        x: input.x,
        y: input.y,
        buttons: input.buttons,
      })
    );
  }

  async function sendKey(input: EmulatorKeyRequest): Promise<OkResult> {
    return inputResult('android.display.key', () =>
      requireSession(input.avdName, 'android.display.key').client.sendKey({
        eventType: KEY_EVENT_TYPE[input.eventType],
        ...(input.key ? { key: input.key } : {}),
        ...(input.text ? { text: input.text } : {}),
      })
    );
  }

  /** Presses a device key by W3C key value (GoBack, GoHome, AppSwitch, Power, …). */
  async function pressKey(avdName: string, key: string): Promise<OkResult> {
    return inputResult('android.display.button', () =>
      requireSession(avdName, 'android.display.button').client.sendKey({
        eventType: KEY_EVENT_TYPE.keypress,
        key,
      })
    );
  }

  async function setClipboard(avdName: string, text: string): Promise<void> {
    await requireSession(avdName, 'android.display.paste').client.setClipboard(text);
  }

  async function typeText(avdName: string, text: string): Promise<void> {
    await requireSession(avdName, 'android.display.paste').client.sendKey({
      eventType: KEY_EVENT_TYPE.keypress,
      text,
    });
  }

  /** Full-resolution PNG of the current screen (independent of the stream size). */
  async function screenshotPng(avdName: string): Promise<Buffer> {
    const session = requireSession(avdName, 'android.display.screenshot');
    const image = await session.client.getScreenshot({ format: IMG_FORMAT_PNG });
    if (!image.image?.length) throw new Error('The emulator returned an empty screenshot.');
    return image.image;
  }

  function onEvent(listener: (event: EmulatorDisplayEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function dispose(): void {
    for (const [avdName, session] of sessions) teardown(avdName, session);
    sessions.clear();
    listeners.clear();
  }

  return {
    start,
    stop,
    sendMouse,
    sendKey,
    pressKey,
    setClipboard,
    typeText,
    screenshotPng,
    onEvent,
    dispose,
  };
}

function isDomainError(error: unknown): error is import('@shared/contracts/errors').BureauError {
  return typeof error === 'object' && error !== null && 'code' in error && 'operation' in error;
}
