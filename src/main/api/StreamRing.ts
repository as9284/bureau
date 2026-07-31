import { randomUUID } from 'node:crypto';
import type { ApiStreamEntry } from '@shared/contracts/apiWorkbench';

export type StreamRingOptions = {
  /** Maximum entries retained in main. Oldest are evicted first. */
  capacity: number;
  /** Per-entry text cap; longer payloads are truncated and flagged. */
  maxTextBytes: number;
  /** Entries are batched over IPC by count… */
  batchSize: number;
  /** …and by time, so a slow trickle still reaches the renderer. */
  batchMs: number;
  emit(entries: ApiStreamEntry[], dropped: number): void;
};

export type StreamRing = {
  push(entry: Omit<ApiStreamEntry, 'entryId' | 'seq' | 'at'>): void;
  /** Everything currently retained, oldest first — used to seed a re-attaching pane. */
  snapshot(): { entries: ApiStreamEntry[]; dropped: number };
  /** Pausing stops renderer delivery only; the socket keeps reading into the ring. */
  setPaused(paused: boolean): void;
  flush(): void;
  dispose(): void;
};

/**
 * Bounded transcript buffer shared by the WebSocket and SSE transports.
 *
 * Reads are never paused — pausing only holds back renderer delivery, so backpressure is
 * expressed as evicted entries plus a `dropped` counter rather than as a stalled socket.
 */
export function createStreamRing(options: StreamRingOptions): StreamRing {
  const entries: ApiStreamEntry[] = [];
  let pending: ApiStreamEntry[] = [];
  let dropped = 0;
  let seq = 0;
  let paused = false;
  let timer: NodeJS.Timeout | null = null;
  let disposed = false;

  function clearTimer(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flush(): void {
    clearTimer();
    if (disposed || paused || pending.length === 0) return;
    const batch = pending;
    pending = [];
    options.emit(batch, dropped);
  }

  function scheduleFlush(): void {
    if (disposed || paused) return;
    if (pending.length >= options.batchSize) {
      flush();
      return;
    }
    if (timer) return;
    timer = setTimeout(flush, options.batchMs);
    timer.unref?.();
  }

  function truncateText(text: string | undefined): { text?: string; truncated?: boolean } {
    if (text === undefined) return {};
    const buffer = Buffer.from(text, 'utf8');
    if (buffer.byteLength <= options.maxTextBytes) return { text };
    // Slice on the byte cap, then drop any trailing partial UTF-8 sequence.
    return { text: buffer.subarray(0, options.maxTextBytes).toString('utf8'), truncated: true };
  }

  return {
    push(input) {
      if (disposed) return;
      seq += 1;
      const { text, truncated } = truncateText(input.text);
      const entry: ApiStreamEntry = {
        ...input,
        text,
        truncated: truncated || input.truncated,
        entryId: randomUUID(),
        seq,
        at: new Date().toISOString(),
      };
      entries.push(entry);
      while (entries.length > options.capacity) {
        entries.shift();
        dropped += 1;
      }
      pending.push(entry);
      // The pending batch is bounded too, or a paused pane would grow it without limit.
      while (pending.length > options.capacity) pending.shift();
      scheduleFlush();
    },
    snapshot() {
      return { entries: [...entries], dropped };
    },
    setPaused(next) {
      paused = next;
      if (!paused) flush();
    },
    flush,
    dispose() {
      disposed = true;
      clearTimer();
      entries.length = 0;
      pending = [];
    },
  };
}
