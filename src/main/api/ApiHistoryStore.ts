import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { z } from 'zod';
import type {
  ApiEntityId,
  ApiHistorySummary,
  ApiResponsePreview,
} from '@shared/contracts/apiWorkbench';
import type { ApiSettings } from '@shared/contracts/settings';
import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import type { ApiPersistence } from './ApiPersistence';
import { createResponseBodyStore, type ResponseBodyStore } from './ResponseBodyStore';

type HistoryIndexEntry = {
  historyId: ApiEntityId;
  workspaceId: ApiEntityId;
  requestId?: ApiEntityId;
  name: string;
  method: string;
  url: string;
  status?: number;
  ok?: boolean;
  totalMs?: number;
  createdAt: string;
  bodyId?: string;
  bodyBytes: number;
};

type HistoryIndexFileV1 = {
  schemaVersion: 1;
  entries: HistoryIndexEntry[];
  bodyBytesUsed: number;
};

type HistoryEntryFileV1 = {
  schemaVersion: 1;
  summary: HistoryIndexEntry;
  response: Omit<ApiResponsePreview, 'bodyText' | 'bodyHexPreview'> & {
    bodyId?: string;
  };
};

const indexSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(z.record(z.unknown())).default([]),
  bodyBytesUsed: z.number().default(0),
});

export type ApiHistoryStore = {
  list(workspaceId: string): ApiHistorySummary[];
  getEntry(historyId: string): Promise<
    | { ok: true; summary: ApiHistorySummary; response: ApiResponsePreview }
    | { ok: false }
  >;
  record(input: {
    workspaceId: string;
    requestId?: string;
    name: string;
    response: ApiResponsePreview;
    body: Buffer;
    settings: ApiSettings;
  }): Promise<ApiHistorySummary>;
};

function toSummary(entry: HistoryIndexEntry): ApiHistorySummary {
  return {
    historyId: entry.historyId,
    workspaceId: entry.workspaceId,
    requestId: entry.requestId,
    name: entry.name,
    method: entry.method,
    url: entry.url,
    status: entry.status,
    ok: entry.ok,
    totalMs: entry.totalMs,
    createdAt: entry.createdAt,
  };
}

