import type { FileEntry } from '@shared/contracts/files';

/** Parent folder for a new entry: selected folder, else parent of selected file, else project root. */
export function resolveCreateParent(
  selectedPath: string | null,
  directoryCache: Record<string, FileEntry[]>,
  expandedPaths: string[]
): string {
  if (!selectedPath) return '';
  for (const entries of Object.values(directoryCache)) {
    const hit = entries.find((entry) => entry.relativePath === selectedPath);
    if (hit) return hit.kind === 'directory' ? selectedPath : parentPath(selectedPath);
  }
  if (expandedPaths.includes(selectedPath)) return selectedPath;
  return parentPath(selectedPath);
}

export function isValidEntryName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || /[<>:"/\\|?*\0]/.test(trimmed) || /[ .]$/.test(trimmed)) return false;
  return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(trimmed);
}

function parentPath(relativePath: string): string {
  const parts = relativePath.split('/');
  parts.pop();
  return parts.join('/');
}
