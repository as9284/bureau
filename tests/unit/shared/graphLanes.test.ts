import { describe, it, expect } from 'vitest';
import { assignGraphLanes } from '../../../src/shared/git/graphLanes';

describe('graphLanes', () => {
  it('assigns stable lanes for linear history', () => {
    const result = assignGraphLanes([
      { oid: 'c3', parentOids: ['c2'] },
      { oid: 'c2', parentOids: ['c1'] },
      { oid: 'c1', parentOids: [] },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]?.lane).toBeGreaterThanOrEqual(0);
  });

  it('produces deterministic lanes for merge commit', () => {
    const input = [
      { oid: 'merge', parentOids: ['main', 'feature'] },
      { oid: 'feature', parentOids: ['base'] },
      { oid: 'main', parentOids: ['base'] },
      { oid: 'base', parentOids: [] },
    ];
    const a = assignGraphLanes(input);
    const b = assignGraphLanes(input);
    expect(a.map((r) => r.lane)).toEqual(b.map((r) => r.lane));
  });
});
