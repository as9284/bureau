import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import type { GiteaStatus } from '@shared/contracts/gitea';
import { PublishToGiteaDialog } from '@renderer/features/git/gitea/PublishToGiteaDialog';
import { useGitStore } from '@renderer/store/gitStore';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';

function snapshot(): RepositorySnapshot {
  return {
    projectId: PROJECT_ID,
    revision: '0123456789abcdef',
    observedAt: '2026-07-16T00:00:00.000Z',
    durationMs: 1,
    stale: false,
    availability: 'available',
    branch: { kind: 'named', name: 'main' },
    upstream: { kind: 'none' },
    dirty: false,
    changedFileCount: 0,
    changedFiles: [],
    latestCommit: {
      oid: '0123456789abcdef0123456789abcdef01234567',
      abbreviatedOid: '0123456',
      subject: 'first commit',
      authorName: 'Ana',
      committedAt: '2026-07-16T00:00:00.000Z',
    },
  };
}

function mountDialog(gitea: Partial<Record<string, unknown>>) {
  Object.defineProperty(window, 'bureau', { configurable: true, value: { gitea } });
  useGitStore.setState({
    giteaPublishRepoId: PROJECT_ID,
    repos: {
      [PROJECT_ID]: {
        catalogue: {
          projectId: PROJECT_ID,
          canonicalPath: 'C:/repo',
          displayName: 'My Project',
          addedAt: '2026-07-16T00:00:00.000Z',
        },
        snapshot: snapshot(),
        refreshing: false,
      },
    },
  });
  return render(<PublishToGiteaDialog />);
}

const CONNECTED: GiteaStatus = {
  configured: true,
  authenticated: true,
  hostUrl: 'https://gitea.example.com',
  account: 'ana',
};

describe('PublishToGiteaDialog', () => {
  it('asks for the instance URL and a token before it will publish', async () => {
    mountDialog({
      getStatus: vi.fn().mockResolvedValue({ configured: false, authenticated: false }),
      connect: vi.fn(),
    });

    await screen.findByLabelText('Gitea instance URL');
    expect(screen.getByLabelText('Gitea personal access token')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish repository' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect' }).hasAttribute('disabled')).toBe(true);
  });

  it('connects with the entered host and token, then shows the publish form', async () => {
    const connect = vi.fn().mockResolvedValue(CONNECTED);
    mountDialog({
      getStatus: vi.fn().mockResolvedValue({ configured: false, authenticated: false }),
      connect,
    });

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Gitea instance URL'), 'https://gitea.example.com');
    await user.type(screen.getByLabelText('Gitea personal access token'), 'tok123');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(connect).toHaveBeenCalledWith({
      hostUrl: 'https://gitea.example.com',
      token: 'tok123',
    });
    await screen.findByLabelText('Gitea repository name');
    expect(screen.getByRole('button', { name: 'Publish repository' })).toBeTruthy();
  });

  it('seeds the repository name from the project and the owner from the account', async () => {
    mountDialog({ getStatus: vi.fn().mockResolvedValue(CONNECTED) });

    const repositoryName = (await screen.findByLabelText(
      'Gitea repository name'
    )) as HTMLInputElement;
    expect(repositoryName.value).toBe('My-Project');
    expect((screen.getByLabelText('Gitea owner or organisation') as HTMLInputElement).value).toBe(
      'ana'
    );
  });

  it('explains a stored-but-unusable connection instead of failing at publish time', async () => {
    mountDialog({
      getStatus: vi.fn().mockResolvedValue({
        configured: true,
        authenticated: false,
        hostUrl: 'https://gitea.example.com',
        error: 'The access token was rejected by this Gitea instance.',
      }),
      connect: vi.fn(),
    });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('token was rejected')
    );
    // Back to the connect step, with the host prefilled so only the token is re-entered.
    expect((screen.getByLabelText('Gitea instance URL') as HTMLInputElement).value).toBe(
      'https://gitea.example.com'
    );
  });
});
