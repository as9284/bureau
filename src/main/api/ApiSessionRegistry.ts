import { randomUUID } from 'node:crypto';

/** Anything a session owns that must be released on cancel, close, or shutdown. */
export type SessionResources = {
  /** Closes sockets, streams, timers, and rings. Must be idempotent. */
  dispose(): void;
};

export type ApiSessionKind = 'request' | 'websocket' | 'sse';

export type ApiSessionInfo = {
  sessionId: string;
  workspaceId: string;
  requestId: string;
  kind: ApiSessionKind;
};

export type ApiSessionRegistry = {
  create(input: {
    workspaceId: string;
    requestId: string;
    kind: ApiSessionKind;
  }): { sessionId: string; signal: AbortSignal; controller: AbortController };
  /** Attaches the teardown for a stream session once its socket exists. */
  attachResources(sessionId: string, resources: SessionResources): void;
  get(sessionId: string): ApiSessionInfo | undefined;
  nextSeq(sessionId: string): number;
  cancel(sessionId: string): boolean;
  cancelAllForWorkspace(workspaceId: string): number;
  listForWorkspace(workspaceId: string): ApiSessionInfo[];
  remove(sessionId: string): void;
  dispose(): void;
};

export function createApiSessionRegistry(): ApiSessionRegistry {
  type SessionRecord = {
    workspaceId: string;
    requestId: string;
    kind: ApiSessionKind;
    controller: AbortController;
    seq: number;
    resources?: SessionResources;
  };

  const sessions = new Map<string, SessionRecord>();

  function teardown(sessionId: string, record: SessionRecord): void {
    record.controller.abort();
    try {
      record.resources?.dispose();
    } catch {
      // A failing teardown must not prevent the rest of the registry from draining.
    }
    sessions.delete(sessionId);
  }

  return {
    create(input) {
      const sessionId = randomUUID();
      const controller = new AbortController();
      sessions.set(sessionId, {
        workspaceId: input.workspaceId,
        requestId: input.requestId,
        kind: input.kind,
        controller,
        seq: 0,
      });
      return { sessionId, signal: controller.signal, controller };
    },

    attachResources(sessionId, resources) {
      const record = sessions.get(sessionId);
      if (!record) {
        // The session was already cancelled; release immediately rather than leaking.
        resources.dispose();
        return;
      }
      record.resources = resources;
    },

    get(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) return undefined;
      return {
        sessionId,
        workspaceId: record.workspaceId,
        requestId: record.requestId,
        kind: record.kind,
      };
    },

    nextSeq(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) return 0;
      record.seq += 1;
      return record.seq;
    },

    cancel(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) return false;
      // Request sessions settle through their own transport result, so only the abort fires
      // here; stream sessions additionally need their socket torn down.
      record.controller.abort();
      if (record.kind !== 'request') teardown(sessionId, record);
      return true;
    },

    cancelAllForWorkspace(workspaceId) {
      let count = 0;
      for (const [sessionId, record] of [...sessions]) {
        if (record.workspaceId !== workspaceId) continue;
        teardown(sessionId, record);
        count += 1;
      }
      return count;
    },

    listForWorkspace(workspaceId) {
      const out: ApiSessionInfo[] = [];
      for (const [sessionId, record] of sessions) {
        if (record.workspaceId !== workspaceId) continue;
        out.push({
          sessionId,
          workspaceId,
          requestId: record.requestId,
          kind: record.kind,
        });
      }
      return out;
    },

    remove(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) return;
      try {
        record.resources?.dispose();
      } catch {
        // ignore
      }
      sessions.delete(sessionId);
    },

    dispose() {
      // No session survives shutdown.
      for (const [sessionId, record] of [...sessions]) teardown(sessionId, record);
      sessions.clear();
    },
  };
}
