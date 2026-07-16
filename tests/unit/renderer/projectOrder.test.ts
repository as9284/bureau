import { describe, expect, it } from 'vitest';
import {
  groupProjects,
  matchesProjectQuery,
  movePinned,
  reorderByDrag,
} from '@renderer/lib/projectOrder';
import type { TrackedProject } from '@shared/contracts/projects';

function project(overrides: Partial<TrackedProject> & { projectId: string; name: string }): TrackedProject {
  return {
    path: `C:\\code\\${overrides.name}`,
    canonicalPath: `c:\\code\\${overrides.name}`,
    stack: [],
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const alpha = project({ projectId: 'a', name: 'alpha', lastOpenedAt: '2026-07-10T00:00:00.000Z' });
const bravo = project({ projectId: 'b', name: 'bravo', lastOpenedAt: '2026-07-15T00:00:00.000Z' });
const charlie = project({ projectId: 'c', name: 'charlie' }); // never opened
const delta = project({ projectId: 'd', name: 'delta', pinned: true, pinnedRank: 1 });
const echo = project({ projectId: 'e', name: 'echo', pinned: true, pinnedRank: 0 });

describe('groupProjects', () => {
  it('sorts the recent group by most-recently-opened, never-opened last', () => {
    const { pinned, recent } = groupProjects([alpha, bravo, charlie]);
    expect(pinned).toEqual([]);
    expect(recent.map((p) => p.projectId)).toEqual(['b', 'a', 'c']);
  });

  it('sorts the pinned group by manual rank and keeps them out of recent', () => {
    const { pinned, recent } = groupProjects([alpha, delta, echo, bravo]);
    expect(pinned.map((p) => p.projectId)).toEqual(['e', 'd']); // rank 0 before rank 1
    expect(recent.map((p) => p.projectId)).toEqual(['b', 'a']);
  });

  it('filters by name or path, case-insensitively, across both groups', () => {
    const { pinned, recent } = groupProjects([alpha, bravo, echo], 'A');
    // "alpha", "bravo", and path "...\\echo" contain "a"? -> alpha, bravo match on name/path; echo path has no 'a'
    expect(pinned.map((p) => p.projectId)).toEqual([]);
    expect(recent.map((p) => p.projectId)).toEqual(['b', 'a']);
  });

  it('treats a blank query as match-all', () => {
    expect(matchesProjectQuery(alpha, '   ')).toBe(true);
  });
});

describe('movePinned', () => {
  it('moves an id up and down within bounds', () => {
    const ids = ['e', 'd', 'x'];
    expect(movePinned(ids, 'd', -1)).toEqual(['d', 'e', 'x']);
    expect(movePinned(ids, 'd', 1)).toEqual(['e', 'x', 'd']);
  });

  it('clamps at the edges and ignores unknown ids', () => {
    const ids = ['e', 'd'];
    expect(movePinned(ids, 'e', -1)).toEqual(['e', 'd']);
    expect(movePinned(ids, 'd', 1)).toEqual(['e', 'd']);
    expect(movePinned(ids, 'zzz', 1)).toEqual(['e', 'd']);
  });
});

describe('reorderByDrag', () => {
  it('drops the dragged id at the target position', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(reorderByDrag(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderByDrag(ids, 'd', 'a')).toEqual(['d', 'a', 'b', 'c']);
  });

  it('is a no-op when source equals target or ids are missing', () => {
    const ids = ['a', 'b'];
    expect(reorderByDrag(ids, 'a', 'a')).toEqual(['a', 'b']);
    expect(reorderByDrag(ids, 'a', 'z')).toEqual(['a', 'b']);
  });
});
