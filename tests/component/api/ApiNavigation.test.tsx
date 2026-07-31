import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiNavButton } from '@renderer/layout/ApiNavButton';
import { ApiWorkspace } from '@renderer/features/api/ApiWorkspace';
import { useAppStore } from '@renderer/store/appStore';
import { useApiStore } from '@renderer/store/apiStore';

beforeEach(() => {
  useAppStore.setState({
    view: 'hub',
    primaryWorkspace: 'projects',
    projectsReturnView: 'hub',
    settingsReturnView: 'hub',
    selectedProjectId: null,
  });
  useApiStore.getState().reset();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'bureau');
  vi.restoreAllMocks();
});

describe('ApiNavButton', () => {
  it('toggles between the API workspace and the last Projects destination', async () => {
    render(<ApiNavButton />);
    const api = screen.getByRole('button', { name: 'API' });
    expect(api).not.toHaveAttribute('aria-current');

    await userEvent.setup().click(api);
    expect(useAppStore.getState().view).toBe('api');
    expect(useAppStore.getState().primaryWorkspace).toBe('api');
    expect(screen.getByRole('button', { name: 'API' })).toHaveAttribute('aria-current', 'page');

    // Clicking again returns to Projects rather than re-entering API.
    await userEvent.setup().click(screen.getByRole('button', { name: 'API' }));
    expect(useAppStore.getState().view).toBe('hub');
    expect(useAppStore.getState().primaryWorkspace).toBe('projects');
  });

  it('returns to the previously selected project, not the hub', async () => {
    useAppStore.setState({
      view: 'project',
      primaryWorkspace: 'projects',
      projectsReturnView: 'project',
      selectedProjectId: 'proj-1',
    });
    render(<ApiNavButton />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'API' }));
    expect(useAppStore.getState().view).toBe('api');
    // The project selection survives the round trip.
    expect(useAppStore.getState().selectedProjectId).toBe('proj-1');

    await user.click(screen.getByRole('button', { name: 'API' }));
    expect(useAppStore.getState().view).toBe('project');
    expect(useAppStore.getState().selectedProjectId).toBe('proj-1');
  });

  it('stays highlighted while Settings is open over the API workspace', async () => {
    render(<ApiNavButton />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'API' }));

    useAppStore.getState().openSettings();
    expect(useAppStore.getState().view).toBe('settings');
    expect(screen.getByRole('button', { name: 'API' })).toHaveAttribute('aria-current', 'page');

    // Closing Settings restores API, not Projects.
    useAppStore.getState().closeSettings();
    expect(useAppStore.getState().view).toBe('api');
  });
});

describe('ApiWorkspace', () => {
  it('shows the empty state when main returns no workspaces', async () => {
    const createWorkspace = vi.fn().mockResolvedValue({ ok: true, workspaceId: 'ws-1' });
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: {
        api: {
          getStatus: vi.fn().mockResolvedValue({ ready: true }),
          listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [] }),
          createWorkspace,
        },
      },
    });

    render(<ApiWorkspace />);
    await waitFor(() => {
      expect(screen.getByText('No API workspaces yet')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Create workspace' })).toBeInTheDocument();
  });

  it('shows an error banner with retry when list fails', async () => {
    const listWorkspaces = vi
      .fn()
      .mockRejectedValueOnce({
        code: 'COMMAND_FAILED',
        message: 'boom',
        operation: 'api.listWorkspaces',
        retryable: true,
      })
      .mockResolvedValueOnce({ workspaces: [] });
    Object.defineProperty(window, 'bureau', {
      configurable: true,
      value: {
        api: {
          getStatus: vi.fn().mockResolvedValue({ ready: true }),
          listWorkspaces,
        },
      },
    });

    render(<ApiWorkspace />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByText('No API workspaces yet')).toBeInTheDocument();
    });
    expect(listWorkspaces).toHaveBeenCalledTimes(2);
  });
});
