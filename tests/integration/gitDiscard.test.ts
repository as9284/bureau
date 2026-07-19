import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGitRunner } from '@main/git/GitRunner';
import { createGitStatusService } from '@main/git/GitStatusService';
import { createGitMutationService } from '@main/git/GitMutationService';
import { createSnapshotCache } from '@main/projects/SnapshotCache';
import { createOperationCoordinator } from '@main/operations/OperationCoordinator';
import type { GitMutationService } from '@main/git/GitMutationService';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';

const runner = createGitRunner();
let repoPath: string;
let mutation: GitMutationService;
const snapshotCache = createSnapshotCache();

async function git(...args: string[]): Promise<string> {
  const result = await runner.run('git', { args: ['-C', repoPath, ...args], timeoutMs: 30_000 });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

async function status(): Promise<string> {
  return git('status', '--porcelain=v1');
}

function buildServices() {
  const coordinator = createOperationCoordinator();
  const catalogue = { get: () => ({ canonicalPath: repoPath }) } as never;
  const resolver = {
    resolve: async () => ({
      kind: 'available' as const,
      executablePath: 'git',
      version: { raw: 'git version 2.45.0', major: 2, minor: 45, patch: 0 },
    }),
  } as never;
  const statusService = createGitStatusService(resolver, runner);
  return createGitMutationService({
    catalogue,
    snapshotCache,
    resolver,
    runner,
    statusService,
    coordinator,
  });
}

/** Refresh the cache from real status, then discard a single path at that revision. */
async function discard(filePath: string) {
  const statusService = createGitStatusService(
    {
      resolve: async () => ({
        kind: 'available' as const,
        executablePath: 'git',
        version: { raw: 'git version 2.45.0', major: 2, minor: 45, patch: 0 },
      }),
    } as never,
    runner
  );
  const snap = await statusService.collectSnapshot(PROJECT_ID, repoPath);
  snapshotCache.set(PROJECT_ID, snap);
  return mutation.discardFile({ projectId: PROJECT_ID, snapshotRevision: snap.revision, path: filePath });
}

async function refreshCache() {
  const statusService = createGitStatusService(
    {
      resolve: async () => ({
        kind: 'available' as const,
        executablePath: 'git',
        version: { raw: 'git version 2.45.0', major: 2, minor: 45, patch: 0 },
      }),
    } as never,
    runner
  );
  const snap = await statusService.collectSnapshot(PROJECT_ID, repoPath);
  snapshotCache.set(PROJECT_ID, snap);
  return snap;
}

beforeEach(async () => {
  repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-git-discard-'));
  await git('init', '--initial-branch=main');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');
  // Keep worktree bytes identical to committed blobs so content assertions are line-ending stable.
  await git('config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(repoPath, 'tracked.txt'), 'HEAD content\n');
  await fs.writeFile(path.join(repoPath, 'todelete.txt'), 'keep me\n');
  await git('add', '.');
  await git('commit', '-m', 'base');
  mutation = buildServices();
});

afterEach(async () => {
  await fs.rm(repoPath, { recursive: true, force: true });
});

describe('discardFile — reverts any single file to HEAD', () => {
  it('discards an unstaged modification', async () => {
    await fs.writeFile(path.join(repoPath, 'tracked.txt'), 'dirty\n');
    const result = await discard('tracked.txt');
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('HEAD content\n');
    expect(await status()).toBe('');
  });

  it('fully discards a staged-and-modified file (no staged remnant left behind)', async () => {
    await fs.writeFile(path.join(repoPath, 'tracked.txt'), 'staged\n');
    await git('add', 'tracked.txt');
    await fs.writeFile(path.join(repoPath, 'tracked.txt'), 'staged then worktree\n');
    // Precondition: git sees both an index and a worktree change (MM).
    expect(await status()).toContain('tracked.txt');

    const result = await discard('tracked.txt');
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('HEAD content\n');
    // The whole point: nothing is left staged.
    expect(await status()).toBe('');
  });

  it('discards a brand-new staged file by removing it', async () => {
    await fs.writeFile(path.join(repoPath, 'added.txt'), 'new\n');
    await git('add', 'added.txt');
    const result = await discard('added.txt');
    expect(result.ok).toBe(true);
    await expect(fs.stat(path.join(repoPath, 'added.txt'))).rejects.toThrow();
    expect(await status()).toBe('');
  });

  it('discards an untracked file and prunes the empty folder it leaves behind', async () => {
    await fs.mkdir(path.join(repoPath, 'newdir'));
    await fs.writeFile(path.join(repoPath, 'newdir', 'note.txt'), 'scratch\n');
    const result = await discard('newdir/note.txt');
    expect(result.ok).toBe(true);
    await expect(fs.stat(path.join(repoPath, 'newdir'))).rejects.toThrow();
    expect(await status()).toBe('');
  });

  it('discards a staged deletion by restoring the file', async () => {
    await git('rm', 'todelete.txt');
    const result = await discard('todelete.txt');
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(repoPath, 'todelete.txt'), 'utf8')).toBe('keep me\n');
    expect(await status()).toBe('');
  });

  it('refuses to discard a conflicted file', async () => {
    // Build a real conflict on tracked.txt.
    await git('checkout', '-b', 'feature');
    await fs.writeFile(path.join(repoPath, 'tracked.txt'), 'feature\n');
    await git('commit', '-am', 'feature change');
    await git('checkout', 'main');
    await fs.writeFile(path.join(repoPath, 'tracked.txt'), 'main\n');
    await git('commit', '-am', 'main change');
    const merge = await runner.run('git', {
      args: ['-C', repoPath, 'merge', 'feature'],
      timeoutMs: 30_000,
    });
    expect(merge.exitCode).not.toBe(0); // conflict

    const result = await discard('tracked.txt');
    expect(result.ok).toBe(false);
  });
});

describe('discardAll — discards unstaged + untracked, keeps staged', () => {
  it('reverts unstaged and removes untracked while preserving staged changes', async () => {
    // Staged change we expect to survive.
    await fs.writeFile(path.join(repoPath, 'tracked.txt'), 'staged survivor\n');
    await git('add', 'tracked.txt');
    // Unstaged change on an already-committed file (stage then add a worktree edit on top so it
    // stays a pure staged file plus a separate unstaged file).
    await fs.writeFile(path.join(repoPath, 'todelete.txt'), 'unstaged edit\n');
    // Untracked file in a new folder.
    await fs.mkdir(path.join(repoPath, 'scratch'));
    await fs.writeFile(path.join(repoPath, 'scratch', 'temp.txt'), 'temp\n');

    const snap = await refreshCache();
    const result = await mutation.discardAll({ projectId: PROJECT_ID, snapshotRevision: snap.revision });
    expect(result.ok).toBe(true);

    // Unstaged edit reverted, untracked folder gone.
    expect(await fs.readFile(path.join(repoPath, 'todelete.txt'), 'utf8')).toBe('keep me\n');
    await expect(fs.stat(path.join(repoPath, 'scratch'))).rejects.toThrow();
    // Staged change preserved.
    expect(await fs.readFile(path.join(repoPath, 'tracked.txt'), 'utf8')).toBe('staged survivor\n');
    expect(await status()).toBe('M  tracked.txt');
  });
});
