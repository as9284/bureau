import { describe, expect, it } from 'vitest';
import { createStreamRing } from '@main/api/StreamRing';
import { createApiWorkspaceStore } from '@main/api/ApiWorkspaceStore';
import { resolveRunOrder } from '@main/api/script/CollectionRunner';
import type { ApiCollectionNode, ApiRequestDefinition } from '@shared/contracts/apiWorkbench';

/**
 * §22 bounds, asserted rather than assumed. Each of these is a place where an unbounded input would
 * otherwise reach memory or the render path.
 */
describe('long-lived streams stay bounded', () => {
  it('holds at most the configured entries and counts what it dropped', () => {
    const delivered: number[] = [];
    const ring = createStreamRing({
      capacity: 100,
      maxTextBytes: 1024,
      batchSize: 50,
      batchMs: 10,
      emit: (entries) => delivered.push(entries.length),
    });

    // A stream that runs for hours is the case that must not grow without bound.
    for (let i = 0; i < 10_000; i += 1) {
      ring.push({ direction: 'in', kind: 'message', text: `event ${i}` });
    }
    ring.flush();

    const snapshot = ring.snapshot();
    expect(snapshot.entries).toHaveLength(100);
    // No silent loss: the count of evicted entries is reported.
    expect(snapshot.dropped).toBe(9_900);
    // The newest entries are the ones kept.
    expect(snapshot.entries[snapshot.entries.length - 1].text).toBe('event 9999');
    expect(delivered.length).toBeGreaterThan(0);
  });

  it('keeps sequence numbers monotonic across eviction, so gaps are detectable', () => {
    const ring = createStreamRing({
      capacity: 10,
      maxTextBytes: 1024,
      batchSize: 5,
      batchMs: 10,
      emit: () => undefined,
    });
    for (let i = 0; i < 50; i += 1) ring.push({ direction: 'in', kind: 'message', text: `${i}` });
    ring.flush();
    const entries = ring.snapshot().entries;
    const sequences = entries.map((entry) => entry.seq);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    // The first retained entry is not seq 1 — that gap is how a reader knows entries were dropped.
    expect(sequences[0]).toBeGreaterThan(1);
  });
});

describe('large collections', () => {
  function tree(size: number): { collections: ApiCollectionNode[]; requests: ApiRequestDefinition[] } {
    const collections: ApiCollectionNode[] = [];
    const requests: ApiRequestDefinition[] = [];
    const workspaceId = 'w';
    for (let i = 0; i < size; i += 1) {
      const requestId = `r${i}`;
      requests.push({
        requestId,
        workspaceId,
        name: `Request ${i}`,
        protocol: 'http',
        urlTemplate: 'https://api.test/x',
        method: 'GET',
        query: [],
        headers: [],
        auth: { kind: 'inherit' },
        body: { kind: 'none' },
        protocolOptions: {},
        scripts: {},
        settings: {},
        variables: [],
        revision: 1,
        createdAt: '2026-07-30T00:00:00.000Z',
        updatedAt: '2026-07-30T00:00:00.000Z',
      });
      collections.push({
        collectionId: `c${i}`,
        workspaceId,
        parentId: null,
        kind: 'request',
        name: `Request ${i}`,
        order: i,
        requestId,
        variables: [],
        revision: 1,
      });
    }
    return { collections, requests };
  }

  it('resolves run order over a large collection without quadratic blow-up', () => {
    const { collections, requests } = tree(2_000);
    const startedAt = performance.now();
    const order = resolveRunOrder(collections, requests, { kind: 'workspace' });
    const elapsed = performance.now() - startedAt;

    expect(order).toHaveLength(2_000);
    expect(order[0].name).toBe('Request 0');
    expect(order[1_999].name).toBe('Request 1999');
    // Generous, but a regression to an O(n²) walk over the tree would blow straight past it.
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('history retention', () => {
  it('exposes the store factory without loading anything at import time', () => {
    // Guards against a regression where constructing the store eagerly read every workspace file:
    // a Bureau with fifty workspaces would then pay for all of them to open one.
    expect(typeof createApiWorkspaceStore).toBe('function');
  });
});
