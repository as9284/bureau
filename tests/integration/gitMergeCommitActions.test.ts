import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGitRunner } from '@main/git/GitRunner';
import { createOperationCoordinator } from '@main/operations/OperationCoordinator';
import { createGitExtendedMutationService } from '@main/git/GitExtendedMutationService';
import { createGitQueryService } from '@main/git/GitQueryService';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';
const REVISION = 'abcdef0123456789';

const runner = createGitRunner();
let repoPath: string;

async function git(...args: string[]): Promise<string> {
  const result = await runner.run('git', {
    args: ['-C', repoPath, ...args],
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

/**
 * Real git, real temp repo. The bug under test is entirely about the argv handed to
 * git — `revert <merge>` without `-m` is rejected by git itself — so a mocked runner
 * could not have caught it and cannot prove the fix.
 */
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
  // The snapshot only has to satisfy checkEligible's revision match; the real
  // status collection is covered by its own suite.
  const snapshot = { revision: REVISION, blockedOperation: undefined } as unknown as RepositorySnapshot;
  const snapshotCache = { get: () => snapshot, set: () => undefined } as never;
  const statusService = { collectSnapshot: async () => snapshot } as never;

  return {
    mutation: createGitExtendedMutationService({
      catalogue,
      snapshotCache,
      resolver,
      runner,
      statusService,
      coordinator,
    }),
    query: createGitQueryService({ catalogue, resolver, runner, coordinator }),
  };
}

beforeEach(async () => {
  repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-git-merge-'));
  await git('init', '--initial-branch=main');
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await git('config', 'commit.gpgsign', 'false');

  // A real merge commit: main gets base.txt + main.txt, feature gets feature.txt,
  // then a --no-ff merge gives us a two-parent commit to revert.
  await fs.writeFile(path.join(repoPath, 'base.txt'), 'base\n');
  await git('add', '.');
  await git('commit', '-m', 'Base');

  await git('checkout', '-b', 'feature');
  await fs.writeFile(path.join(repoPath, 'feature.txt'), 'feature\n');
  await git('add', '.');
  await git('commit', '-m', 'Add the widget');

  await git('checkout', 'main');
  await fs.writeFile(path.join(repoPath, 'main.txt'), 'main\n');
  await git('add', '.');
  await git('commit', '-m', 'Release 2.0');

  await git('merge', '--no-ff', '--no-edit', 'feature');
});

afterEach(async () => {
  await fs.rm(repoPath, { recursive: true, force: true });
});

describe('revert/cherry-pick of a merge commit', () => {
  it('is rejected by git when no mainline is given (the original bug)', async () => {
    const { mutation } = buildServices();
    const mergeOid = await git('rev-parse', 'HEAD');

    const result = await mutation.revertCommit({
      projectId: PROJECT_ID,
      snapshotRevision: REVISION,
      commitOid: mergeOid,
    });

    // This is what users hit before the fix: git refuses, and the app had no remedy.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/-m|mainline/i);
    }
    // The failed revert must not leave the repo mid-operation.
    expect(await fileExists(path.join(repoPath, '.git', 'REVERT_HEAD'))).toBe(false);
  });

  it('reverts the merged-in side with mainline 1', async () => {
    const { mutation } = buildServices();
    const mergeOid = await git('rev-parse', 'HEAD');

    const result = await mutation.revertCommit({
      projectId: PROJECT_ID,
      snapshotRevision: REVISION,
      commitOid: mergeOid,
      mainline: 1,
    });

    expect(result.ok).toBe(true);
    // Keeping parent 1 (main) undoes what feature brought in.
    expect(await fileExists(path.join(repoPath, 'feature.txt'))).toBe(false);
    expect(await fileExists(path.join(repoPath, 'main.txt'))).toBe(true);
  });

  it('reverts the other side with mainline 2 — proving the choice is not cosmetic', async () => {
    const { mutation } = buildServices();
    const mergeOid = await git('rev-parse', 'HEAD');

    const result = await mutation.revertCommit({
      projectId: PROJECT_ID,
      snapshotRevision: REVISION,
      commitOid: mergeOid,
      mainline: 2,
    });

    expect(result.ok).toBe(true);
    // Keeping parent 2 (feature) undoes main's own commit instead — the opposite
    // outcome, which is exactly why the mainline must never be guessed.
    expect(await fileExists(path.join(repoPath, 'main.txt'))).toBe(false);
    expect(await fileExists(path.join(repoPath, 'feature.txt'))).toBe(true);
  });

  it('reverts an ordinary commit with no mainline', async () => {
    const { mutation } = buildServices();
    const ordinaryOid = await git('rev-parse', 'HEAD~1');

    const result = await mutation.revertCommit({
      projectId: PROJECT_ID,
      snapshotRevision: REVISION,
      commitOid: ordinaryOid,
    });

    expect(result.ok).toBe(true);
  });

  it('cherry-picks a merge commit onto another branch with a mainline', async () => {
    const { mutation } = buildServices();
    const mergeOid = await git('rev-parse', 'HEAD');
    await git('checkout', '-b', 'target', 'HEAD~2');

    const result = await mutation.cherryPick({
      projectId: PROJECT_ID,
      snapshotRevision: REVISION,
      commitOid: mergeOid,
      mainline: 1,
    });

    expect(result.ok).toBe(true);
    expect(await fileExists(path.join(repoPath, 'feature.txt'))).toBe(true);
  });
});

describe('checkoutCommit', () => {
  it('detaches HEAD at the requested commit', async () => {
    const { mutation } = buildServices();
    const baseOid = await git('rev-parse', 'HEAD~2');

    const result = await mutation.checkoutCommit({
      projectId: PROJECT_ID,
      snapshotRevision: REVISION,
      commitOid: baseOid,
    });

    expect(result.ok).toBe(true);
    expect(await git('rev-parse', 'HEAD')).toBe(baseOid);
    // Detached means HEAD names no branch.
    const symbolic = await runner.run('git', {
      args: ['-C', repoPath, 'symbolic-ref', '-q', 'HEAD'],
      timeoutMs: 30_000,
    });
    expect(symbolic.exitCode).not.toBe(0);
  });
});

describe('remote management', () => {
  it('adds, lists, renames, re-points and removes a remote', async () => {
    const { mutation, query } = buildServices();
    const base = { projectId: PROJECT_ID, snapshotRevision: REVISION };

    expect(await query.listRemotes({ projectId: PROJECT_ID })).toEqual([]);

    expect(
      (await mutation.addRemote({ ...base, name: 'origin', url: 'https://example.com/a.git' })).ok
    ).toBe(true);
    expect(await query.listRemotes({ projectId: PROJECT_ID })).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' },
    ]);

    expect((await mutation.renameRemote({ ...base, name: 'origin', newName: 'upstream' })).ok).toBe(
      true
    );
    expect((await query.listRemotes({ projectId: PROJECT_ID }))[0].name).toBe('upstream');

    expect(
      (await mutation.setRemoteUrl({ ...base, name: 'upstream', url: 'https://example.com/b.git' }))
        .ok
    ).toBe(true);
    expect((await query.listRemotes({ projectId: PROJECT_ID }))[0].fetchUrl).toBe(
      'https://example.com/b.git'
    );

    expect((await mutation.removeRemote({ ...base, name: 'upstream' })).ok).toBe(true);
    expect(await query.listRemotes({ projectId: PROJECT_ID })).toEqual([]);
  });

  it('reports git\'s own error rather than throwing when a remote already exists', async () => {
    const { mutation } = buildServices();
    const base = { projectId: PROJECT_ID, snapshotRevision: REVISION };
    await mutation.addRemote({ ...base, name: 'origin', url: 'https://example.com/a.git' });

    const result = await mutation.addRemote({
      ...base,
      name: 'origin',
      url: 'https://example.com/c.git',
    });

    expect(result.ok).toBe(false);
  });
});

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
