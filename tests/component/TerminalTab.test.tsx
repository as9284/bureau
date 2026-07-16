import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@renderer/store/appStore';
import { TerminalTab } from '@renderer/features/terminal/TerminalTab';
import type { TerminalSession } from '@shared/contracts/terminal';

// xterm needs a real canvas and ResizeObserver, neither of which jsdom has — and the
// terminal emulator is not ours to test. Stub the surface so these tests cover the tab's
// own chrome: the session strip, the states, and what each control calls.
vi.mock('@renderer/components/XtermSurface', () => ({
  XtermSurface: () => <div data-testid="xterm-surface" />,
}));

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

const SHELLS = [
  { id: 'powershell' as const, label: 'Windows PowerShell', executable: 'powershell.exe' },
  { id: 'git-bash' as const, label: 'Git Bash', executable: 'C:\\Git\\bin\\bash.exe' },
];

function session(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    projectId: PROJECT_ID,
    shellId: 'powershell',
    title: 'Windows PowerShell',
    cwdLabel: '.',
    status: 'running',
    pid: 4242,
    startedAt: new Date('2026-07-16').toISOString(),
    ...overrides,
  };
}

const create = vi.fn();
const close = vi.fn();
const rename = vi.fn();
const list = vi.fn();
const openInTerminalExternal = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ ok: true, session: session({ sessionId: 'new-session' }) });
  close.mockResolvedValue({ ok: true });
  rename.mockResolvedValue({ ok: true, session: session({ title: 'build' }) });
  list.mockResolvedValue({
    projectId: PROJECT_ID,
    sessions: [],
    shells: SHELLS,
    ptyAvailable: true,
  });
  openInTerminalExternal.mockResolvedValue({ ok: true });
  (window as unknown as { bureau: unknown }).bureau = {
    terminal: {
      list,
      create,
      close,
      rename,
      write: vi.fn(),
      resize: vi.fn(),
      getBuffer: vi.fn().mockResolvedValue({ sessionId: '', data: '', seq: 0, truncated: false }),
      onData: vi.fn().mockReturnValue(() => undefined),
      onExit: vi.fn().mockReturnValue(() => undefined),
    },
    system: { openInTerminal: openInTerminalExternal },
  };
  useAppStore.setState({
    selectedProjectId: PROJECT_ID,
    projects: [
      {
        projectId: PROJECT_ID,
        name: 'demo',
        path: 'E:\\demo',
        canonicalPath: 'e:\\demo',
        stack: ['node'],
        addedAt: new Date('2026-07-01').toISOString(),
      },
    ],
    terminalByProject: {},
  });
});

function seed(state: Partial<Parameters<typeof useAppStore.setState>[0]> = {}) {
  useAppStore.setState({
    terminalByProject: {
      [PROJECT_ID]: {
        sessions: [],
        shells: SHELLS,
        ptyAvailable: true,
        activeSessionId: null,
        loading: false,
      },
    },
    ...state,
  });
}

describe('TerminalTab', () => {
  it('shows a loading state before the first snapshot arrives', () => {
    render(<TerminalTab projectId={PROJECT_ID} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('offers to open a session when there are none', async () => {
    seed();
    render(<TerminalTab projectId={PROJECT_ID} />);

    expect(screen.getByText('No terminal sessions')).toBeInTheDocument();
    // Both the header control and the empty state offer this; take the empty state's.
    const buttons = screen.getAllByRole('button', { name: 'New session' });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[1]);

    expect(create).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it('renders a chip and the surface for the active session', () => {
    seed({
      terminalByProject: {
        [PROJECT_ID]: {
          sessions: [session()],
          shells: SHELLS,
          ptyAvailable: true,
          activeSessionId: session().sessionId,
          loading: false,
        },
      },
    });
    render(<TerminalTab projectId={PROJECT_ID} />);

    expect(screen.getByRole('tab', { name: /Windows PowerShell/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('xterm-surface')).toBeInTheDocument();
  });

  it('closes a session from its chip', async () => {
    seed({
      terminalByProject: {
        [PROJECT_ID]: {
          sessions: [session()],
          shells: SHELLS,
          ptyAvailable: true,
          activeSessionId: session().sessionId,
          loading: false,
        },
      },
    });
    render(<TerminalTab projectId={PROJECT_ID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Close Windows PowerShell' }));

    expect(close).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sessionId: session().sessionId,
    });
  });

  it('renames a session on double-click', async () => {
    seed({
      terminalByProject: {
        [PROJECT_ID]: {
          sessions: [session()],
          shells: SHELLS,
          ptyAvailable: true,
          activeSessionId: session().sessionId,
          loading: false,
        },
      },
    });
    render(<TerminalTab projectId={PROJECT_ID} />);

    await userEvent.dblClick(screen.getByRole('tab', { name: /Windows PowerShell/ }));
    const input = screen.getByRole('textbox', { name: 'Rename Windows PowerShell' });
    await userEvent.clear(input);
    await userEvent.type(input, 'build{Enter}');

    expect(rename).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sessionId: session().sessionId,
      title: 'build',
    });
  });

  it('shows an exited session with its exit code instead of dropping it', () => {
    seed({
      terminalByProject: {
        [PROJECT_ID]: {
          sessions: [session({ status: 'exited', exitCode: 130 })],
          shells: SHELLS,
          ptyAvailable: true,
          activeSessionId: session().sessionId,
          loading: false,
        },
      },
    });
    render(<TerminalTab projectId={PROJECT_ID} />);

    expect(screen.getByText('exit 130')).toBeInTheDocument();
  });

  it('degrades to the external terminal when node-pty is unavailable', async () => {
    seed({
      terminalByProject: {
        [PROJECT_ID]: {
          sessions: [],
          shells: SHELLS,
          ptyAvailable: false,
          activeSessionId: null,
          loading: false,
        },
      },
    });
    render(<TerminalTab projectId={PROJECT_ID} />);

    expect(screen.getByText('The built-in terminal is unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open external terminal' }));

    expect(openInTerminalExternal).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    expect(create).not.toHaveBeenCalled();
  });

  it('says so, and disables opening one, when no shell is installed', () => {
    seed({
      terminalByProject: {
        [PROJECT_ID]: {
          sessions: [],
          shells: [],
          ptyAvailable: true,
          activeSessionId: null,
          loading: false,
        },
      },
    });
    render(<TerminalTab projectId={PROJECT_ID} />);

    expect(screen.getByText('No shell found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
  });

  it('shows a non-fatal error banner with a retry', async () => {
    seed({
      terminalByProject: {
        [PROJECT_ID]: {
          sessions: [session()],
          shells: SHELLS,
          ptyAvailable: true,
          activeSessionId: session().sessionId,
          loading: false,
          error: {
            code: 'COMMAND_FAILED',
            message: 'Could not list sessions.',
            operation: 'terminal.list',
            retryable: true,
          },
        },
      },
    });
    render(<TerminalTab projectId={PROJECT_ID} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Could not list sessions.');
    // The pane stays: a failed refresh must not blank a live terminal.
    expect(screen.getByTestId('xterm-surface')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(list).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });
});
