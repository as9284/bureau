import type { BureauError } from './errors';
import type { RepositorySnapshot } from './gitSnapshot';

export type GitHubCliStatus = {
  available: boolean;
  authenticated: boolean;
  account?: string;
  version?: string;
};

export type GitHubPublishRequest = {
  projectId: string;
  snapshotRevision: string;
  branchName: string;
  owner?: string;
  repositoryName: string;
  visibility: 'public' | 'private';
  description?: string;
};

export type GitHubPublishResult =
  | {
      ok: true;
      snapshot: RepositorySnapshot;
      repositoryUrl: string;
      created: boolean;
    }
  | { ok: false; error: BureauError };

/** Rollup of check runs + legacy commit statuses for one commit SHA. */
export type CheckRollupState = 'success' | 'failure' | 'pending' | 'error' | 'none';

export type CommitCheckItem = {
  name: string;
  /** Uppercase GraphQL/REST status token (e.g. COMPLETED, IN_PROGRESS, SUCCESS). */
  state: string;
  conclusion?: string | null;
  detailsUrl?: string;
};

export type CommitCheckSummary = {
  oid: string;
  state: CheckRollupState;
  totalCount: number;
  checks: CommitCheckItem[];
  observedAt: string;
};

/**
 * Soft availability — CI status is forge-dependent, so "not GitHub" / "not signed in"
 * are expected outcomes, not errors.
 */
export type GitHubChecksAvailability =
  | 'ready'
  | 'not_github'
  | 'unauthenticated'
  | 'unavailable';

export type GitHubCommitChecksRequest = {
  projectId: string;
  /** Full or abbreviated commit OIDs (hex). Cap enforced by Zod. */
  oids: string[];
};

export type GitHubCommitChecksResult =
  | {
      ok: true;
      availability: GitHubChecksAvailability;
      /** `owner/repo` when resolved. */
      repository?: string;
      summaries: CommitCheckSummary[];
    }
  | { ok: false; error: BureauError };
