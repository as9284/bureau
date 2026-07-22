import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { BranchDetail } from '@shared/contracts/branches';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { ContextMenuProvider } from '@renderer/components/GitContextMenu';
import { BranchesPanel } from '@renderer/features/git/branches/BranchesPanel';
import { useGitStore } from '@renderer/store/gitStore';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';

function snapshot(): RepositorySnapshot {
  return {
    projectId: PROJECT_ID,
    revision: '0123456789abcdef',
    observedAt: '2026-07-22T00:00:00.000Z',
    durationMs: 1,
    stale: false,
    availability: 'available',
    branch: { kind: 'named', name: 'main' },
    upstream: { kind: 'none' },
    dirty: false,
    changedFileCount: 0,
    changedFiles: [],
  };
}

/** Unpublished + current: the row that can create a repository on a forge. */
const branches: BranchDetail[] = [
  {
    ref: 'refs/heads/main',
    shortName: 'main',
    kind: 'local',
    current: true,
    headOid: '0123456789abcdef',
    published: false,
  },
  {
    ref: 'refs/heads/feature',
    shortName: 'feature',
    kind: 'local',
    current: false,
    headOid: '0123456789abcdef',
    published: false,
  },
];

function mountPanel() {
  useGitStore.setState({
    branchDetails: branches,
    branchesLoading: false,
    branchesError: undefined,
    githubPublishRepoId: undefined,
    giteaPublishRepoId: undefined,
  });
  return render(
    <ContextMenuProvider>
      <BranchesPanel projectId={PROJECT_ID} snapshot={snapshot()} readOnly={false} />
    </ContextMenuProvider>
  );
}

function publishButtons() {
  return screen.getAllByRole('button', { name: 'Publish' });
}

afterEach(() => {
  cleanup();
  useGitStore.setState({ githubPublishRepoId: undefined, giteaPublishRepoId: undefined });
});

describe('publishing the current branch', () => {
  it('asks which forge instead of assuming GitHub', async () => {
    mountPanel();
    await userEvent.setup().click(publishButtons()[0]);

    expect(screen.getByRole('button', { name: /GitHub/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Gitea/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /existing remote/i })).toBeTruthy();
    // Nothing is opened until a forge is picked.
    expect(useGitStore.getState().githubPublishRepoId).toBeUndefined();
    expect(useGitStore.getState().giteaPublishRepoId).toBeUndefined();
  });

  it('opens the Gitea publish dialog when Gitea is chosen', async () => {
    mountPanel();
    const user = userEvent.setup();
    await user.click(publishButtons()[0]);
    await user.click(screen.getByRole('button', { name: /Gitea/ }));

    expect(useGitStore.getState().giteaPublishRepoId).toBe(PROJECT_ID);
    expect(useGitStore.getState().githubPublishRepoId).toBeUndefined();
  });

  it('still opens the GitHub publish dialog when GitHub is chosen', async () => {
    mountPanel();
    const user = userEvent.setup();
    await user.click(publishButtons()[0]);
    await user.click(screen.getByRole('button', { name: /GitHub/ }));

    expect(useGitStore.getState().githubPublishRepoId).toBe(PROJECT_ID);
    expect(useGitStore.getState().giteaPublishRepoId).toBeUndefined();
  });

  it('falls through to the remote form for a branch that is not current', async () => {
    mountPanel();
    await userEvent.setup().click(publishButtons()[1]);

    // No forge choice — a non-current branch only ever pushes to an existing remote.
    expect(screen.queryByRole('button', { name: /Gitea/ })).toBeNull();
    expect(screen.getByLabelText('Remote name')).toBeTruthy();
  });
});