export function createApiHistoryStore(persistence: ApiPersistence): ApiHistoryStore {
  const indexStore = persistence.historyIndexStore as AtomicJsonStore<HistoryIndexFileV1>;
  const bodies: ResponseBodyStore = createResponseBodyStore(persistence.historyBodiesDir);

  function readIndex(): HistoryIndexFileV1 {
    const raw = indexStore.read();
    const parsed = indexSchema.safeParse(raw);
    if (!parsed.success) return { schemaVersion: 1, entries: [], bodyBytesUsed: 0 };
    return {
      schemaVersion: 1,
      bodyBytesUsed: parsed.data.bodyBytesUsed,
      entries: parsed.data.entries as unknown as HistoryIndexEntry[],
    };
  }

  function list(workspaceId: string): ApiHistorySummary[] {
    return readIndex()
      .entries.filter((entry) => entry.workspaceId === workspaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toSummary);
  }

  async function getEntry(historyId: string) {
    const index = readIndex();
    const summary = index.entries.find((entry) => entry.historyId === historyId);
    if (!summary) return { ok: false as const };
    const entryPath = `${persistence.historyEntriesDir}/${historyId}.v1.json`;
    try {
      const raw = JSON.parse(await fs.readFile(entryPath, 'utf8')) as HistoryEntryFileV1;
      let bodyText: string | undefined;
      let bodyHexPreview: string | undefined;
      let bodyIsBinary = raw.response.bodyIsBinary;
      if (raw.response.bodyId) {
        const preview = await bodies.readBodyPreview(raw.response.bodyId, 256 * 1024);
        if (preview) {
          const looksBinary = preview.includes(0) || raw.response.bodyIsBinary;
          bodyIsBinary = looksBinary;
          if (looksBinary) {
            bodyHexPreview = preview.subarray(0, 512).toString('hex');
          } else {
            bodyText = preview.toString('utf8');
          }
        }
      }
      return {
        ok: true as const,
        summary: toSummary(summary),
        response: {
          ...raw.response,
          historyId,
          bodyText,
          bodyHexPreview,
          bodyIsBinary,
        },
      };
    } catch {
      return { ok: false as const };
    }
  }

  async function prune(settings: ApiSettings, index: HistoryIndexFileV1): Promise<HistoryIndexFileV1> {
    const cutoff = Date.now() - settings.historyAgeDays * 24 * 60 * 60 * 1000;
    let entries = [...index.entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const removed: HistoryIndexEntry[] = [];
    entries = entries.filter((entry) => {
      const keep =
        Date.parse(entry.createdAt) >= cutoff &&
        entries.indexOf(entry) < settings.historyEntryCap;
      if (!keep) removed.push(entry);
      return keep;
    });

    // Cap by count again after age filter
    if (entries.length > settings.historyEntryCap) {
      removed.push(...entries.slice(settings.historyEntryCap));
      entries = entries.slice(0, settings.historyEntryCap);
    }

    let bodyBytesUsed = entries.reduce((sum, entry) => sum + (entry.bodyBytes ?? 0), 0);
    while (bodyBytesUsed > settings.historyBodyStorageBytes && entries.length > 0) {
      const dropped = entries.pop();
      if (!dropped) break;
      removed.push(dropped);
      bodyBytesUsed -= dropped.bodyBytes ?? 0;
    }

    for (const entry of removed) {
      if (entry.bodyId) await bodies.deleteBody(entry.bodyId);
      try {
        await fs.rm(`${persistence.historyEntriesDir}/${entry.historyId}.v1.json`, { force: true });
      } catch {
        // ignore
      }
    }

    return { schemaVersion: 1, entries, bodyBytesUsed };
  }

  async function record(input: {
    workspaceId: string;
    requestId?: string;
    name: string;
    response: ApiResponsePreview;
    body: Buffer;
    settings: ApiSettings;
  }): Promise<ApiHistorySummary> {
    const historyId = randomUUID();
    const bodyId = randomUUID();
    const meta = await bodies.writeBody(bodyId, input.body, {
      mediaType: input.response.contentType,
      encoding: input.response.encoding,
      maxBytes: input.settings.persistResponseBytes,
    });

    const summary: HistoryIndexEntry = {
      historyId,
      workspaceId: input.workspaceId,
      requestId: input.requestId,
      name: input.name,
      method: input.response.method,
      url: input.response.url,
      status: input.response.status,
      ok: input.response.ok,
      totalMs: input.response.timings.totalMs,
      createdAt: new Date().toISOString(),
      bodyId,
      bodyBytes: meta.byteLength,
    };

    const entryFile: HistoryEntryFileV1 = {
      schemaVersion: 1,
      summary,
      response: {
        sessionId: input.response.sessionId,
        workspaceId: input.response.workspaceId,
        requestId: input.response.requestId,
        historyId,
        ok: input.response.ok,
        status: input.response.status,
        statusText: input.response.statusText,
        url: input.response.url,
        method: input.response.method,
        headers: input.response.headers,
        timings: input.response.timings,
        redirects: input.response.redirects,
        contentType: input.response.contentType,
        encoding: input.response.encoding,
        wireBytes: input.response.wireBytes,
        decodedBytes: input.response.decodedBytes,
        truncated: input.response.truncated || meta.truncated,
        bodyIsBinary: input.response.bodyIsBinary,
        errorCode: input.response.errorCode,
        errorMessage: input.response.errorMessage,
        bodyId,
      },
    };

    await fs.writeFile(
      `${persistence.historyEntriesDir}/${historyId}.v1.json`,
      JSON.stringify(entryFile),
      'utf8'
    );

    await indexStore.update((current) => {
      const parsed = indexSchema.safeParse(current);
      const base: HistoryIndexFileV1 = parsed.success
        ? {
            schemaVersion: 1,
            bodyBytesUsed: parsed.data.bodyBytesUsed,
            entries: parsed.data.entries as unknown as HistoryIndexEntry[],
          }
        : { schemaVersion: 1, entries: [], bodyBytesUsed: 0 };
      return {
        schemaVersion: 1,
        entries: [summary, ...base.entries],
        bodyBytesUsed: base.bodyBytesUsed + meta.byteLength,
      };
    });

    const pruned = await prune(input.settings, readIndex());
    await indexStore.update(() => pruned);
    return toSummary(summary);
  }

  return { list, getEntry, record };
}
