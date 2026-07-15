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
