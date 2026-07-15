import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';

export type SnapshotCache = {
  get(projectId: string): RepositorySnapshot | undefined;
  set(projectId: string, snapshot: RepositorySnapshot): void;
  remove(projectId: string): void;
};

export function createSnapshotCache(): SnapshotCache {
  const snapshots = new Map<string, RepositorySnapshot>();

  function get(projectId: string): RepositorySnapshot | undefined {
    return snapshots.get(projectId);
  }

  function set(projectId: string, snapshot: RepositorySnapshot): void {
    snapshots.set(projectId, snapshot);
  }

  function remove(projectId: string): void {
    snapshots.delete(projectId);
  }

  return { get, set, remove };
}
