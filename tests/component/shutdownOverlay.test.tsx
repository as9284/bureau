import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useAppStore } from '@renderer/store/appStore';
import { ShutdownOverlay } from '@renderer/components/ShutdownOverlay';

beforeEach(() => {
  useAppStore.setState({ shutdown: null });
});
afterEach(cleanup);

describe('ShutdownOverlay', () => {
  it('renders nothing when not shutting down', () => {
    render(<ShutdownOverlay />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('lists the processes being stopped with a running count', () => {
    useAppStore.setState({
      shutdown: {
        items: [
          { projectId: 'p1', processId: 'dev', label: 'dev server', done: false },
          { projectId: 'p1', processId: 'api', label: 'api', done: false },
        ],
      },
    });
    render(<ShutdownOverlay />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Shutting down')).toBeInTheDocument();
    expect(screen.getByText(/Stopping 2 running processes/)).toBeInTheDocument();
    expect(screen.getByText('dev server')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
  });

  it('switches to the closing state once every process has stopped', () => {
    useAppStore.setState({
      shutdown: {
        items: [{ projectId: 'p1', processId: 'dev', label: 'dev server', done: true }],
      },
    });
    render(<ShutdownOverlay />);
    expect(screen.getByText('Closing Bureau')).toBeInTheDocument();
    expect(screen.getByText('All processes stopped.')).toBeInTheDocument();
    expect(screen.getByText('stopped')).toBeInTheDocument();
  });
});
