import type {
  ApiEntityId,
  ApiSessionEvent,
  ApiStreamEntry,
  ApiStreamStatus,
} from '@shared/contracts/apiWorkbench';
import type { ApiSettings } from '@shared/contracts/settings';
import type { ApiSessionRegistry } from './ApiSessionRegistry';
import { createStreamRing, type StreamRing } from './StreamRing';

/** Binary frames above this go to a body handle instead of an inline preview. */
export const BINARY_HANDLE_THRESHOLD = 64 * 1024;
const BATCH_SIZE = 40;
const BATCH_MS = 60;

export type StreamSessionContext = {
  sessionId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId: ApiEntityId;
  protocol: 'websocket' | 'sse';
  ring: StreamRing;
  status: ApiStreamStatus;
  /** Text frames a user can send; SSE sessions reject sends. */
  send?: (input: { format: 'text' | 'json' | 'binary-hex'; payload: string }) => void;
  close: (code?: number, reason?: string) => void;
  setPaused(paused: boolean): void;
  snapshot(): { entries: ApiStreamEntry[]; dropped: number };
};

export type StreamSessionRegistry = {
  create(input: {
    sessionId: ApiEntityId;
    workspaceId: ApiEntityId;
    requestId: ApiEntityId;
    protocol: 'websocket' | 'sse';
    settings: ApiSettings;
  }): StreamSessionContext;
  get(sessionId: string): StreamSessionContext | undefined;
  setStatus(sessionId: string, status: ApiStreamStatus): void;
  remove(sessionId: string): void;
  dispose(): void;
};

/**
 * Owns the per-session transcript rings and turns ring flushes into batched IPC events.
 * Kept separate from `ApiSessionRegistry` (which owns cancellation) so a socket's buffering
 * concerns do not leak into cancellation semantics.
 */
export function createStreamSessionRegistry(
  emit: (event: ApiSessionEvent) => void,
  sessions: ApiSessionRegistry
): StreamSessionRegistry {
  const contexts = new Map<string, StreamSessionContext>();

  return {
    create(input) {
      const ring = createStreamRing({
        capacity: input.settings.streamEventCap,
        maxTextBytes: input.settings.perMessageDisplayBytes,
        batchSize: BATCH_SIZE,
        batchMs: BATCH_MS,
        emit: (entries, dropped) => {
          emit({
            type: 'stream-entries',
            sessionId: input.sessionId,
            workspaceId: input.workspaceId,
            requestId: input.requestId,
            seq: sessions.nextSeq(input.sessionId),
            entries,
            dropped,
          });
        },
      });

      const context: StreamSessionContext = {
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        requestId: input.requestId,
        protocol: input.protocol,
        ring,
        status: 'connecting',
        close: () => undefined,
        setPaused: (paused) => ring.setPaused(paused),
        snapshot: () => ring.snapshot(),
      };
      contexts.set(input.sessionId, context);
      return context;
    },

    get(sessionId) {
      return contexts.get(sessionId);
    },

    setStatus(sessionId, status) {
      const context = contexts.get(sessionId);
      if (context) context.status = status;
    },

    remove(sessionId) {
      const context = contexts.get(sessionId);
      if (!context) return;
      context.ring.dispose();
      contexts.delete(sessionId);
    },

    dispose() {
      for (const context of contexts.values()) context.ring.dispose();
      contexts.clear();
    },
  };
}
