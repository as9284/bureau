import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveGitDir } from '@main/git/gitDir';
import { detectBlockedOperations } from '@main/git/GitOperationDetector';

const created: string[] = [];

async function tempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-gitdir-'));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  while (created.length) {
    await fs.rm(created.pop()!, { recursive: true, force: true });
  }
});

describe('resolveGitDir', () => {
  it('returns <root>/.git for an ordinary clone', async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, '.git'));

    expect(await resolveGitDir(root)).toBe(path.join(root, '.git'));
  });

  it('follows a relative gitdir: pointer (the submodule form)', async () => {
    const root = await tempRepo();
    const real = path.join(root, 'modules', 'child');
    await fs.mkdir(real, { recursive: true });
    await fs.writeFile(path.join(root, '.git'), 'gitdir: ./modules/child\n');

    expect(await resolveGitDir(root)).toBe(path.resolve(root, './modules/child'));
  });

  it('follows an absolute gitdir: pointer (the linked-worktree form)', async () => {
    const root = await tempRepo();
    const real = await tempRepo();
    await fs.writeFile(path.join(root, '.git'), `gitdir: ${real}\n`);

    expect(await resolveGitDir(root)).toBe(path.normalize(real));
  });

  it('returns null when there is no .git or the pointer is junk', async () => {
    const root = await tempRepo();
    expect(await resolveGitDir(root)).toBeNull();

    await fs.writeFile(path.join(root, '.git'), 'not a pointer\n');
    expect(await resolveGitDir(root)).toBeNull();
  });
});

describe('detectBlockedOperations', () => {
  it('detects an in-progress merge in an ordinary clone', async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, '.git', 'MERGE_HEAD'), 'deadbeef\n');

    expect(await detectBlockedOperations(root)).toEqual({ blocked: true, kinds: ['merge'] });
  });

  // Regression: .git is a FILE in a linked worktree/submodule. Probing
  // <root>/.git/MERGE_HEAD hits ENOTDIR and used to report "not blocked",
  // which let mutations through mid-conflict and hid the RecoveryBanner.
  it('detects an in-progress merge in a linked worktree (.git is a file)', async () => {
    const root = await tempRepo();
    const gitDir = path.join(root, 'wt-gitdir');
    await fs.mkdir(gitDir);
    await fs.writeFile(path.join(root, '.git'), 'gitdir: ./wt-gitdir\n');
    await fs.writeFile(path.join(gitDir, 'MERGE_HEAD'), 'deadbeef\n');

    expect(await detectBlockedOperations(root)).toEqual({ blocked: true, kinds: ['merge'] });
  });

  it('detects a rebase + bisect through a gitdir pointer and dedupes kinds', async () => {
    const root = await tempRepo();
    const gitDir = path.join(root, 'wt-gitdir');
    await fs.mkdir(path.join(gitDir, 'rebase-merge'), { recursive: true });
    await fs.writeFile(path.join(root, '.git'), 'gitdir: ./wt-gitdir\n');
    await fs.writeFile(path.join(gitDir, 'REBASE_HEAD'), 'deadbeef\n');
    await fs.writeFile(path.join(gitDir, 'BISECT_LOG'), 'log\n');

    const result = await detectBlockedOperations(root);
    expect(result.blocked).toBe(true);
    expect([...result.kinds].sort()).toEqual(['bisect', 'rebase']);
  });

  it('reports not blocked when the repo is clean', async () => {
    const root = await tempRepo();
    await fs.mkdir(path.join(root, '.git'));

    expect(await detectBlockedOperations(root)).toEqual({ blocked: false, kinds: [] });
  });
});
