import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useGitStore } from '@renderer/store/gitStore';
import { GitConfirmDialog } from '@renderer/features/git/GitConfirmDialog';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const OID = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const resolveConflict = vi.fn().mockResolvedValue({ ok: true });

function setConfirmOverwrite(enabled: boolean) {
  useGitStore.setState({
    pendingConfirm: undefined,
    settings: {
      confirmations: { conflictOverwrite: enabled },
    } as unknown as NonNullable<ReturnType<typeof useGitStore.getState>['settings']>,
  });
}

beforeEach(() => {
  resolveConflict.mockClear();
  (window as unknown as { bureau: unknown }).bureau = {
    git: { resolveConflict, mergeContinue: vi.fn().mockResolvedValue({ ok: true }) },
  };
  // runRepoOperation and the post-action reloads are exercised only after
  // confirmation; stub them so the tests focus on the gate itself. Stubbed in
  // beforeEach rather than per-test: the store is module-level, so a stub set
  // inside one test would leak into the next.
  useGitStore.setState({
    runRepoOperation: vi.fn(async (_p: string, _n: string, run: () => Promise<unknown>) => {
      await run();
    }) as unknown as ReturnType<typeof useGitStore.getState>['runRepoOperation'],
    loadRecoveryState: vi.fn().mockResolvedValue(undefined) as unknown as ReturnType<
      typeof useGitStore.getState
    >['loadRecoveryState'],
    refreshRepo: vi.fn().mockResolvedValue(undefined) as unknown as ReturnType<
      typeof useGitStore.getState
    >['refreshRepo'],
    loadBranches: vi.fn().mockResolvedValue(undefined) as unknown as ReturnType<
      typeof useGitStore.getState
    >['loadBranches'],
  });
  setConfirmOverwrite(true);
});

afterEach(cleanup);

