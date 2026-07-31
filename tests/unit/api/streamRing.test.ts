import { describe, expect, it, vi } from 'vitest';
import { createStreamRing } from '@main/api/StreamRing';
import type { ApiStreamEntry } from '@shared/contracts/apiWorkbench';

function makeRing(overrides?: Partial<Parameters<typeof createStreamRing>[0]>) {
  const batches: Array<{ entries: ApiStreamEntry[]; dropped: number }> = [];
  const ring = createStreamRing({
    capacity: 5,
    maxTextBytes: 16,
    batchSize: 3,
    batchMs: 10,
    emit: (entries, dropped) => batches.push({ entries, dropped }),
    ...overrides,
  });
  return { ring, batches };
}

describe('StreamRing', () => {
  it('assigns a monotonic sequence to every entry', () => {
    const { ring } = makeRing();
    for (let i = 0; i < 3; i += 1) ring.push({ direction: 'in', kind: 'message', text: `${i}` });
    expect(ring.snapshot().entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it('flushes once the batch size is reached', () => {
    const { ring, batches } = makeRing();
    for (let i = 0; i < 3; i += 1) ring.push({ direction: 'in', kind: 'message', text: `${i}` });
    expect(batches).toHaveLength(1);
    expect(batches[0].entries).toHaveLength(3);
  });

  it('flushes a partial batch after the batch interval', async () => {
    vi.useFakeTimers();
    try {
      const { ring, batches } = makeRing();
      ring.push({ direction: 'in', kind: 'message', text: 'one' });
      expect(batches).toHaveLength(0);
      vi.advanceTimersByTime(10);
      expect(batches).toHaveLength(1);
      ring.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the oldest entries past capacity and counts them as dropped', () => {
    const { ring } = makeRing();
    for (let i = 0; i < 8; i += 1) ring.push({ direction: 'in', kind: 'message', text: `${i}` });
    const snapshot = ring.snapshot();
    expect(snapshot.entries).toHaveLength(5);
    expect(snapshot.dropped).toBe(3);
    // The retained window is the newest, and its sequence numbers show the gap.
    expect(snapshot.entries[0].seq).toBe(4);
    expect(snapshot.entries.at(-1)!.seq).toBe(8);
  });

  it('truncates oversized payloads and flags them', () => {
    const { ring } = makeRing();
    ring.push({ direction: 'in', kind: 'message', text: 'x'.repeat(100) });
    const entry = ring.snapshot().entries[0];
    expect(entry.text!.length).toBe(16);
    expect(entry.truncated).toBe(true);
  });

  it('keeps reading while paused and delivers nothing until resumed', () => {
    const { ring, batches } = makeRing();
    ring.setPaused(true);
    for (let i = 0; i < 4; i += 1) ring.push({ direction: 'in', kind: 'message', text: `${i}` });
    // Pausing is display-only: the ring still holds every event.
    expect(batches).toHaveLength(0);
    expect(ring.snapshot().entries).toHaveLength(4);

    ring.setPaused(false);
    expect(batches).toHaveLength(1);
    expect(batches[0].entries).toHaveLength(4);
  });

  it('bounds the pending batch so a long pause cannot grow memory without limit', () => {
    const { ring, batches } = makeRing();
    ring.setPaused(true);
    for (let i = 0; i < 50; i += 1) ring.push({ direction: 'in', kind: 'message', text: `${i}` });
    ring.setPaused(false);
    expect(batches[0].entries.length).toBeLessThanOrEqual(5);
  });

  it('stops emitting after dispose', () => {
    const { ring, batches } = makeRing();
    ring.dispose();
    for (let i = 0; i < 5; i += 1) ring.push({ direction: 'in', kind: 'message', text: `${i}` });
    expect(batches).toHaveLength(0);
    expect(ring.snapshot().entries).toHaveLength(0);
  });
});
