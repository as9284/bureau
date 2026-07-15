import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useAppStore } from '@renderer/store/appStore';
import { ProcessRow } from '@renderer/features/processes/ProcessRow';
import type { ProcessDefinition } from '@shared/contracts/projects';
import type { ProcessRuntime } from '@shared/contracts/processes';

const def: ProcessDefinition = {
  id: 'srv',
  label: 'Test server',
  command: 'pnpm',
  args: ['run', 'dev'],
  cwd: '.',
  env: {},
  runMode: 'log',
  autoRestart: false,
  runOnOpen: false,
};

function seed(runtime?: ProcessRuntime): void {
  useAppStore.setState({
    processesByProject: {
      p1: { definitions: [def], runtimes: runtime ? [runtime] : [] },
    },
    logsByProject: {},
    pendingProcesses: {},
    expandedProcess: null,
  });
}

beforeEach(() => seed());
afterEach(cleanup);

describe('ProcessRow', () => {
  it('renders an idle process with a Start control', () => {
    render(<ProcessRow projectId="p1" definition={def} />);
    expect(screen.getByText('Test server')).toBeInTheDocument();
    expect(screen.getByText('pnpm run dev')).toBeInTheDocument();
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('renders a running process with its URL and a Stop control', () => {
    seed({
      projectId: 'p1',
      processId: 'srv',
      status: 'running',
      pid: 4242,
      restartCount: 0,
      ready: true,
      detectedUrl: 'http://localhost:3000',
    });
    render(<ProcessRow projectId="p1" definition={def} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3000')).toBeInTheDocument();
    expect(screen.getByText('PID 4242')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('shows an in-flight stopping state with a disabled control while a stop is pending', () => {
    seed({
      projectId: 'p1',
      processId: 'srv',
      status: 'running',
      pid: 4242,
      restartCount: 0,
      ready: true,
    });
    useAppStore.setState({ pendingProcesses: { 'p1:srv': 'stopping' } });
    render(<ProcessRow projectId="p1" definition={def} />);
    expect(screen.getByText('Stopping…')).toBeInTheDocument();
    // The Stop control is replaced by a disabled "Working…" spinner button.
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    // The PID is suppressed while the transient state is showing.
    expect(screen.queryByText('PID 4242')).not.toBeInTheDocument();
  });

  it('shows the exit code for a crashed process', () => {
    seed({
      projectId: 'p1',
      processId: 'srv',
      status: 'crashed',
      restartCount: 0,
      ready: false,
      exitCode: 1,
    });
    render(<ProcessRow projectId="p1" definition={def} />);
    expect(screen.getByText('Crashed')).toBeInTheDocument();
    expect(screen.getByText('exit 1')).toBeInTheDocument();
  });

  it('gives an expanded process log a standardized resize handle', () => {
    useAppStore.setState({ expandedProcess: 'p1:srv' });
    render(<ProcessRow projectId="p1" definition={def} />);
    const separator = screen.getByRole('separator', { name: 'Resize Test server process log' });
    expect(separator).toHaveAttribute('aria-valuemin', '140');
    expect(separator).toHaveAttribute('aria-valuemax', '640');
  });
});
