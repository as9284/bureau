import { describe, expect, it } from 'vitest';
import { isValidEntryName, resolveCreateParent } from '@renderer/features/files/createEntry';
import type { FileEntry } from '@shared/contracts/files';

function entry(relativePath: string, kind: FileEntry['kind']): FileEntry {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    relativePath,
    kind,
    size: 0,
    modifiedAt: new Date().toISOString(),
    ignored: false,
  };
}

describe('resolveCreateParent', () => {
  const cache = {
    '': [entry('src', 'directory'), entry('README.md', 'text')],
    src: [entry('src/app.ts', 'text'), entry('src/lib', 'directory')],
  };

  it('uses the selected folder, else the parent of a selected file, else root', () => {
    expect(resolveCreateParent('src', cache, [])).toBe('src');
    expect(resolveCreateParent('src/app.ts', cache, [])).toBe('src');
    expect(resolveCreateParent(null, cache, [])).toBe('');
    expect(resolveCreateParent('README.md', cache, [])).toBe('');
  });
});

describe('isValidEntryName', () => {
  it('rejects empty, traversal-ish, and reserved Windows names', () => {
    expect(isValidEntryName('note.md')).toBe(true);
    expect(isValidEntryName('')).toBe(false);
    expect(isValidEntryName('a/b')).toBe(false);
    expect(isValidEntryName('con')).toBe(false);
    expect(isValidEntryName('ends-with-dot.')).toBe(false);
  });
});
