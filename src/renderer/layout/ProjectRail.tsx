import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { IconButton } from '../components/IconButton';
import {
  ClockIcon,
  GearIcon,
  GripIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  StackIcon,
} from '../components/icons';
import { TextField } from '../components/TextField';
import { useAppStore, type ContextMenuItem } from '../store/appStore';
import { groupProjects, movePinned } from '../lib/projectOrder';
import { usePinnedReorder } from '../lib/usePinnedReorder';
import type { TrackedProject } from '@shared/contracts/projects';

function monogram(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export function ProjectRail() {
  const activeSection = useAppStore((s) => s.activeSection);
  const view = useAppStore((s) => s.view);
  const projects = useAppStore((s) => s.projects);
  const projectQuery = useAppStore((s) => s.projectQuery);
  const setProjectQuery = useAppStore((s) => s.setProjectQuery);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const processesByProject = useAppStore((s) => s.processesByProject);
  const loadProcesses = useAppStore((s) => s.loadProcesses);
  const setSection = useAppStore((s) => s.setSection);
  const selectProject = useAppStore((s) => s.selectProject);
  const openAddDialog = useAppStore((s) => s.openAddDialog);
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const removeProject = useAppStore((s) => s.removeProject);
  const setProjectPinned = useAppStore((s) => s.setProjectPinned);
  const reorderPinnedProjects = useAppStore((s) => s.reorderPinnedProjects);

  const projectsHomeActive = activeSection === 'projects' && view === 'hub';

  // Warm each project's process list once so the running dot is accurate
  // regardless of the current view (the hub only warms while it is mounted).
  const warmedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const project of projects) {
      if (warmedRef.current.has(project.projectId)) continue;
      if (processesByProject[project.projectId]) continue;
      warmedRef.current.add(project.projectId);
      void loadProcesses(project.projectId);
    }
  }, [projects, processesByProject, loadProcesses]);

  const grouped = useMemo(() => groupProjects(projects, projectQuery), [projects, projectQuery]);
  const pinnedReorder = usePinnedReorder(grouped.pinned);
  const pinnedIds = grouped.pinned.map((p) => p.projectId);
  const hasPinned = pinnedReorder.order.length > 0;
  const noMatches = grouped.pinned.length === 0 && grouped.recent.length === 0;

  const isRunning = (projectId: string): boolean =>
    (processesByProject[projectId]?.runtimes ?? []).some(
      (r) => r.status === 'running' || r.status === 'starting'
    );

  const buildMenu = (project: TrackedProject) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const pinnedIndex = pinnedIds.indexOf(project.projectId);
    const items: ContextMenuItem[] = [
      { type: 'item', label: 'Open', onSelect: () => void selectProject(project.projectId) },
      { type: 'separator' },
      {
        type: 'item',
        label: project.pinned ? 'Unpin' : 'Pin to top',
        onSelect: () => void setProjectPinned(project.projectId, !project.pinned),
      },
    ];
    if (project.pinned && pinnedIndex > 0) {
      items.push({
        type: 'item',
        label: 'Move up',
        onSelect: () => void reorderPinnedProjects(movePinned(pinnedIds, project.projectId, -1)),
      });
    }
    if (project.pinned && pinnedIndex >= 0 && pinnedIndex < pinnedIds.length - 1) {
      items.push({
        type: 'item',
        label: 'Move down',
        onSelect: () => void reorderPinnedProjects(movePinned(pinnedIds, project.projectId, 1)),
      });
    }
    items.push(
      { type: 'separator' },
      {
        type: 'item',
        label: 'Remove project',
        danger: true,
        onSelect: () => void removeProject(project.projectId),
      }
    );
    openContextMenu({ x: event.clientX, y: event.clientY, items });
  };

  const renderRow = (project: TrackedProject, reorderable: boolean) => {
    const active = activeSection === 'projects' && selectedProjectId === project.projectId;
    const dragging = reorderable && pinnedReorder.draggingId === project.projectId;
    const running = isRunning(project.projectId);
    return (
      <div
        key={project.projectId}
        className={['project-rail__row', dragging ? 'dragging' : ''].filter(Boolean).join(' ')}
        {...(reorderable ? pinnedReorder.itemProps(project.projectId) : {})}
      >
        <button
          type="button"
          className={['project-rail__item', active ? 'active' : ''].filter(Boolean).join(' ')}
          title={project.name}
          aria-current={active ? 'page' : undefined}
          onClick={() => void selectProject(project.projectId)}
          onContextMenu={buildMenu(project)}
        >
          <span className="project-rail__avatar" aria-hidden>
            {monogram(project.name)}
          </span>
          <span className="project-rail__label">{project.name}</span>
          {project.missing ? (
            <span
              className="state-dot warning project-rail__signal"
              role="img"
              aria-label="Project unavailable"
              title="Unavailable"
            />
          ) : running ? (
            <span
              className="state-dot success project-rail__signal"
              role="img"
              aria-label="Running"
              title="Running"
            />
          ) : null}
        </button>
        <div className="project-rail__row-actions">
          {reorderable ? (
            <span
              className="project-rail__grip"
              aria-hidden
              title="Drag to reorder"
              {...pinnedReorder.handleProps(project.projectId)}
            >
              <GripIcon size={12} />
            </span>
          ) : null}
          <IconButton
            className={['project-rail__pin', project.pinned ? 'active' : ''].join(' ')}
            label={project.pinned ? 'Unpin project' : 'Pin project'}
            onClick={(e) => {
              e.stopPropagation();
              void setProjectPinned(project.projectId, !project.pinned);
            }}
          >
            <PinIcon size={12} filled={project.pinned} />
          </IconButton>
        </div>
      </div>
    );
  };

  return (
    <nav className="project-rail" aria-label="Primary navigation">
      <div className="project-rail__header">
        <button
          type="button"
          className={['project-rail__home', projectsHomeActive ? 'active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-current={projectsHomeActive ? 'page' : undefined}
          onClick={() => setSection('projects')}
        >
          <StackIcon size={16} />
          <span>Projects</span>
        </button>
        <IconButton
          className="project-rail__add"
          label="Add project"
          onClick={() => void openAddDialog()}
        >
          <PlusIcon size={16} />
        </IconButton>
      </div>

      {projects.length > 0 ? (
        <div className="project-rail__search">
          <SearchIcon size={13} />
          <TextField
            type="search"
            placeholder="Filter…"
            aria-label="Filter projects"
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
          />
        </div>
      ) : null}

      <div className="project-rail__projects" aria-label="Projects">
        {projects.length === 0 ? (
          <p className="project-rail__empty">No projects yet.</p>
        ) : noMatches ? (
          <p className="project-rail__empty">No matches.</p>
        ) : hasPinned ? (
          <>
            <div className="project-rail__group" role="group" aria-label="Pinned">
              <div className="project-rail__marker" aria-hidden>
                <PinIcon size={12} />
              </div>
              {pinnedReorder.order.map((p) => renderRow(p, true))}
            </div>
            {grouped.recent.length > 0 ? (
              <div className="project-rail__group" role="group" aria-label="Recent">
                <div className="project-rail__marker" aria-hidden>
                  <ClockIcon size={12} />
                </div>
                {grouped.recent.map((p) => renderRow(p, false))}
              </div>
            ) : null}
          </>
        ) : (
          grouped.recent.map((p) => renderRow(p, false))
        )}
      </div>

      <div className="project-rail__footer">
        <button
          type="button"
          className={['project-rail__item', activeSection === 'settings' ? 'active' : '']
            .filter(Boolean)
            .join(' ')}
          aria-current={activeSection === 'settings' ? 'page' : undefined}
          onClick={() => setSection('settings')}
        >
          <GearIcon size={16} />
          <span className="project-rail__label">Settings</span>
        </button>
      </div>
    </nav>
  );
}
