// Git mutation / query request & result types (ported from StarGit).
// Error types live in `errors.ts` — do not redeclare BureauError here.

import type { BureauError } from './errors';
import type { RepositorySnapshot } from './gitSnapshot';

export type FileMutationRequest = {
  projectId: string;
  snapshotRevision: string;
  path: string;
};

export type RepoMutationRequest = {
  projectId: string;
  snapshotRevision: string;
};

export type BranchSwitchRequest = RepoMutationRequest & {
  branchName: string;
};

export type BranchCreateRequest = RepoMutationRequest & {
  branchName: string;
  startPoint?: string;
};

export type BranchDeleteRequest = RepoMutationRequest & {
  branchName: string;
};

export type StashPushRequest = RepoMutationRequest & {
  message?: string;
  includeUntracked?: boolean;
};

export type StashIndexRequest = RepoMutationRequest & {
  index: number;
};

export type DiffArea = 'staged' | 'unstaged' | 'commit';

export type DiffRequest = {
  projectId: string;
  path: string;
  area: DiffArea;
  /** Required when area is 'commit'. */
  commitOid?: string;
};

export type DiffResult = { ok: true; diff: string } | { ok: false; error: BureauError };

export type CommitFileChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'unknown';

export type CommitFileChange = {
  path: string;
  originalPath?: string;
  kind: CommitFileChangeKind;
  statusCode: string;
};

export type ListCommitFilesRequest = {
  projectId: string;
  commitOid: string;
};

export type ListCommitFilesResult =
  | { ok: true; files: CommitFileChange[] }
  | { ok: false; error: BureauError };

export type StashEntry = {
  index: number;
  message: string;
  branch?: string;
};

export type RecentCommit = {
  oid: string;
  abbreviatedOid: string;
  subject: string;
  authorName: string;
  committedAt: string;
};

export type CommitRequest = {
  projectId: string;
  snapshotRevision: string;
  message: string;
  amend?: boolean;
  signOff?: boolean;
  signing?: 'config' | 'off';
};

export type HunkMutationRequest = {
  projectId: string;
  snapshotRevision: string;
  path: string;
  area: 'staged' | 'unstaged';
  patch: string;
  action: 'stage' | 'unstage' | 'discard';
};

export type MutationResult =
  | { ok: true; snapshot: RepositorySnapshot }
  | { ok: false; error: BureauError };