describe('destructive git actions are gated in the store', () => {
  // Regression: the file context menu called resolveConflict() directly, so
  // `git checkout --ours/--theirs` overwrote hand-merged working-tree content
  // with no prompt. The gate now lives in the store, so every caller hits it.
  it('holds a conflict resolve for confirmation instead of running it', async () => {
    await useGitStore.getState().resolveConflict(PROJECT_ID, 'rev-1', 'src/a.ts', 'ours');

    expect(resolveConflict).not.toHaveBeenCalled();
    expect(useGitStore.getState().pendingConfirm?.title).toBe('Overwrite conflict resolution?');
  });

  it('runs the action only once the user confirms', async () => {
    await useGitStore.getState().resolveConflict(PROJECT_ID, 'rev-1', 'src/a.ts', 'theirs');
    render(<GitConfirmDialog />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Use theirs' }));

    expect(resolveConflict).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'src/a.ts', resolution: 'theirs' })
    );
    expect(useGitStore.getState().pendingConfirm).toBeUndefined();
  });

  it('cancelling never runs the action', async () => {
    await useGitStore.getState().resolveConflict(PROJECT_ID, 'rev-1', 'src/a.ts', 'ours');
    render(<GitConfirmDialog />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));

    expect(resolveConflict).not.toHaveBeenCalled();
    expect(useGitStore.getState().pendingConfirm).toBeUndefined();
  });

  it('runs immediately when the user has turned the confirmation off', async () => {
    setConfirmOverwrite(false);

    await useGitStore.getState().resolveConflict(PROJECT_ID, 'rev-1', 'src/a.ts', 'ours');

    expect(resolveConflict).toHaveBeenCalledOnce();
    expect(useGitStore.getState().pendingConfirm).toBeUndefined();
  });

  // These four were entirely ungated before: each overwrites working-tree state
  // or throws away in-progress work with a single click.
  it.each([
    ['recovery abort', () => useGitStore.getState().runRecoveryAction(PROJECT_ID, 'rev-1', 'abort')],
    ['recovery skip', () => useGitStore.getState().runRecoveryAction(PROJECT_ID, 'rev-1', 'skip')],
    ['stash pop', () => useGitStore.getState().stashPop(PROJECT_ID, 'rev-1', 0)],
    [
      'stash restore',
      () => useGitStore.getState().stashRestoreFiles(PROJECT_ID, 'rev-1', 0, ['src/a.ts']),
    ],
    ['worktree prune', () => useGitStore.getState().pruneWorktrees(PROJECT_ID, 'rev-1')],
    ['submodule update', () => useGitStore.getState().submoduleUpdate(PROJECT_ID, 'rev-1', 'vendor/x')],
    // Merge and rebase both move HEAD without an in-place undo.
    ['merge branch', () => useGitStore.getState().mergeBranch(PROJECT_ID, 'rev-1', 'feature/x')],
    ['rebase branch', () => useGitStore.getState().rebaseBranch(PROJECT_ID, 'rev-1', 'origin/main')],
    // Every reset mode moves the branch; --hard also destroys uncommitted work.
    ['reset soft', () => useGitStore.getState().resetToCommit(PROJECT_ID, 'rev-1', OID, 'soft')],
    ['reset mixed', () => useGitStore.getState().resetToCommit(PROJECT_ID, 'rev-1', OID, 'mixed')],
    ['reset hard', () => useGitStore.getState().resetToCommit(PROJECT_ID, 'rev-1', OID, 'hard')],
    // Detaching HEAD destroys nothing, but strands the user off any branch.
    ['checkout commit', () => useGitStore.getState().checkoutCommit(PROJECT_ID, 'rev-1', OID)],
    // Takes the remote's tracking branches with it.
    ['remove remote', () => useGitStore.getState().removeRemote(PROJECT_ID, 'rev-1', 'origin')],
  ])('holds %s for confirmation', async (_name, trigger) => {
    await trigger();
    expect(useGitStore.getState().pendingConfirm).toBeDefined();
  });

  // A conflicting merge/rebase is reported as success with a *blocked* snapshot,
  // so the recovery state must be reloaded or the RecoveryBanner never appears.
  it('runs a confirmed merge and reloads the recovery state', async () => {
    const mergeBranch = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { bureau: { git: Record<string, unknown> } }).bureau.git.mergeBranch =
      mergeBranch;
    const loadRecoveryState = useGitStore.getState().loadRecoveryState;

    await useGitStore.getState().mergeBranch(PROJECT_ID, 'rev-1', 'feature/x');
    expect(mergeBranch).not.toHaveBeenCalled();
    render(<GitConfirmDialog />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Merge' }));

    expect(mergeBranch).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotRevision: 'rev-1', branchName: 'feature/x' })
    );
    expect(loadRecoveryState).toHaveBeenCalledWith(PROJECT_ID);
  });

  // The reason reset ships as two settings rather than one: a user who silences the
  // routine soft/mixed prompt must still be stopped before --hard throws away work
  // that no reflog entry can restore.
  it('keeps the hard-reset prompt armed when the soft/mixed one is turned off', async () => {
    const resetToCommit = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { bureau: { git: Record<string, unknown> } }).bureau.git.resetToCommit =
      resetToCommit;
    useGitStore.setState({
      pendingConfirm: undefined,
      settings: {
        confirmations: { resetBranch: false, resetHard: true },
      } as unknown as NonNullable<ReturnType<typeof useGitStore.getState>['settings']>,
    });

    await useGitStore.getState().resetToCommit(PROJECT_ID, 'rev-1', OID, 'mixed');
    expect(resetToCommit).toHaveBeenCalledOnce();
    expect(useGitStore.getState().pendingConfirm).toBeUndefined();

    resetToCommit.mockClear();
    await useGitStore.getState().resetToCommit(PROJECT_ID, 'rev-1', OID, 'hard');
    expect(resetToCommit).not.toHaveBeenCalled();
    expect(useGitStore.getState().pendingConfirm?.title).toBe('Reset and discard your changes?');
    // Verified against real git: --hard leaves untracked files alone, so the copy
    // must not claim they are wiped.
    expect(useGitStore.getState().pendingConfirm?.description).toContain(
      'Untracked files are left in place'
    );
  });

  it('runs a confirmed hard reset with the chosen mode and reloads the reflog', async () => {
    const resetToCommit = vi.fn().mockResolvedValue({ ok: true });
    (window as unknown as { bureau: { git: Record<string, unknown> } }).bureau.git.resetToCommit =
      resetToCommit;
    const loadReflog = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({
      loadReflog: loadReflog as unknown as ReturnType<typeof useGitStore.getState>['loadReflog'],
      loadHistory: vi.fn().mockResolvedValue(undefined) as unknown as ReturnType<
        typeof useGitStore.getState
      >['loadHistory'],
    });

    await useGitStore.getState().resetToCommit(PROJECT_ID, 'rev-1', OID, 'hard');
    render(<GitConfirmDialog />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Reset and discard' }));

    expect(resetToCommit).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotRevision: 'rev-1', commitOid: OID, mode: 'hard' })
    );
    // The reset is itself a reflog entry, and it is the undo trail for this action.
    expect(loadReflog).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('lets a constructive recovery continue through without a prompt', async () => {
    useGitStore.setState({
      recoveryStateByRepo: { [PROJECT_ID]: { activeKind: 'merge' } },
    } as unknown as Parameters<typeof useGitStore.setState>[0]);

    await useGitStore.getState().runRecoveryAction(PROJECT_ID, 'rev-1', 'continue');

    expect(useGitStore.getState().pendingConfirm).toBeUndefined();
  });
});
