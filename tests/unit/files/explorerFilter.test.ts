import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@shared/contracts/files';
import {
  entryMatchesExplorerFilter,
  hasMatchingExplorerDescendant,
  normalizeExplorerFilter,
} from '@renderer/features/files/explorerFilter';

function entry(name: string, relativePath: string, kind: FileEntry['kind']): FileEntry {
  return { name, relativePath, kind, size: 0, modifiedAt: '2026-01-01T00:00:00.000Z', ignored: false };
}

describe('explorerFilter', () => {
  const cache = {
    '': [entry('src', 'src', 'directory'), entry('README.md', 'README.md', 'text')],
    src: [entry('components', 'src/components', 'directory'), entry('app.tsx', 'src/app.tsx', 'text')],
    'src/components': [entry('Explorer.tsx', 'src/components/Explorer.tsx', 'text')],
  };

  it('normalizes a filter before matching file and folder paths', () => {
    const query = normalizeExplorerFilter('  explorer  ');

    expect(query).toBe('explorer');
    expect(entryMatchesExplorerFilter(cache['src/components'][0], query, cache)).toBe(true);
    expect(entryMatchesExplorerFilter(cache[''][1], query, cache)).toBe(false);
  });

  it('retains parent directories that lead to a matching descendant', () => {
    const query = normalizeExplorerFilter('explorer');

    expect(entryMatchesExplorerFilter(cache[''][0], query, cache)).toBe(true);
    expect(hasMatchingExplorerDescendant(cache[''][0], query, cache)).toBe(true);
    expect(hasMatchingExplorerDescendant(cache.src[0], query, cache)).toBe(true);
  });

  it('does not pretend an unloaded directory has a matching descendant', () => {
    const unloaded = entry('packages', 'packages', 'directory');

    expect(entryMatchesExplorerFilter(unloaded, normalizeExplorerFilter('packages'), cache)).toBe(true);
    expect(hasMatchingExplorerDescendant(unloaded, normalizeExplorerFilter('unknown'), cache)).toBe(false);
  });
});
