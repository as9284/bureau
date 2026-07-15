// Full repository snapshot types (ported from StarGit). Replaces the Phase 1 thin GitSnapshot
// for Overview + Git tab. Hub catalogue types stay in `projects.ts`.

import type { BureauError } from './errors';

export type BranchState =
  | { kind: 'named'; name: string; headOid?: string }
  | { kind: 'detached'; headOid: string }
  | { kind: 'unborn' };

export type UpstreamState =
  | { kind: 'tracking'; ref?: string; ahead: number; behind: number; basis: 'localTrackingRef' }
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | { kind: 'notApplicable' };

export type ChangedFile = {
  path: string;
  originalPath?: string;
  indexCode: string;
  worktreeCode: string;
  kind: 'ordinary' | 'renameOrCopy' | 'unmerged' | 'untracked';
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  unmerged: boolean;
  submodule?: {
    commitChanged: boolean;
    trackedChanges: boolean;
    untrackedChanges: boolean;
  };
};

export type LatestCommit = {
  oid: string;
  abbreviatedOid: string;
  subject: string;
  authorName: string;
  committedAt: string;
};

/** Minimal catalogue entry used by the git workbench (maps from TrackedProject). */
export type TrackedRepository = {
  projectId: string;
  canonicalPath: string;
  displayName: string;
  addedAt: string;
  lastOpenedAt?: string;
  pinned?: boolean;
  archived?: boolean;
  groupIds?: string[];
  tags?: string[];
  note?: string;
};

export type RepositorySnapshot = {
  projectId: string;
  revision: string;
  observedAt: string;
  durationMs: number;
  stale: boolean;
  availability: 'available' | 'unavailable';
  branch: BranchState;
  upstream: UpstreamState;
  dirty: boolean;
  changedFileCount: number;
  changedFiles: ChangedFile[];
  latestCommit?: LatestCommit;
  blockedOperation?: {
    kinds: Array<'unmerged' | 'merge' | 'rebase' | 'cherryPick' | 'revert' | 'bisect'>;
  };
};

export type BlockedOperationKind = NonNullable<
  RepositorySnapshot['blockedOperation']
>['kinds'][number];

/** Compact overview card shape derived from a full snapshot (or non-repo). */
export type GitSnapshot = {
  isRepo: boolean;
  branch: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  changes: number;
};

export type GitSnapshotRequest = { projectId: string };

export function compactGitSnapshot(snapshot: RepositorySnapshot | null | undefined): GitSnapshot {
  if (!snapshot || snapshot.availability !== 'available') {
    return { isRepo: false, branch: null, detached: false, ahead: 0, behind: 0, changes: 0 };
  }
  const detached = snapshot.branch.kind === 'detached';
  const branch = snapshot.branch.kind === 'named' ? snapshot.branch.name : null;
  const ahead = snapshot.upstream.kind === 'tracking' ? snapshot.upstream.ahead : 0;
  const behind = snapshot.upstream.kind === 'tracking' ? snapshot.upstream.behind : 0;
  return {
    isRepo: true,
    branch,
    detached,
    ahead,
    behind,
    changes: snapshot.changedFileCount,
  };
}

export type RefreshAllResult = {
  observedAt: string;
  results: Array<
    | { projectId: string; ok: true; snapshot: RepositorySnapshot }
    | { projectId: string; ok: false; error: BureauError }
  >;
};
