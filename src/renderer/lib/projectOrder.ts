import type { TrackedProject } from '@shared/contracts/projects';

export type GroupedProjects = {
  pinned: TrackedProject[];
  recent: TrackedProject[];
};

/** Case-insensitive match against a project's display name and path. */
export function matchesProjectQuery(project: TrackedProject, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    project.name.toLowerCase().includes(q) || project.path.toLowerCase().includes(q)
  );
}

function byName(a: TrackedProject, b: TrackedProject): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** Pinned group: manual order (pinnedRank asc), then name as a stable tiebreak. */
function byPinnedRank(a: TrackedProject, b: TrackedProject): number {
  const ra = a.pinnedRank ?? Number.MAX_SAFE_INTEGER;
  const rb = b.pinnedRank ?? Number.MAX_SAFE_INTEGER;
  return ra !== rb ? ra - rb : byName(a, b);
}

/** Recent group: most-recently-opened first; never-opened fall to the bottom by add time. */
function byRecency(a: TrackedProject, b: TrackedProject): number {
  const ta = a.lastOpenedAt ? Date.parse(a.lastOpenedAt) : 0;
  const tb = b.lastOpenedAt ? Date.parse(b.lastOpenedAt) : 0;
  if (ta !== tb) return tb - ta;
  const aa = a.addedAt ? Date.parse(a.addedAt) : 0;
  const ab = b.addedAt ? Date.parse(b.addedAt) : 0;
  if (aa !== ab) return ab - aa;
  return byName(a, b);
}

/**
 * Splits the tracked projects into a manually-ordered "Pinned" group and a
 * recency-ordered "Recent" group, optionally filtered by a query. Pure and
 * order-stable so the rail and the hub always agree.
 */
export function groupProjects(projects: TrackedProject[], query = ''): GroupedProjects {
  const filtered = projects.filter((p) => matchesProjectQuery(p, query));
  return {
    pinned: filtered.filter((p) => p.pinned).sort(byPinnedRank),
    recent: filtered.filter((p) => !p.pinned).sort(byRecency),
  };
}

/** Move an id by `delta` positions within an ordered id list, clamped to bounds. */
export function movePinned(ids: string[], projectId: string, delta: number): string[] {
  const from = ids.indexOf(projectId);
  if (from < 0) return ids;
  const to = from + delta;
  if (to < 0 || to >= ids.length) return ids;
  const next = ids.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Move a dragged id to sit at the position currently held by `overId`. */
export function reorderByDrag<T extends string>(ids: T[], dragId: T, overId: T): T[] {
  if (dragId === overId) return ids;
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(overId);
  if (from < 0 || to < 0) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(to, 0, dragId);
  return next;
}
