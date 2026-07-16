import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PanelError } from '@renderer/features/git/PanelState';
import { BranchesPanel } from '@renderer/features/git/branches/BranchesPanel';
import { ContextMenuProvider } from '@renderer/components/GitContextMenu';
import { useGitStore } from '@renderer/store/gitStore';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';

/** Branch rows are context-menu triggers, which the real shell provides. */
function renderBranches() {
  return render(
    <ContextMenuProvider>
      <BranchesPanel projectId={PROJECT_ID} readOnly={false} />
    </ContextMenuProvider>
  );
}

// The store is module-level, so data *and* stubbed actions leak between tests.
// Snapshot it once and hard-replace after each test.
const pristineState = useGitStore.getState();

afterEach(() => {
  cleanup();
  useGitStore.setState(pristineState, true);
});

describe('PanelError', () => {
  it('announces itself as an alert and shows the underlying git message', () => {
    render(<PanelError title="Could not load branches" message="fatal: not a git repository" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load branches');
    expect(alert).toHaveTextContent('fatal: not a git repository');
  });

  it('fires the retry callback', async () => {
    const onRetry = vi.fn();
    render(<PanelError title="Could not load branches" message="boom" onRetry={onRetry} />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('fires the dismiss callback independently of retry', async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <PanelError title="Push failed" message="boom" onRetry={onRetry} onDismiss={onDismiss} />
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  });

  // Retry is not always meaningful — the lifecycle dialogs keep their own submit
  // button as the retry, so the banner must be able to render without one.
  it('omits Retry when no callback is given', () => {
    render(<PanelError title="Clone failed" message="boom" />);

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('operation retry cannot bypass a confirmation', () => {
  /**
   * Every destructive action reaches `runRepoOperation` through `gateConfirm`'s
   * already-confirmed `run`. Recording a retry for those would let the workbench
   * banner re-fire the git command with no prompt — the same class of bypass the
   * store-level gate exists to make impossible. Retry is opt-in for that reason.
   */
  it('records no retry for a gated destructive action', async () => {
    const resetToCommit = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'COMMAND_FAILED', message: 'boom', operation: 'reset', retryable: true },
    });
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: { git: { resetToCommit } },
    });
    useGitStore.setState({
      operationByRepo: {},
      settings: { confirmations: { resetHard: false } } as unknown as NonNullable<
        ReturnType<typeof useGitStore.getState>['settings']
      >,
      refreshRepo: vi.fn().mockResolvedValue(undefined) as never,
      loadHistory: vi.fn().mockResolvedValue(undefined) as never,
      loadBranches: vi.fn().mockResolvedValue(undefined) as never,
      loadReflog: vi.fn().mockResolvedValue(undefined) as never,
    });

    await useGitStore
      .getState()
      .resetToCommit(PROJECT_ID, 'rev-1', 'a'.repeat(40), 'hard');

    expect(resetToCommit).toHaveBeenCalledOnce();
    const op = useGitStore.getState().operationByRepo[PROJECT_ID];
    expect(op?.error?.message).toBe('boom');
    expect(op?.retry).toBeUndefined();

    // And the store refuses to retry what it never recorded.
    await useGitStore.getState().retryOperation(PROJECT_ID);
    expect(resetToCommit).toHaveBeenCalledOnce();
  });

  it('records a retry for push, which no confirmation gates', async () => {
    const push = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: 'COMMAND_FAILED', message: 'network is unreachable', operation: 'push', retryable: true },
    });
    Object.defineProperty(window, 'bureau', { configurable: true, value: { git: { push } } });
    useGitStore.setState({ operationByRepo: {} });

    await useGitStore.getState().push(PROJECT_ID, 'rev-1');
    expect(useGitStore.getState().operationByRepo[PROJECT_ID]?.retry).toBeDefined();

    await useGitStore.getState().retryOperation(PROJECT_ID);
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe('BranchesPanel error state', () => {
  /**
   * Regression: `loadBranches` swallowed its failure and only cleared the loading
   * flag, so a repository whose branches could not be listed rendered the "No
   * branches" *empty* state — asserting as fact the very thing the failure means
   * we could not determine.
   */
  it('reports a failed load as an alert rather than an empty state, and Retry re-fires it', async () => {
    const listBranchDetails = vi
      .fn()
      .mockRejectedValueOnce(new Error('fatal: not a git repository'))
      .mockResolvedValueOnce([
        {
          ref: 'refs/heads/main',
          shortName: 'main',
          kind: 'local',
          current: true,
          headOid: '0123456789abcdef',
          published: true,
        },
      ]);
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: { git: { listBranchDetails } },
    });

    await useGitStore.getState().loadBranches(PROJECT_ID);
    renderBranches();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load branches');
    expect(alert).toHaveTextContent('fatal: not a git repository');
    expect(screen.queryByText('No branches')).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(listBranchDetails).toHaveBeenCalledTimes(2);
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  // "Degraded (stale flag, not blanking)": pressing Refresh over an existing list
  // used to swap it for skeletons, hiding data that was still perfectly usable.
  it('keeps the existing list visible and marks it busy while re-loading', async () => {
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: { git: { listBranchDetails: vi.fn(() => new Promise(() => undefined)) } },
    });
    useGitStore.setState({
      branchesError: undefined,
      branchesLoading: false,
      branchDetails: [
        {
          ref: 'refs/heads/main',
          shortName: 'main',
          kind: 'local',
          current: true,
          headOid: '0123456789abcdef',
          published: true,
        },
      ],
    });

    renderBranches();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));

    expect(screen.getByText('main')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('main').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true')
    );
  });
});

