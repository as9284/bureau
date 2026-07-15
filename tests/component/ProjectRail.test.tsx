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
    configPresent: false,
  },
  {
    projectId: 'project-two',
    name: 'unavailable-project',
    path: 'C:\\missing',
    canonicalPath: 'c:\\missing',
    stack: [],
    addedAt: new Date().toISOString(),
    configPresent: false,
    missing: true,
  },
];

beforeEach(() => {
  useAppStore.setState({
    projects: PROJECTS,
    activeSection: 'projects',
    view: 'hub',
    selectedProjectId: null,
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
        expect.objectContaining({ type: 'item', label: 'Remove project', danger: true }),
      ])
    );
  });
});
