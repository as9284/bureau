import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@renderer/store/appStore';
import { ProjectOverview } from '@renderer/features/overview/ProjectOverview';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

const snapshot = vi.fn().mockResolvedValue({
  isRepo: true,
  branch: 'main',
  detached: false,
  ahead: 0,
  behind: 0,
  changes: 3,
});
const openInEditor = vi.fn().mockResolvedValue({ ok: true });

beforeEach(() => {
  snapshot.mockClear();
  openInEditor.mockClear();
  (window as unknown as { bureau: unknown }).bureau = {
    git: { snapshot },
    system: {
      openInEditor,
      openInTerminal: vi.fn().mockResolvedValue({ ok: true }),
      openInExplorer: vi.fn().mockResolvedValue({ ok: true }),
    },
    processes: { start: vi.fn().mockResolvedValue({ ok: true }) },
  };
  useAppStore.setState({
    selectedProjectId: PROJECT_ID,
    projects: [
      {
        projectId: PROJECT_ID,
        name: 'as-designer',
        path: 'E:\\Code\\Web Projects\\as-designer',
        canonicalPath: 'e:\\code\\web projects\\as-designer',
        stack: ['git', 'node'],
        addedAt: new Date('2026-07-01').toISOString(),
        lastOpenedAt: new Date('2026-07-14').toISOString(),
        configPresent: true,
      },
    ],
    processesByProject: {
      [PROJECT_ID]: {
        definitions: [
          {
            id: 'dev',
            label: 'dev',
            command: 'npm',
            args: ['run', 'dev'],
            cwd: '.',
            env: {},
            runMode: 'log',
            autoRestart: false,
            runOnOpen: false,
          },
        ],
        runtimes: [],
      },
    },
    gitByProject: {
      [PROJECT_ID]: {
        isRepo: true,
        branch: 'main',
        detached: false,
        ahead: 0,
        behind: 0,
        changes: 3,
      },
    },
    settings: {
      tools: { showOpenInEditor: true, showOpenInTerminal: true, showOpenInExplorer: true },
    } as never,
  });
});

afterEach(cleanup);

describe('ProjectOverview', () => {
  it('renders the hero, action bar, and cards from store state', () => {
    render(<ProjectOverview projectId={PROJECT_ID} />);
    expect(screen.getByRole('heading', { name: 'as-designer', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start all/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Editor/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Terminal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Explorer/ })).toBeInTheDocument();
    // Git card reflects the snapshot.
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('3 changes')).toBeInTheDocument();
    // Details card.
    expect(screen.getByText('.bureau/config.json')).toBeInTheDocument();
  });

  it('invokes the editor launcher when the Editor action is clicked', async () => {
    render(<ProjectOverview projectId={PROJECT_ID} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Editor/ }));
    expect(openInEditor).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  it('hides launcher actions disabled in settings', () => {
    useAppStore.setState({
      settings: {
        tools: { showOpenInEditor: false, showOpenInTerminal: true, showOpenInExplorer: true },
      } as never,
    });
    render(<ProjectOverview projectId={PROJECT_ID} />);
    expect(screen.queryByRole('button', { name: /Editor/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Terminal/ })).toBeInTheDocument();
  });
});
