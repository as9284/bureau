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
