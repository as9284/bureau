import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectRail } from '@renderer/layout/ProjectRail';
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
    // Preloaded so the rail's process-warming effect skips the IPC call.
    processesByProject: {
      'project-one': { definitions: [], runtimes: [] },
      'project-two': { definitions: [], runtimes: [] },
    },
    activeSection: 'projects',
    view: 'hub',
    selectedProjectId: null,
    projectQuery: '',
    contextMenu: null,
  });
});

afterEach(cleanup);

describe('ProjectRail', () => {
  it('combines project navigation, add action, and settings without a project counter', () => {
    render(<ProjectRail />);

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.queryByLabelText('2 projects')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add project' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'bureau' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project unavailable')).toBeInTheDocument();
  });

  it('marks only the selected project as current inside a project workspace', () => {
    useAppStore.setState({ view: 'project', selectedProjectId: 'project-one' });
    render(<ProjectRail />);

    expect(screen.getByRole('button', { name: 'bureau' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Projects' })).not.toHaveAttribute('aria-current');
  });

  it('opens settings without a secondary sidebar', async () => {
    render(<ProjectRail />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Settings' }));

    expect(useAppStore.getState()).toMatchObject({
      activeSection: 'settings',
      view: 'settings',
    });
  });

  it('retains project actions in the context menu', () => {
    render(<ProjectRail />);

    fireEvent.contextMenu(screen.getByRole('button', { name: 'bureau' }), {
      clientX: 20,
      clientY: 30,
    });

    const items = useAppStore.getState().contextMenu?.items ?? [];
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'item', label: 'Open' }),
        expect.objectContaining({ type: 'item', label: 'Pin to top' }),
        expect.objectContaining({ type: 'item', label: 'Remove project', danger: true }),
      ])
    );
  });

  it('splits pinned projects into their own icon-marked group with a reorder + unpin affordance', () => {
    useAppStore.setState({
      projects: [
        { ...PROJECTS[0], pinned: true, pinnedRank: 0 },
        PROJECTS[1],
      ],
    });
    render(<ProjectRail />);

    expect(screen.getByRole('group', { name: 'Pinned' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Recent' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin project' })).toBeInTheDocument();
  });

  it('shows a running status dot for a project with live processes', () => {
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
    render(<ProjectRail />);

    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument();
  });

  it('filters the list via the search field', async () => {
    render(<ProjectRail />);

    await userEvent.setup().type(screen.getByLabelText('Filter projects'), 'bureau');

    expect(screen.getByRole('button', { name: 'bureau' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'unavailable-project' })).not.toBeInTheDocument();
  });

  it('renders a large project list inside the scroll container without breaking', () => {
    const many: TrackedProject[] = Array.from({ length: 40 }, (_, i) => ({
      projectId: `bulk-${i}`,
      name: `project-${i}`,
      path: `C:\\p\\${i}`,
      canonicalPath: `c:\\p\\${i}`,
      stack: [],
      addedAt: new Date().toISOString(),
    }));
    useAppStore.setState({
      projects: many,
      processesByProject: Object.fromEntries(
        many.map((p) => [p.projectId, { definitions: [], runtimes: [] }])
      ),
    });
    const { container } = render(<ProjectRail />);

    // The scrollable list container is present and every row rendered.
    expect(container.querySelector('.project-rail__projects')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'project-0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'project-39' })).toBeInTheDocument();
  });
});
