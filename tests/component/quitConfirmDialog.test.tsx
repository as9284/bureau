import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@renderer/store/appStore';
import { QuitConfirmDialog } from '@renderer/components/QuitConfirmDialog';

const confirmQuit = vi.fn().mockResolvedValue(undefined);
const cancelQuit = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  confirmQuit.mockClear();
  cancelQuit.mockClear();
  (window as unknown as { bureau: unknown }).bureau = { app: { confirmQuit, cancelQuit } };
  useAppStore.setState({ closePrompt: null });
});
afterEach(cleanup);

describe('QuitConfirmDialog', () => {
  it('renders nothing when there is no pending close', () => {
    render(<QuitConfirmDialog />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('lists the running processes and quits gracefully on confirm', async () => {
    useAppStore.setState({
      closePrompt: {
        processes: [
          { projectId: 'p1', processId: 'dev', label: 'dev server' },
          { projectId: 'p1', processId: 'api', label: 'api' },
        ],
      },
    });
    render(<QuitConfirmDialog />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/2 processes are still running/)).toBeInTheDocument();
    expect(screen.getByText('dev server')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /End all/ }));
    expect(confirmQuit).toHaveBeenCalledOnce();
    expect(useAppStore.getState().closePrompt).toBeNull();
  });

  it('aborts the close on cancel', async () => {
    useAppStore.setState({
      closePrompt: { processes: [{ projectId: 'p1', processId: 'dev', label: 'dev' }] },
    });
    render(<QuitConfirmDialog />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelQuit).toHaveBeenCalledOnce();
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(useAppStore.getState().closePrompt).toBeNull();
  });
});
