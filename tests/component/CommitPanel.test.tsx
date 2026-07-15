import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { CommitPanel } from '@renderer/features/git/commit/CommitPanel';
import { useGitStore } from '@renderer/store/gitStore';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';

function snapshot(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    projectId: PROJECT_ID,
    revision: '0123456789abcdef',
    observedAt: '2026-07-15T00:00:00.000Z',
    durationMs: 1,
    stale: false,
    availability: 'available',
    branch: { kind: 'named', name: 'main' },
    upstream: { kind: 'none' },
    dirty: true,
    changedFileCount: 1,
    changedFiles: [
      {
        path: 'src/example.ts',
        indexCode: 'M',
        worktreeCode: ' ',
        kind: 'ordinary',
        staged: true,
        unstaged: false,
        untracked: false,
        unmerged: false,
      },
    ],
    ...overrides,
  };
}

describe('CommitPanel', () => {
  it('clears the commit form and the active diff after a successful commit', async () => {
    const committedSnapshot = snapshot({ dirty: false, changedFileCount: 0, changedFiles: [] });
    const commit = vi.fn().mockResolvedValue({ ok: true, snapshot: committedSnapshot });
    const listBranchDetails = vi.fn().mockResolvedValue([
      {
        ref: 'refs/heads/main',
        shortName: 'main',
        kind: 'local',
        current: true,
        headOid: '0123456789abcdef',
        published: false,
      },
    ]);
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: { git: { commit, listBranchDetails } },
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
          snapshot: snapshot(),
          refreshing: false,
        },
      },
      commitDrafts: { [PROJECT_ID]: 'feat: commit this change' },
      selectedFile: { projectId: PROJECT_ID, path: 'src/example.ts', area: 'staged' },
      diffText: '@@ -1 +1 @@\n-old\n+new',
      diffLoading: true,
      blameLines: [
        {
          oid: '0123456789abcdef',
          abbreviatedOid: '0123456',
          authorName: 'Bureau',
          committedAt: '2026-07-15T00:00:00.000Z',
          subject: 'Initial commit',
          lineNumber: 1,
          content: 'new',
        },
      ],
      blameLoading: true,
      blameHasMore: true,
      blamePath: 'src/example.ts',
      blameCommitOid: '0123456789abcdef',
      operationByRepo: {},
      commitOptionsByRepo: { [PROJECT_ID]: { amend: false, signOff: false } },
    });

    render(<CommitPanel projectId={PROJECT_ID} snapshot={snapshot()} readOnly={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Commit' }));

    expect(screen.getByRole('dialog', { name: 'Commit changes?' })).toHaveTextContent(
      'Current branchmain'
    );
    expect(commit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Commit to main' }));

    await waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(useGitStore.getState()).toMatchObject({
      commitDrafts: { [PROJECT_ID]: '' },
      selectedFile: undefined,
      diffText: undefined,
      diffLoading: false,
      blameLines: [],
      blameLoading: false,
      blameHasMore: false,
      blamePath: undefined,
      blameCommitOid: undefined,
    });
  });
});
