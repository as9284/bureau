import type { BlockedOperationKind } from '@shared/contracts/gitSnapshot';

export type ConflictStage = 'base' | 'ours' | 'theirs' | 'working';

export type ConflictedFile = {
  path: string;
  stages: ConflictStage[];
  binary: boolean;
  resolved: boolean;
};

export type RecoveryOperationKind = Exclude<BlockedOperationKind, 'unmerged'>;

export type OperationStateDetails = {
  activeKind?: RecoveryOperationKind;
  summary: string;
  canContinue: boolean;
  canSkip: boolean;
  canAbort: boolean;
  currentStep?: number;
  totalSteps?: number;
  conflictedFiles: ConflictedFile[];
  instructions?: string;
};

export type GetOperationStateRequest = {
  projectId: string;
};

export type ConflictVersionRequest = {
  projectId: string;
  path: string;
  stage: 'base' | 'ours' | 'theirs' | 'working';
};

export type ConflictVersionResult =
  | { ok: true; content: string; binary: boolean }
  | { ok: false; error: import('./errors').BureauError };

export type ConflictResolveRequest = {
  projectId: string;
  snapshotRevision: string;
  path: string;
  resolution: 'ours' | 'theirs' | 'markResolved';
};

export type RecoveryActionRequest = {
  projectId: string;
  snapshotRevision: string;
};

export type BisectState = {
  active: boolean;
  summary: string;
};

export type GetBisectStateRequest = {
  projectId: string;
};
