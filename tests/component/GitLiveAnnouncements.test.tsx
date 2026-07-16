import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { OperationsDrawer } from '@renderer/features/git/operations/OperationsDrawer';
import { SyncBar } from '@renderer/features/git/sync/SyncBar';
import { useGitStore } from '@renderer/store/gitStore';
import { useAppStore } from '@renderer/store/appStore';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';

function snapshot(ahead: number, behind: number): RepositorySnapshot {
  return {
    projectId: PROJECT_ID,
    revision: '0123456789abcdef',
    observedAt: '2026-07-16T00:00:00.000Z',
    durationMs: 1,
    stale: false,
    availability: 'available',
    branch: { kind: 'named', name: 'main' },
    upstream: { kind: 'tracking', ref: 'origin/main', ahead, behind, basis: 'localTrackingRef' },
    dirty: false,
    changedFileCount: 0,
    changedFiles: [],
  };
}

function announcements(): string[] {
  return useAppStore.getState().announcements;
}

afterEach(() => {
  useAppStore.setState({ announcements: [] });
  vi.restoreAllMocks();
});

describe('SyncBar live announcements', () => {
  function renderSyncBar(snap: RepositorySnapshot) {
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: { git: { listBranchDetails: vi.fn().mockResolvedValue([]) } },
    });
    useGitStore.setState({
      repos: {
        [PROJECT_ID]: {
          catalogue: {
            projectId: PROJECT_ID,
            canonicalPath: 'C:/repo',
            displayName: 'repo',
            addedAt: '2026-07-16T00:00:00.000Z',
          },
          snapshot: snap,
          refreshing: false,
        },
      },
      branches: ['main'],
      branchDetails: [],
      operationByRepo: {},
    });
    return render(<SyncBar projectId={PROJECT_ID} snapshot={snap} readOnly={false} />);
  }

  it('stays silent on first paint — the counts are a baseline, not a change', async () => {
    renderSyncBar(snapshot(2, 0));
    await waitFor(() => expect(announcements()).toEqual([]));
  });

  it('announces ahead/behind once a fetch moves the counts', async () => {
    const { rerender } = renderSyncBar(snapshot(2, 0));
    const fetched = snapshot(2, 3);
    useGitStore.setState((s) => ({
      repos: { ...s.repos, [PROJECT_ID]: { ...s.repos[PROJECT_ID]!, snapshot: fetched } },
    }));
    rerender(<SyncBar projectId={PROJECT_ID} snapshot={fetched} readOnly={false} />);

    await waitFor(() =>
      expect(announcements()).toContain('Branch is 2 commits ahead and 3 commits behind of its upstream.')
    );
  });

  it('singularises a one-commit delta and reports an up-to-date branch', async () => {
    const { rerender } = renderSyncBar(snapshot(2, 0));

    const one = snapshot(1, 0);
    rerender(<SyncBar projectId={PROJECT_ID} snapshot={one} readOnly={false} />);
    await waitFor(() =>
      expect(announcements()).toContain('Branch is 1 commit ahead of its upstream.')
    );

    const synced = snapshot(0, 0);
    rerender(<SyncBar projectId={PROJECT_ID} snapshot={synced} readOnly={false} />);
    await waitFor(() =>
      expect(announcements()).toContain('Branch is up to date with its upstream.')
    );
  });
});

describe('OperationsDrawer live announcements', () => {
  const baseOp = {
    id: 'op-1',
    kind: 'fetch' as const,
    summary: 'Fetch origin',
    projectId: PROJECT_ID,
    cancellable: true,
    startedAt: '2026-07-16T00:00:00.000Z',
    output: [],
  };

  function setOperations(state: 'queued' | 'running' | 'succeeded') {
    useGitStore.setState({
      operationDrawerOpen: true,
      operations: [{ ...baseOp, state }],
      operationsLoading: false,
      operationsError: undefined,
      loadOperations: vi.fn().mockResolvedValue(undefined),
    });
  }

  it('announces only real state transitions, not the first poll', async () => {
    setOperations('queued');
    const { rerender } = render(<OperationsDrawer />);
    // First sighting of an id is the initial paint — nothing changed yet.
    await waitFor(() => expect(announcements()).toEqual([]));

    setOperations('running');
    rerender(<OperationsDrawer />);
    await waitFor(() => expect(announcements()).toContain('Fetch origin: Running'));

    setOperations('succeeded');
    rerender(<OperationsDrawer />);
    await waitFor(() => expect(announcements()).toContain('Fetch origin: Succeeded'));

    // A poll that returns the same state must not re-announce.
    const before = announcements().length;
    setOperations('succeeded');
    rerender(<OperationsDrawer />);
    await waitFor(() => expect(announcements()).toHaveLength(before));
  });

  it('closes on Escape — it hand-rolls role="dialog", so it must hand-roll the key too', async () => {
    setOperations('running');
    const setOperationDrawerOpen = vi.fn();
    useGitStore.setState({ setOperationDrawerOpen });
    render(<OperationsDrawer />);

    await userEvent.keyboard('{Escape}');
    expect(setOperationDrawerOpen).toHaveBeenCalledWith(false);
  });
});
