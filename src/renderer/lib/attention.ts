import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import type { BureauError, BureauErrorCode } from '@shared/contracts/errors';

export type AttentionLevel =
  | 'blocked'
  | 'unavailable'
  | 'failedNoSnapshot'
  | 'diverged'
  | 'behind'
  | 'stale'
  | 'changed'
  | 'ahead'
  | 'clean';

const ATTENTION_RANK: Record<AttentionLevel, number> = {
  blocked: 0,
  unavailable: 1,
  failedNoSnapshot: 2,
  diverged: 3,
  behind: 4,
  stale: 5,
  changed: 6,
  ahead: 7,
  clean: 8,
};

export function getAttentionLevel(params: {
  snapshot?: RepositorySnapshot;
  error?: BureauError;
}): AttentionLevel {
  const { snapshot, error } = params;

  if (snapshot) {
    if (isBlocked(snapshot)) return 'blocked';
    if (snapshot.availability === 'unavailable') return 'unavailable';
    if (snapshot.stale) return 'stale';
    if (isDiverged(snapshot.upstream)) return 'diverged';
    if (isBehind(snapshot.upstream)) return 'behind';
    if (snapshot.dirty) return 'changed';
    if (isAhead(snapshot.upstream)) return 'ahead';
    return 'clean';
  }

  if (error && isUnavailableError(error.code)) return 'unavailable';
  return 'failedNoSnapshot';
}

export function compareAttention(
  a: { level: AttentionLevel; name: string },
  b: { level: AttentionLevel; name: string }
): number {
  const rankA = ATTENTION_RANK[a.level];
  const rankB = ATTENTION_RANK[b.level];
  if (rankA !== rankB) return rankA - rankB;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function isBlocked(snapshot: RepositorySnapshot): boolean {
  if (snapshot.blockedOperation && snapshot.blockedOperation.kinds.length > 0) return true;
  return snapshot.changedFiles.some((f) => f.unmerged);
}

function isDiverged(upstream: RepositorySnapshot['upstream']): boolean {
  return upstream.kind === 'tracking' && upstream.ahead > 0 && upstream.behind > 0;
}

function isBehind(upstream: RepositorySnapshot['upstream']): boolean {
  return upstream.kind === 'tracking' && upstream.behind > 0;
}

function isAhead(upstream: RepositorySnapshot['upstream']): boolean {
  return upstream.kind === 'tracking' && upstream.ahead > 0;
}

function isUnavailableError(code: BureauErrorCode): boolean {
  return (
    code === 'PROJECT_NOT_FOUND' ||
    code === 'NOT_A_WORKTREE' ||
    code === 'BARE_REPOSITORY_UNSUPPORTED'
  );
}

export function formatAttentionLabel(params: {
  level: AttentionLevel;
  snapshot?: RepositorySnapshot;
}): string {
  const { level, snapshot } = params;

  switch (level) {
    case 'clean':
      return 'Clean';
    case 'changed': {
      const count = snapshot?.changedFileCount ?? 0;
      return count === 1 ? '1 change' : `${count} changes`;
    }
    case 'ahead': {
      const n = snapshot?.upstream.kind === 'tracking' ? snapshot.upstream.ahead : 0;
      return n === 1 ? '1 ahead' : `${n} ahead`;
    }
    case 'behind': {
      const n = snapshot?.upstream.kind === 'tracking' ? snapshot.upstream.behind : 0;
      return n === 1 ? '1 behind' : `${n} behind`;
    }
    case 'diverged':
      return 'Diverged';
    case 'stale':
      return 'Stale';
    case 'blocked':
      return 'Blocked';
    case 'unavailable':
      return 'Unavailable';
    case 'failedNoSnapshot':
      return 'Failed to load';
    default:
      return 'Unknown';
  }
}

export function formatSyncLabel(snapshot?: RepositorySnapshot): string | null {
  if (!snapshot || snapshot.upstream.kind !== 'tracking') return null;
  const { ahead, behind } = snapshot.upstream;
  if (ahead === 0 && behind === 0) return 'Up to date';
  const parts: string[] = [];
  if (ahead > 0) parts.push(`${ahead} ahead`);
  if (behind > 0) parts.push(`${behind} behind`);
  return parts.join(', ');
}
