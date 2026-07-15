import type { FileEntry } from '@shared/contracts/files';

type DirectoryCache = Readonly<Record<string, readonly FileEntry[]>>;

export function normalizeExplorerFilter(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/**
 * Filters the loaded tree while retaining every directory needed to reach a
 * matching descendant. Directories are lazy-loaded, so uncached descendants
 * are intentionally not inferred here.
 */
export function entryMatchesExplorerFilter(
  entry: FileEntry,
  normalizedQuery: string,
  directoryCache: DirectoryCache
): boolean {
  if (!normalizedQuery) return true;
  if (`${entry.name}\n${entry.relativePath}`.toLocaleLowerCase().includes(normalizedQuery)) return true;
  if (entry.kind !== 'directory') return false;
  return (directoryCache[entry.relativePath] ?? []).some((child) =>
    entryMatchesExplorerFilter(child, normalizedQuery, directoryCache)
  );
}

export function hasMatchingExplorerDescendant(
  entry: FileEntry,
  normalizedQuery: string,
  directoryCache: DirectoryCache
): boolean {
  if (!normalizedQuery || entry.kind !== 'directory') return false;
  return (directoryCache[entry.relativePath] ?? []).some((child) =>
    entryMatchesExplorerFilter(child, normalizedQuery, directoryCache)
  );
}
