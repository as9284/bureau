import type { RepositorySnapshot, TrackedRepository } from '@shared/contracts/gitSnapshot';
import type { BureauError } from '@shared/contracts/errors';

export type RepoListEntry = {
  catalogue: TrackedRepository;
  snapshot?: RepositorySnapshot;
  error?: BureauError;
};

export function recentRepoIds(
  repoIds: string[],
  repos: Record<string, RepoListEntry>,
  limit = 8
): string[] {
  return [...repoIds]
    .filter((id) => repos[id]?.catalogue.lastOpenedAt)
    .sort((a, b) =>
      (repos[b]!.catalogue.lastOpenedAt ?? '').localeCompare(repos[a]!.catalogue.lastOpenedAt ?? '')
    )
    .slice(0, limit);
}

/** Add a repo to the recent list without reordering entries that are already present. */
export function ensureRecentRepoId(current: string[], projectId: string, limit = 8): string[] {
  if (current.includes(projectId)) {
    return current;
  }
  return [projectId, ...current].slice(0, limit);
}
