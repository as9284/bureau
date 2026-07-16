/**
 * Remote management. Remotes are per-repository configuration, so these live with the
 * other repo-scoped contracts rather than in `settings` (which is app-wide).
 */

export type RemoteEntry = {
  name: string;
  fetchUrl: string;
  /** Git allows a separate push URL (`remote.<name>.pushurl`); equals fetchUrl when unset. */
  pushUrl: string;
};

export type ListRemotesRequest = {
  projectId: string;
};

export type AddRemoteRequest = {
  projectId: string;
  snapshotRevision: string;
  name: string;
  url: string;
};

export type RenameRemoteRequest = {
  projectId: string;
  snapshotRevision: string;
  name: string;
  newName: string;
};

export type RemoveRemoteRequest = {
  projectId: string;
  snapshotRevision: string;
  name: string;
};

/** Rewrites `remote.<name>.url`. Push URLs, if separately configured, are left alone. */
export type SetRemoteUrlRequest = {
  projectId: string;
  snapshotRevision: string;
  name: string;
  url: string;
};
