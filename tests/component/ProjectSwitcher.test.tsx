import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectSwitcher } from '@renderer/layout/ProjectSwitcher';
import { useAppStore } from '@renderer/store/appStore';
import type { TrackedProject } from '@shared/contracts/projects';

const PROJECTS: TrackedProject[] = [
  {
    projectId: 'project-one',
    name: 'bureau',
    path: 'C:\\bureau',
    canonicalPath: 'c:\\bureau',
    stack: ['node'],
    addedAt: new Date().toISOString(),
  },
  {
    projectId: 'project-two',
    name: 'unavailable-project',
    path: 'C:\\missing',
    canonicalPath: 'c:\\missing',
    stack: [],
    addedAt: new Date().toISOString(),
    missing: true,
  },
];

beforeEach(() => {
  useAppStore.setState({
    projects: PROJECTS,
    processesByProject: {
      'project-one': { definitions: [], runtimes: [] },
      'project-two': { definitions: [], runtimes: [] },
    },
    primaryWorkspace: 'projects',
    view: 'hub',
    selectedProjectId: null,
    projectQuery: '',
  });
  vi.spyOn(useAppStore.getState(), 'selectProject').mockResolvedValue(undefined);
  vi.spyOn(useAppStore.getState(), 'openAddDialog').mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ProjectSwitcher', () => {
  it('shows Projects on the hub and opens a filterable menu', async () => {
    const user = userEvent.setup();
    render(<ProjectSwitcher />);

    const trigger = screen.getByRole('button', { name: 'Projects' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    const menu = screen.getByRole('listbox', { name: 'Projects' });
    expect(menu).toBeInTheDocument();
    expect(within(menu).getByRole('option', { name: /bureau/i })).toBeInTheDocument();
    expect(within(menu).getByLabelText('Project unavailable')).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Open hub' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Add project…' })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('labels the trigger with the current project name', () => {
    useAppStore.setState({ view: 'project', selectedProjectId: 'project-one' });
    render(<ProjectSwitcher />);

    expect(
      screen.getByRole('button', { name: 'Current project: bureau' })
    ).toBeInTheDocument();
  });

  it('selects a project from the menu', async () => {
    const user = userEvent.setup();
    const selectProject = useAppStore.getState().selectProject;
    render(<ProjectSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.click(screen.getByRole('option', { name: /bureau/i }));

    expect(selectProject).toHaveBeenCalledWith('project-one');
  });

  it('opens settings from the footer', async () => {
    const user = userEvent.setup();
    render(<ProjectSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(useAppStore.getState()).toMatchObject({
      primaryWorkspace: 'projects',
      view: 'settings',
    });
  });

  it('filters projects via the search field', async () => {
    const user = userEvent.setup();
    render(<ProjectSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.type(screen.getByLabelText('Filter projects'), 'bureau');

    expect(screen.getByRole('option', { name: /bureau/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /unavailable-project/i })).not.toBeInTheDocument();
  });

  it('shows a running status for live processes', async () => {
    useAppStore.setState({
      processesByProject: {
        'project-one': {
          definitions: [],
          runtimes: [
            {
              projectId: 'project-one',
              processId: 'dev',
              status: 'running',
              restartCount: 0,
              ready: true,
            },
          ],
        },
        'project-two': { definitions: [], runtimes: [] },
      },
    });
    const user = userEvent.setup();
    render(<ProjectSwitcher />);

    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument();
  });
});
