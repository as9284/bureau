import type { PageRequest, PageResult } from './pagination';
import type { RecentCommit } from './operations';

export type HistoryFilters = {
  text?: string;
  author?: string;
  path?: string;
  since?: string;
  until?: string;
  ref?: string;
  oid?: string;
};

export type GraphConnector = {
  fromLane: number;
  toLane: number;
  parentOid: string;
};

export type HistoryCommit = RecentCommit & {
  body?: string;
  parentOids: string[];
  decorations: HistoryDecoration[];
  graphLane?: number;
  graphLanes?: number[];
  graphConnectors?: GraphConnector[];
};

export type HistoryDecoration = {
  kind: 'localBranch' | 'remoteBranch' | 'tag' | 'head';
  name: string;
};

export type ListHistoryRequest = PageRequest & {
  projectId: string;
  filters?: HistoryFilters;
};

export type ListHistoryResult = PageResult<HistoryCommit>;

export type CompareCommitsRequest = {
  projectId: string;
  baseOid: string;
  targetOid: string;
};

export type CompareFileChange = {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  originalPath?: string;
};

export type CompareCommitsResult =
  | { ok: true; files: CompareFileChange[] }
  | { ok: false; error: import('./errors').BureauError };

export type TagDetail = {
  name: string;
  oid: string;
  targetOid: string;
  kind: 'lightweight' | 'annotated';
  taggerName?: string;
  taggedAt?: string;
  message?: string;
};

export type ListTagsRequest = PageRequest & {
  projectId: string;
};

export type ListTagsResult = PageResult<TagDetail>;

export type CreateTagRequest = {
  projectId: string;
  snapshotRevision: string;
  name: string;
  targetOid: string;
  message?: string;
  annotated?: boolean;
};

export type DeleteTagRequest = {
  projectId: string;
  snapshotRevision: string;
  name: string;
};

export type PushTagRequest = {
  projectId: string;
  snapshotRevision: string;
  name: string;
};

export type DeleteRemoteTagRequest = {
  projectId: string;
  snapshotRevision: string;
  remoteName: string;
  name: string;
};

/**
 * 1-based index into a merge commit's `parentOids`, passed to git as `-m <n>`.
 *
 * Git *requires* it for a merge commit (there is no way to infer which side is the
 * mainline) and *rejects* it for an ordinary one, so it is set only when the target
 * has more than one parent — from the picker, never guessed. Parent 1 is the branch
 * the merge was made on; parent 2 is the branch that was merged in.
 */
export type MergeMainline = number;

export type CherryPickRequest = {
  projectId: string;
  snapshotRevision: string;
  commitOid: string;
  mainline?: MergeMainline;
};

export type RevertCommitRequest = {
  projectId: string;
  snapshotRevision: string;
  commitOid: string;
  mainline?: MergeMainline;
};

/**
 * Check out a commit directly, leaving HEAD detached (on no branch). Distinct from
 * `BranchSwitchRequest`, which moves HEAD to a branch ref.
 */
export type CheckoutCommitRequest = {
  projectId: string;
  snapshotRevision: string;
  commitOid: string;
};

export type CreateBranchFromCommitRequest = {
  projectId: string;
  snapshotRevision: string;
  branchName: string;
  commitOid: string;
};

export type CreateTagFromCommitRequest = CreateTagRequest;

/**
 * `soft` moves HEAD only; `mixed` also resets the index; `hard` also overwrites the
 * working tree — the one mode that destroys uncommitted work the reflog cannot restore.
 */
export type ResetMode = 'soft' | 'mixed' | 'hard';

export type ResetToCommitRequest = {
  projectId: string;
  snapshotRevision: string;
  commitOid: string;
  mode: ResetMode;
};

export type ReflogEntry = {
  /**
   * `HEAD@{n}`, synthesized from the entry's position in the walk. Git emits either
   * the index *or* the timestamp in `%gD` (never both), and we ask for the timestamp.
   */
  selector: string;
  oid: string;
  abbreviatedOid: string;
  /** When HEAD moved (ISO 8601) — not the commit's author date. */
  movedAt: string;
  /** Leading verb of the reflog subject: `commit`, `reset`, `rebase (finish)`, … */
  action: string;
  /** The reflog subject after the action verb; may be empty. */
  subject: string;
};

/** Reflog is HEAD-only: it exists here as the undo trail for reset/rebase/merge. */
export type ListReflogRequest = PageRequest & {
  projectId: string;
};

export type ListReflogResult = PageResult<ReflogEntry>;
