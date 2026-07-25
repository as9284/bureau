import type { FileEntry, FileSystemEvent } from '@shared/contracts/files';

/** Parent directory of a project-relative path (`''` for root entries). */
export function parentFilePath(relativePath: string): string {
  const parts = relativePath.split('/');
  parts.pop();
  return parts.join('/');
}

/**
 * Directories whose listings should be refreshed after a watcher event.
 * Always includes the parent when the root listing is involved (parent === ''),
 * or when that parent was previously cached / expanded.
 */
export function directoriesToReloadAfterEvent(
  event: Pick<FileSystemEvent, 'type' | 'relativePath' | 'isDirectory'>,
  cachedOrExpanded: ReadonlySet<string>
): string[] {
  if (event.type === 'watcher-ready' || event.type === 'watcher-error') return [];
  const parent = parentFilePath(event.relativePath);
  const reloads: string[] = [];
  if (parent === '' || cachedOrExpanded.has(parent)) reloads.push(parent);
  // A directory entry that still has a cached listing (rename/metadata) should refresh too.
  if (
    event.isDirectory &&
    event.type !== 'deleted' &&
    event.relativePath !== '' &&
    cachedOrExpanded.has(event.relativePath)
  ) {
    reloads.push(event.relativePath);
  }
  return reloads;
}

/**
 * Drop cached listings for a deleted directory and its descendants.
 * Parent listings are left intact until an async reload replaces them — blanking
 * the parent made the explorer vanish on every save.
 */
export function pruneDirectoryCacheAfterDelete(
  directoryCache: Record<string, FileEntry[]>,
  deletedPath: string,
  isDirectory: boolean
): Record<string, FileEntry[]> {
  if (!isDirectory || !deletedPath) return directoryCache;
  let changed = false;
  const next: Record<string, FileEntry[]> = { ...directoryCache };
  for (const key of Object.keys(next)) {
    if (key === deletedPath || key.startsWith(`${deletedPath}/`)) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : directoryCache;
}
