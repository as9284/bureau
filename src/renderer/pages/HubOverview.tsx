import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useAppStore } from '../store/appStore';
import { ensureGitProject, useGitStore } from '../store/gitStore';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { FolderPlusIcon, SearchIcon, StackIcon } from '../components/icons';
import { ProjectCard } from '../features/projects/ProjectCard';
import { groupProjects, movePinned } from '../lib/projectOrder';
import { usePinnedReorder } from '../lib/usePinnedReorder';
import type { TrackedProject } from '@shared/contracts/projects';
import type { ContextMenuItem } from '../store/appStore';
import {
  formatAttentionLabel,
  getAttentionLevel,
  type AttentionLevel,
} from '../lib/attention';

function attentionBadgeClass(level: AttentionLevel): string {
  switch (level) {
    case 'blocked':
    case 'failedNoSnapshot':
      return 'stack-badge danger';
    case 'unavailable':
    case 'stale':
      return 'stack-badge warning';
    case 'diverged':
    case 'behind':
      return 'stack-badge warning';
    case 'changed':
    case 'ahead':
      return 'stack-badge info';
    default:
      return 'stack-badge success';
  }
}

export function HubOverview() {
  const projects = useAppStore((s) => s.projects);
  const projectQuery = useAppStore((s) => s.projectQuery);
  const setProjectQuery = useAppStore((s) => s.setProjectQuery);
  const openAddDialog = useAppStore((s) => s.openAddDialog);
  const selectProject = useAppStore((s) => s.selectProject);
  const setProjectTab = useAppStore((s) => s.setProjectTab);
  const removeProject = useAppStore((s) => s.removeProject);
  const setProjectPinned = useAppStore((s) => s.setProjectPinned);
  const reorderPinnedProjects = useAppStore((s) => s.reorderPinnedProjects);
  const loadProcesses = useAppStore((s) => s.loadProcesses);
  const processesByProject = useAppStore((s) => s.processesByProject);
  const openContextMenu = useAppStore((s) => s.openContextMenu);

  const gitRepos = useGitStore((s) => s.repos);
  const refreshRepo = useGitStore((s) => s.refreshRepo);
  const setCloneDialogOpen = useGitStore((s) => s.setCloneDialogOpen);
  const setInitDialogOpen = useGitStore((s) => s.setInitDialogOpen);
  const warmedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const project of projects) {
      ensureGitProject({
        projectId: project.projectId,
        path: project.path,
        name: project.name,
      });
      if (!warmedRef.current.has(project.projectId)) {
        warmedRef.current.add(project.projectId);
        void refreshRepo(project.projectId);
      }
      if (!processesByProject[project.projectId]) void loadProcesses(project.projectId);
    }
  }, [projects, processesByProject, loadProcesses, refreshRepo]);

  const grouped = useMemo(() => groupProjects(projects, projectQuery), [projects, projectQuery]);
  const pinnedReorder = usePinnedReorder(grouped.pinned);
  const pinnedIds = grouped.pinned.map((p) => p.projectId);

  const openGitTab = (projectId: string) => {
    void selectProject(projectId);
    setProjectTab('git');
  };

  const runningCount = (projectId: string): number =>
    (processesByProject[projectId]?.runtimes ?? []).filter(
      (r) => r.status === 'running' || r.status === 'starting'
    ).length;

  const gitBadgeFor = (project: TrackedProject): { className: string; label: string } | null => {
    const gitRepo = gitRepos[project.projectId];
    const snap = gitRepo?.snapshot;
    if (!snap) return null;
    const level = getAttentionLevel({ snapshot: snap, error: gitRepo?.error });
    return { className: attentionBadgeClass(level), label: formatAttentionLabel({ level, snapshot: snap }) };
  };

  const buildMenu = (project: TrackedProject) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const pinnedIndex = pinnedIds.indexOf(project.projectId);
    const items: ContextMenuItem[] = [
      { type: 'item', label: 'Open', onSelect: () => void selectProject(project.projectId) },
      { type: 'item', label: 'Open Git tab', onSelect: () => openGitTab(project.projectId) },
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
      { type: 'item', label: 'Clone repository', onSelect: () => setCloneDialogOpen(true) },
      { type: 'item', label: 'Init repository', onSelect: () => setInitDialogOpen(true) },
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

  const renderCard = (project: TrackedProject, reorderable: boolean) => (
    <ProjectCard
      key={project.projectId}
      project={project}
      running={runningCount(project.projectId)}
      gitBadge={gitBadgeFor(project)}
      refreshing={Boolean(gitRepos[project.projectId]?.refreshing)}
      onOpen={() => void selectProject(project.projectId)}
      onRemove={() => void removeProject(project.projectId)}
      onTogglePin={() => void setProjectPinned(project.projectId, !project.pinned)}
      onContextMenu={buildMenu(project)}
      dragHandleProps={reorderable ? pinnedReorder.handleProps(project.projectId) : undefined}
      dropProps={reorderable ? pinnedReorder.itemProps(project.projectId) : undefined}
      dragging={reorderable && pinnedReorder.draggingId === project.projectId}
    />
  );

  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state__icon">
          <StackIcon size={40} />
        </span>
        <h1>No projects yet</h1>
        <p>
          Bureau is your mission control for development projects. Add a project folder to detect
          its stack and start managing dev servers, previews, and emulators.
        </p>
        <div className="empty-state__actions">
          <Button variant="primary" onClick={() => void openAddDialog()}>
            <FolderPlusIcon size={16} />
            Add a project
          </Button>
          <Button variant="secondary" onClick={() => setCloneDialogOpen(true)}>
            Clone repository
          </Button>
          <Button variant="secondary" onClick={() => setInitDialogOpen(true)}>
            Init repository
          </Button>
        </div>
      </div>
    );
  }

  const hasPinned = pinnedReorder.order.length > 0;
  const noMatches = grouped.pinned.length === 0 && grouped.recent.length === 0;

  return (
    <div className="stage-inner">
      <div className="hub-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">{projects.length} tracked</p>
        </div>
        <div className="hub-header__actions">
          <Button variant="secondary" onClick={() => setCloneDialogOpen(true)}>
            Clone repository
          </Button>
          <Button variant="secondary" onClick={() => setInitDialogOpen(true)}>
            Init repository
          </Button>
          <Button variant="primary" onClick={() => void openAddDialog()}>
            <FolderPlusIcon size={16} />
            Add project
          </Button>
        </div>
      </div>

      <div className="hub-toolbar">
        <div className="project-search">
          <SearchIcon size={15} />
          <TextField
            type="search"
            placeholder="Filter projects by name or path…"
            aria-label="Filter projects"
            value={projectQuery}
            onChange={(e) => setProjectQuery(e.target.value)}
          />
        </div>
      </div>

      {noMatches ? (
        <p className="project-list__empty">No projects match “{projectQuery}”.</p>
      ) : (
        <>
          {hasPinned ? (
            <section className="project-section" aria-label="Pinned projects">
              <h2 className="project-section__title">Pinned</h2>
              <div className="project-grid">
                {pinnedReorder.order.map((p) => renderCard(p, true))}
              </div>
            </section>
          ) : null}

          {grouped.recent.length > 0 ? (
            <section className="project-section" aria-label={hasPinned ? 'Recent projects' : 'Projects'}>
              {hasPinned ? <h2 className="project-section__title">Recent</h2> : null}
              <div className="project-grid">{grouped.recent.map((p) => renderCard(p, false))}</div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
