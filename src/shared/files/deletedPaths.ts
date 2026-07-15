/** Paths open in the Files workspace that are removed when `deletedPath` is trashed. */
export function pathsAffectedByDelete(openPaths: readonly string[], deletedPath: string): string[] {
  const prefix = `${deletedPath}/`;
  return openPaths.filter((path) => path === deletedPath || path.startsWith(prefix));
}

/** Whether a path is the deleted entry or lives under a deleted directory. */
export function isPathDeleted(path: string, deletedPath: string): boolean {
  return path === deletedPath || path.startsWith(`${deletedPath}/`);
}
