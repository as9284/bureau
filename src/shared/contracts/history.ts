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

export type CherryPickRequest = {
  projectId: string;
  snapshotRevision: string;
  commitOid: string;
};

export type RevertCommitRequest = {
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
