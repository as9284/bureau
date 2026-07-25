import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@shared/contracts/files';
import {
  directoriesToReloadAfterEvent,
  parentFilePath,
  pruneDirectoryCacheAfterDelete,
} from '@shared/files/watcherEvents';

const entry = (name: string, relativePath: string): FileEntry => ({
  name,
  relativePath,
  kind: 'text',
  size: 1,
  modifiedAt: new Date().toISOString(),
  ignored: false,
});

describe('watcherEvents', () => {
  it('parentFilePath returns empty string for root entries', () => {
    expect(parentFilePath('README.md')).toBe('');
    expect(parentFilePath('src/main/app/lifecycle.ts')).toBe('src/main/app');
  });

  it('reloads the root listing when a root-level file changes (regression: explorer vanish)', () => {
    const cached = new Set(['', 'src']);
    expect(
      directoriesToReloadAfterEvent(
        { type: 'changed', relativePath: 'forge.config.ts', isDirectory: false },
        cached
      )
    ).toEqual(['']);
  });

  it('reloads the parent folder for nested changes without blanking unrelated caches', () => {
    const cached = new Set(['', 'src', 'src/main', 'src/main/app']);
    expect(
      directoriesToReloadAfterEvent(
        { type: 'changed', relativePath: 'src/main/app/lifecycle.ts', isDirectory: false },
        cached
      )
    ).toEqual(['src/main/app']);
  });

  it('does not schedule reloads for watcher readiness events', () => {
    expect(
      directoriesToReloadAfterEvent(
        { type: 'watcher-ready', relativePath: '', isDirectory: true },
        new Set([''])
      )
    ).toEqual([]);
  });

  it('prunes deleted directory listings but leaves the parent cache intact', () => {
    const cache: Record<string, FileEntry[]> = {
      '': [entry('src', 'src'), entry('README.md', 'README.md')],
      src: [entry('main', 'src/main')],
      'src/main': [entry('app', 'src/main/app')],
      'src/main/app': [entry('lifecycle.ts', 'src/main/app/lifecycle.ts')],
    };
    const next = pruneDirectoryCacheAfterDelete(cache, 'src/main', true);
    expect(next['']).toEqual(cache['']);
    expect(next.src).toEqual(cache.src);
    expect(next['src/main']).toBeUndefined();
    expect(next['src/main/app']).toBeUndefined();
  });
});
