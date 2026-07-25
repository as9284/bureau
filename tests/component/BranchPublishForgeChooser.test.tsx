import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** Unpublished locals; no remotes configured yet. */
const unpublishedBranches: BranchDetail[] = [
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

/** Current branch unpublished, but origin already exists (new branch in existing repo). */
const existingRemoteBranches: BranchDetail[] = [
  {
    ref: 'refs/heads/feature',
    shortName: 'feature',
    kind: 'local',
    current: true,
    headOid: '0123456789abcdef',
    published: false,
  },
  {
    ref: 'refs/remotes/origin/main',
    shortName: 'origin/main',
    kind: 'remote',
    current: false,
    headOid: '0123456789abcdef',
    published: true,
    remoteName: 'origin',
  },
];

function mountPanel(branchDetails: BranchDetail[], remotes: { name: string; fetchUrl: string; pushUrl: string }[] = []) {
  useGitStore.setState({
    branchDetails,
    branchesLoading: false,
    branchesError: undefined,
    remotes,
    remotesLoading: false,
    githubPublishRepoId: undefined,
    giteaPublishRepoId: undefined,
    loadRemotes: vi.fn().mockResolvedValue(undefined),
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

describe('publishing when the repo has no remote yet', () => {
  it('asks whether to create a repository instead of assuming GitHub', async () => {
    mountPanel(unpublishedBranches);
    await userEvent.setup().click(publishButtons()[0]);

    expect(screen.getByRole('dialog', { name: /Publish this repository/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Create on GitHub/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Create on Gitea/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Push to an existing remote/i })).toBeTruthy();
    expect(useGitStore.getState().githubPublishRepoId).toBeUndefined();
    expect(useGitStore.getState().giteaPublishRepoId).toBeUndefined();
  });

  it('opens the Gitea create-repo dialog when Gitea is chosen', async () => {
    mountPanel(unpublishedBranches);
    const user = userEvent.setup();
    await user.click(publishButtons()[0]);
    await user.click(screen.getByRole('button', { name: /Create on Gitea/ }));

    expect(useGitStore.getState().giteaPublishRepoId).toBe(PROJECT_ID);
    expect(useGitStore.getState().githubPublishRepoId).toBeUndefined();
  });

  it('opens the GitHub create-repo dialog when GitHub is chosen', async () => {
    mountPanel(unpublishedBranches);
    const user = userEvent.setup();
    await user.click(publishButtons()[0]);
    await user.click(screen.getByRole('button', { name: /Create on GitHub/ }));

    expect(useGitStore.getState().githubPublishRepoId).toBe(PROJECT_ID);
    expect(useGitStore.getState().giteaPublishRepoId).toBeUndefined();
  });

  it('falls through to the remote form for a branch that is not current', async () => {
    mountPanel(unpublishedBranches);
    await userEvent.setup().click(publishButtons()[1]);

    expect(screen.queryByRole('button', { name: /Create on Gitea/ })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Publish branch' })).toBeTruthy();
    expect(screen.getByLabelText('Remote name')).toBeTruthy();
  });
});

describe('publishing a new branch when a remote already exists', () => {
  it('opens the publish-branch dialog instead of create-repository chooser', async () => {
    mountPanel(existingRemoteBranches, [
      { name: 'origin', fetchUrl: 'https://github.com/acme/app.git', pushUrl: 'https://github.com/acme/app.git' },
    ]);
    await userEvent.setup().click(publishButtons()[0]);

    expect(screen.queryByRole('dialog', { name: /Publish this repository/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Create on GitHub/ })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Publish branch' })).toBeTruthy();
    expect(
      screen.getByText(/does not create a new GitHub or Gitea repository/i)
    ).toBeTruthy();
  });
});
