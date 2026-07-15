export type WorktreeEntry = {
  path: string;
  headOid: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isCurrent: boolean;
};

export type ListWorktreesRequest = {
  projectId: string;
};

export type AddWorktreeRequest = {
  projectId: string;
  snapshotRevision: string;
  path: string;
  branch?: string;
  newBranch?: string;
};

export type WorktreeLockRequest = {
  projectId: string;
  snapshotRevision: string;
  path: string;
  reason?: string;
};

export type RemoveWorktreeRequest = {
  projectId: string;
  snapshotRevision: string;
  path: string;
};

export type SubmoduleEntry = {
  path: string;
  url?: string;
  expectedOid?: string;
  checkedOutOid?: string;
  initialized: boolean;
  dirty: boolean;
};

export type ListSubmodulesRequest = {
  projectId: string;
};

export type SubmoduleActionRequest = {
  projectId: string;
  snapshotRevision: string;
  path: string;
};

export type BlameLine = {
  oid: string;
  abbreviatedOid: string;
  lineNumber: number;
  authorName: string;
  committedAt: string;
  subject: string;
  content: string;
};

export type BlameRequest = {
  projectId: string;
  path: string;
  commitOid: string;
  offset?: number;
  limit?: number;
};

export type BlameResult = import('./pagination').PageResult<BlameLine>;

export type CompareRefsRequest = {
  projectId: string;
  baseRef: string;
  targetRef: string;
};
