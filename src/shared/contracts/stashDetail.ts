export type HunkAction = 'stage' | 'unstage' | 'discard';

export type HunkMutationRequest = {
  projectId: string;
  snapshotRevision: string;
  path: string;
  area: 'staged' | 'unstaged';
  patch: string;
  action: HunkAction;
};

export type StashFileEntry = {
  path: string;
  status: string;
};

export type ListStashFilesRequest = {
  projectId: string;
  index: number;
};

export type StashDiffRequest = {
  projectId: string;
  index: number;
  path: string;
};

export type StashApplyRequest = {
  projectId: string;
  snapshotRevision: string;
  index: number;
};

export type StashBranchRequest = {
  projectId: string;
  snapshotRevision: string;
  index: number;
  branchName: string;
};

export type StashRestoreFilesRequest = {
  projectId: string;
  snapshotRevision: string;
  index: number;
  paths: string[];
};
