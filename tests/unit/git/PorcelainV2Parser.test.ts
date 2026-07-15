import { describe, it, expect } from 'vitest';
import { parsePorcelainV2Status, parseLatestCommit } from '../../../src/main/git/PorcelainV2Parser';

function buildOutput(parts: string[]): string {
  return parts.join('\0') + '\0';
}

describe('parsePorcelainV2Status', () => {
  it('parses a clean repository with a named branch', () => {
    const output = buildOutput([
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +0 -0',
    ]);
    const result = parsePorcelainV2Status(output);

    expect(result.branch).toEqual({ kind: 'named', name: 'main', headOid: 'abc123' });
    expect(result.upstream).toEqual({
      kind: 'tracking',
      ref: 'origin/main',
      ahead: 0,
      behind: 0,
      basis: 'localTrackingRef',
    });
    expect(result.changedFiles).toHaveLength(0);
  });

  it('parses a detached HEAD', () => {
    const output = buildOutput(['# branch.oid def456', '# branch.head (detached)']);
    const result = parsePorcelainV2Status(output);

    expect(result.branch).toEqual({ kind: 'detached', headOid: 'def456' });
  });

  it('parses an unborn branch', () => {
    const output = buildOutput(['# branch.oid (initial)', '# branch.head main']);
    const result = parsePorcelainV2Status(output);

    expect(result.branch).toEqual({ kind: 'unborn' });
  });

  it('parses modified and untracked files', () => {
    const output = buildOutput([
      '# branch.oid abc123',
      '# branch.head main',
      '1 M. N... 100644 100644 100644 abc def src/app.ts',
      '1 .M N... 100644 100644 100644 abc def src/index.ts',
      '? README.md',
    ]);
    const result = parsePorcelainV2Status(output);

    expect(result.changedFiles).toHaveLength(3);
    const app = result.changedFiles.find((f) => f.path === 'src/app.ts');
    expect(app?.staged).toBe(true);
    expect(app?.unstaged).toBe(false);

    const index = result.changedFiles.find((f) => f.path === 'src/index.ts');
    expect(index?.staged).toBe(false);
    expect(index?.unstaged).toBe(true);

    const readme = result.changedFiles.find((f) => f.path === 'README.md');
    expect(readme?.untracked).toBe(true);
  });

  it('parses a rename record with the destination path (incl. spaces)', () => {
    const output = buildOutput([
      '# branch.oid abc123',
      '# branch.head main',
      '2 R. N... 100644 100644 100644 hh ii R100 new name.txt',
      'old name.txt',
    ]);
    const result = parsePorcelainV2Status(output);

    expect(result.changedFiles).toHaveLength(1);
    const file = result.changedFiles[0];
    expect(file?.path).toBe('new name.txt');
    expect(file?.kind).toBe('renameOrCopy');
    expect(file?.staged).toBe(true);
  });

  it('parses an unmerged record with a path containing spaces', () => {
    const output = buildOutput([
      '# branch.oid abc123',
      '# branch.head main',
      'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflicted file.txt',
    ]);
    const result = parsePorcelainV2Status(output);

    expect(result.changedFiles).toHaveLength(1);
    expect(result.changedFiles[0]?.path).toBe('conflicted file.txt');
    expect(result.changedFiles[0]?.unmerged).toBe(true);
  });

  it('parses ahead/behind counts', () => {
    const output = buildOutput([
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +3 -2',
    ]);
    const result = parsePorcelainV2Status(output);

    expect(result.upstream).toMatchObject({ ahead: 3, behind: 2 });
  });
});

describe('parseLatestCommit', () => {
  it('parses NUL-separated commit fields', () => {
    const output = 'full-oid\x00abbrev\x00Author Name\x002026-01-01T00:00:00Z\x00Subject line\x00';
    const commit = parseLatestCommit(output);

    expect(commit).toEqual({
      oid: 'full-oid',
      abbreviatedOid: 'abbrev',
      authorName: 'Author Name',
      committedAt: '2026-01-01T00:00:00Z',
      subject: 'Subject line',
    });
  });
});
