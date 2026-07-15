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

describe('projects navigation', () => {
  it('setSection("projects") always returns to the hub and clears selection', () => {
    useAppStore.setState({
      view: 'project',
      selectedProjectId: 'proj-1',
      activeSection: 'projects',
    });
    useAppStore.getState().setSection('projects');
    const state = useAppStore.getState();
    expect(state.view).toBe('hub');
    expect(state.selectedProjectId).toBeNull();
  });
});
