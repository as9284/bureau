import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BranchDetail } from '@shared/contracts/branches';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { SyncBar } from '@renderer/features/git/sync/SyncBar';
import { useGitStore } from '@renderer/store/gitStore';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';

function snapshot(branchName: string): RepositorySnapshot {
  return {
    projectId: PROJECT_ID,
    revision: '0123456789abcdef',
    observedAt: '2026-07-15T00:00:00.000Z',
    durationMs: 1,
    stale: false,
    availability: 'available',
    branch: { kind: 'named', name: branchName },
    upstream: { kind: 'tracking', ref: `origin/${branchName}`, ahead: 1, behind: 0, basis: 'localTrackingRef' },
    dirty: false,
    changedFileCount: 0,
    changedFiles: [],
  };
}

const branchDetails: BranchDetail[] = ['main', 'release'].map((shortName) => ({
  ref: `refs/heads/${shortName}`,
  shortName,
  kind: 'local',
  current: shortName === 'main',
  headOid: '0123456789abcdef',
  upstreamRef: `origin/${shortName}`,
  published: true,
}));

describe('SyncBar', () => {
  it('requires a branch-aware confirmation before switching and pushing', async () => {
    const releaseSnapshot = snapshot('release');
    const listBranchDetails = vi.fn().mockResolvedValue(branchDetails);
    const switchBranch = vi.fn().mockResolvedValue({ ok: true, snapshot: releaseSnapshot });
    const push = vi.fn().mockResolvedValue({ ok: true, snapshot: releaseSnapshot });
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: { git: { listBranchDetails, switchBranch, push } },
    });

    useGitStore.setState({
      repos: {
        [PROJECT_ID]: {
          catalogue: {
            projectId: PROJECT_ID,
            canonicalPath: 'C:/repo',
            displayName: 'repo',
            addedAt: '2026-07-15T00:00:00.000Z',
          },
          snapshot: snapshot('main'),
          refreshing: false,
        },
      },
      branches: ['main', 'release'],
      branchDetails,
      operationByRepo: {},
    });

    render(<SyncBar projectId={PROJECT_ID} snapshot={snapshot('main')} readOnly={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Push' }));

    expect(screen.getByRole('dialog', { name: 'Push branch?' })).toHaveTextContent(
      'Current branchmain'
    );
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Target branch' }));
    await userEvent.click(screen.getByRole('option', { name: 'release' }));
    await userEvent.click(screen.getByRole('button', { name: 'Switch to release and push' }));

    await waitFor(() => expect(switchBranch).toHaveBeenCalledOnce());
    await waitFor(() => expect(push).toHaveBeenCalledOnce());
  });
});
