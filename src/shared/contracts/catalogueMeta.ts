export type RepoGroup = {
  groupId: string;
  name: string;
  order: number;
};

export type RepoMetadata = {
  pinned?: boolean;
  archived?: boolean;
  groupIds?: string[];
  tags?: string[];
  note?: string;
};

export type SavedHubView = {
  viewId: string;
  name: string;
  builtIn?: boolean;
  filters: {
    attention?: string[];
    pinned?: boolean;
    archived?: boolean;
    groupId?: string;
    tag?: string;
    search?: string;
  };
  sort: 'attention' | 'name' | 'recentlyRefreshed' | 'changedFiles';
};

export type BulkRepoRequest = {
  repoIds: string[];
};

export type BulkOperationResult = {
  results: Array<
    | { projectId: string; ok: true }
    | { projectId: string; ok: false; error: import('./errors').BureauError }
  >;
};

export type AttentionReason =
  | 'interrupted'
  | 'conflicted'
  | 'unavailable'
  | 'dirty'
  | 'ahead'
  | 'behind'
  | 'diverged'
  | 'noUpstream'
  | 'stale';

export type AttentionInboxEntry = {
  projectId: string;
  reasons: AttentionReason[];
};

