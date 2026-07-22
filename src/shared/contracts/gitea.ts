import type { BureauError } from './errors';
import type { RepositorySnapshot } from './gitSnapshot';

/**
 * Gitea is self-hosted, so unlike GitHub there is no fixed host and no CLI that
 * owns the login. Bureau stores one connection (host + personal access token)
 * and talks to the instance's REST API directly.
 */
export type GiteaStatus = {
  configured: boolean;
  authenticated: boolean;
  hostUrl?: string;
  account?: string;
  version?: string;
  /** Why a stored connection is currently unusable (revoked token, host unreachable). */
  error?: string;
};

export type GiteaConnectRequest = {
  hostUrl: string;
  token: string;
};

export type GiteaPublishRequest = {
  projectId: string;
  snapshotRevision: string;
  branchName: string;
  owner?: string;
  repositoryName: string;
  visibility: 'public' | 'private';
  description?: string;
};

export type GiteaPublishResult =
  | {
      ok: true;
      snapshot: RepositorySnapshot;
      repositoryUrl: string;
      created: boolean;
    }
  | { ok: false; error: BureauError };
