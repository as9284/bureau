export type BranchKind = 'local' | 'remote';

export type BranchDetail = {
  ref: string;
  shortName: string;
  kind: BranchKind;
  current: boolean;
  headOid: string;
  upstreamRef?: string;
  ahead?: number;
  behind?: number;
  remoteName?: string;
  published: boolean;
};

export type ListBranchDetailsRequest = {
  projectId: string;
};

export type BranchPublishRequest = {
  projectId: string;
  snapshotRevision: string;
  branchName?: string;
  remoteName?: string;
  remoteUrl?: string;
};

export type BranchSetUpstreamRequest = {
  projectId: string;
  snapshotRevision: string;
  upstreamRef: string | null;
};

export type BranchRenameRequest = {
  projectId: string;
  snapshotRevision: string;
  newName: string;
};

export type BranchCheckoutTrackingRequest = {
  projectId: string;
  snapshotRevision: string;
  remoteRef: string;
  localName?: string;
};

export type BranchDeleteRemoteRequest = {
  projectId: string;
  snapshotRevision: string;
  remoteName: string;
  branchName: string;
};

/** Merge another branch into the checked-out one. Conflicts leave the repo mid-merge. */
export type MergeBranchRequest = {
  projectId: string;
  snapshotRevision: string;
  /** Ref merged *into* the current branch (local short name or `origin/main`). */
  branchName: string;
};

/** Replay the checked-out branch onto another. Rewrites the current branch's history. */
export type RebaseBranchRequest = {
  projectId: string;
  snapshotRevision: string;
  /** Ref the current branch is replayed onto (local short name or `origin/main`). */
  ontoRef: string;
};
