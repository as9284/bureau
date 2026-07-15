import { describe, it, expect } from 'vitest';
import { parsePorcelain } from '../../../src/main/system/GitService';

describe('parsePorcelain', () => {
  it('extracts branch, ahead/behind, and counts every change kind', () => {
    const output = [
      '# branch.oid abcdef0123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaa bbb src/a.ts', // unstaged modify
      '1 M. N... 100644 100644 100644 ccc ddd src/b.ts', // staged modify
      'u UU N... 100644 100644 100644 100644 eee fff ggg conflict.ts', // conflict
      '? untracked.txt', // untracked
      '',
    ].join('\n');

    const snap = parsePorcelain(output);
    expect(snap).toEqual({
      isRepo: true,
      branch: 'main',
      detached: false,
      ahead: 2,
      behind: 1,
      changes: 4,
    });
  });

  it('reports a clean repo with no upstream', () => {
    const snap = parsePorcelain('# branch.oid abc\n# branch.head feature/x\n');
    expect(snap.isRepo).toBe(true);
    expect(snap.branch).toBe('feature/x');
    expect(snap.ahead).toBe(0);
    expect(snap.behind).toBe(0);
    expect(snap.changes).toBe(0);
  });

  it('flags a detached HEAD', () => {
    const snap = parsePorcelain('# branch.head (detached)\n');
    expect(snap.detached).toBe(true);
    expect(snap.branch).toBeNull();
  });
});
