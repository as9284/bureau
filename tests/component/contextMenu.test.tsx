import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@renderer/store/appStore';
import { ContextMenu } from '@renderer/components/ContextMenu';

beforeEach(() => {
  useAppStore.setState({ contextMenu: null });
});
afterEach(cleanup);

describe('ContextMenu', () => {
  it('renders nothing when closed', () => {
    render(<ContextMenu />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders items and fires the selected action, then closes', async () => {
    const onOpen = vi.fn();
    useAppStore.getState().openContextMenu({
      x: 40,
      y: 40,
      items: [
        { type: 'item', label: 'Open', onSelect: onOpen },
        { type: 'separator' },
        { type: 'item', label: 'Remove project', danger: true, onSelect: () => undefined },
      ],
    });
    render(<ContextMenu />);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove project' })).toHaveClass('danger');

    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(useAppStore.getState().contextMenu).toBeNull();
  });

  it('respects disabled items', () => {
    useAppStore.getState().openContextMenu({
      x: 10,
      y: 10,
      items: [{ type: 'item', label: 'Paste', onSelect: () => undefined, disabled: true }],
    });
    render(<ContextMenu />);
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeDisabled();
  });
});

describe('primary workspace navigation', () => {
  it('backToHub returns to the hub and clears selection', () => {
    useAppStore.setState({
      view: 'project',
      selectedProjectId: 'proj-1',
      primaryWorkspace: 'projects',
      projectsReturnView: 'project',
    });
    useAppStore.getState().backToHub();
    const state = useAppStore.getState();
    expect(state.view).toBe('hub');
    expect(state.selectedProjectId).toBeNull();
    expect(state.primaryWorkspace).toBe('projects');
    expect(state.projectsReturnView).toBe('hub');
  });

  it('setPrimaryWorkspace("api") opens the API workspace without clearing the project', () => {
    useAppStore.setState({
      view: 'project',
      selectedProjectId: 'proj-1',
      primaryWorkspace: 'projects',
      projectsReturnView: 'project',
    });
    useAppStore.getState().setPrimaryWorkspace('api');
    const state = useAppStore.getState();
    expect(state.view).toBe('api');
    expect(state.primaryWorkspace).toBe('api');
    expect(state.selectedProjectId).toBe('proj-1');
  });

  it('setPrimaryWorkspace("projects") restores the previous project destination', () => {
    useAppStore.setState({
      view: 'api',
      selectedProjectId: 'proj-1',
      primaryWorkspace: 'api',
      projectsReturnView: 'project',
    });
    useAppStore.getState().setPrimaryWorkspace('projects');
    const state = useAppStore.getState();
    expect(state.view).toBe('project');
    expect(state.selectedProjectId).toBe('proj-1');
    expect(state.primaryWorkspace).toBe('projects');
  });

  it('openSettings remembers the prior view and closeSettings restores it', () => {
    useAppStore.setState({
      view: 'api',
      primaryWorkspace: 'api',
      settingsReturnView: 'hub',
    });
    useAppStore.getState().openSettings('api');
    expect(useAppStore.getState().view).toBe('settings');
    expect(useAppStore.getState().settingsSection).toBe('api');
    expect(useAppStore.getState().settingsReturnView).toBe('api');

    useAppStore.getState().closeSettings();
    expect(useAppStore.getState().view).toBe('api');
    expect(useAppStore.getState().primaryWorkspace).toBe('api');
  });
});
