import type { BureauError } from './errors';

export type OperationKind =
  | 'refresh'
  | 'refreshAll'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'clone'
  | 'init'
  | 'scan'
  | 'stage'
  | 'unstage'
  | 'discard'
  | 'commit'
  | 'amend'
  | 'switchBranch'
  | 'createBranch'
  | 'deleteBranch'
  | 'stash'
  | 'mergeContinue'
  | 'mergeAbort'
  | 'rebaseContinue'
  | 'rebaseSkip'
  | 'rebaseAbort'
  | 'cherryPickContinue'
  | 'cherryPickSkip'
  | 'cherryPickAbort'
  | 'revertContinue'
  | 'revertSkip'
  | 'revertAbort'
  | 'bisectReset'
  | 'conflictResolve'
  | 'hunkStage'
  | 'hunkUnstage'
  | 'hunkDiscard'
  | 'revert'
  | 'cherryPick'
  | 'tag'
  | 'bulkFetch'
  | 'bulkRefresh'
  | 'submoduleUpdate'
  | 'worktree'
  | 'other';

export type OperationState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type OperationProgress = {
  phase?: string;
  percent?: number;
  message?: string;
};

export type OperationOutputEntry = {
  at: string;
  stream: 'stdout' | 'stderr' | 'info';
  text: string;
};

export type OperationRecord = {
  id: string;
  projectId?: string;
  kind: OperationKind;
  state: OperationState;
  summary: string;
  startedAt: string;
  endedAt?: string;
  cancellable: boolean;
  progress?: OperationProgress;
  error?: BureauError;
  output: OperationOutputEntry[];
};

export type OperationListResult = {
  operations: OperationRecord[];
};

export type OperationCancelRequest = {
  operationId: string;
};

export type OperationCancelResult = { ok: true } | { ok: false; error: BureauError };
