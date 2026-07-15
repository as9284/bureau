import { describe, expect, it } from 'vitest';
import { formatAttentionLabel, formatSyncLabel, getAttentionLevel } from '@renderer/lib/attention';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';

function makeSnapshot(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    projectId: 'repo-1',
    revision: 'rev-1',
    observedAt: new Date().toISOString(),
    durationMs: 10,
    availability: 'available',
    stale: false,
    dirty: false,
    changedFileCount: 0,
    changedFiles: [],
    branch: { kind: 'named', name: 'main', headOid: 'abc1234' },
    upstream: { kind: 'tracking', ahead: 0, behind: 0, basis: 'localTrackingRef' },
    ...overrides,
  };
}

describe('formatAttentionLabel', () => {
  it('returns human-readable clean status', () => {
    const snap = makeSnapshot();
    expect(formatAttentionLabel({ level: 'clean', snapshot: snap })).toBe('Clean');
  });

  it('returns change count', () => {
    const snap = makeSnapshot({ dirty: true, changedFileCount: 4 });
    expect(formatAttentionLabel({ level: 'changed', snapshot: snap })).toBe('4 changes');
  });

  it('returns singular change', () => {
    const snap = makeSnapshot({ dirty: true, changedFileCount: 1 });
    expect(formatAttentionLabel({ level: 'changed', snapshot: snap })).toBe('1 change');
  });
});

describe('formatSyncLabel', () => {
  it('returns null without tracking upstream', () => {
    expect(formatSyncLabel(makeSnapshot({ upstream: { kind: 'none' } }))).toBeNull();
  });

  it('describes ahead and behind', () => {
    const snap = makeSnapshot({
      upstream: { kind: 'tracking', ahead: 2, behind: 1, basis: 'localTrackingRef' },
    });
    expect(formatSyncLabel(snap)).toBe('2 ahead, 1 behind');
  });
});

describe('getAttentionLevel', () => {
  it('detects diverged state', () => {
    const snap = makeSnapshot({
      upstream: { kind: 'tracking', ahead: 1, behind: 1, basis: 'localTrackingRef' },
    });
    expect(getAttentionLevel({ snapshot: snap })).toBe('diverged');
  });
});
