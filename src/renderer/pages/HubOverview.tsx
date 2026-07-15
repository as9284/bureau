import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { ensureGitProject, useGitStore } from '../store/gitStore';
import { Button } from '../components/Button';
import { StackBadge } from '../components/StackBadge';
import { IconButton } from '../components/IconButton';
import { FolderPlusIcon, StackIcon, TrashIcon } from '../components/icons';
import { formatRelativeTime } from '../lib/format';
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
  const openAddDialog = useAppStore((s) => s.openAddDialog);
  const selectProject = useAppStore((s) => s.selectProject);
  const setProjectTab = useAppStore((s) => s.setProjectTab);
  const removeProject = useAppStore((s) => s.removeProject);
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

  const openGitTab = (projectId: string) => {
    void selectProject(projectId);
    setProjectTab('git');
  };

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

      <div className="project-grid">
        {projects.map((project) => {
          const runtimes = processesByProject[project.projectId]?.runtimes ?? [];
          const running = runtimes.filter(
            (r) => r.status === 'running' || r.status === 'starting'
          ).length;
          const gitRepo = gitRepos[project.projectId];
          const snap = gitRepo?.snapshot;
          const level = getAttentionLevel({ snapshot: snap, error: gitRepo?.error });
          const attentionLabel = formatAttentionLabel({ level, snapshot: snap });

          return (
            <div
              key={project.projectId}
              className={['project-card', project.missing ? 'missing' : ''].join(' ')}
              role="button"
              tabIndex={0}
              onClick={() => void selectProject(project.projectId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void selectProject(project.projectId);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    {
                      type: 'item',
                      label: 'Open',
                      onSelect: () => void selectProject(project.projectId),
                    },
                    {
                      type: 'item',
                      label: 'Open Git tab',
                      onSelect: () => openGitTab(project.projectId),
                    },
                    { type: 'separator' },
                    {
                      type: 'item',
                      label: 'Clone repository',
                      onSelect: () => setCloneDialogOpen(true),
                    },
                    {
                      type: 'item',
                      label: 'Init repository',
                      onSelect: () => setInitDialogOpen(true),
                    },
                    { type: 'separator' },
                    {
                      type: 'item',
                      label: 'Remove project',
                      danger: true,
                      onSelect: () => void removeProject(project.projectId),
                    },
                  ],
                });
              }}
            >
              <div className="project-card__top">
                <span className="project-card__name">{project.name}</span>
                <IconButton
                  label="Remove project"
                  className="project-card__remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeProject(project.projectId);
                  }}
                >
                  <TrashIcon size={14} />
                </IconButton>
              </div>
              <div className="project-card__path mono">{project.path}</div>
              <div className="project-card__badges">
                {project.stack.map((s) => (
                  <StackBadge key={s} stack={s} />
                ))}
                {project.missing && <span className="stack-badge danger">Missing</span>}
                {snap ? (
                  <span className={attentionBadgeClass(level)}>{attentionLabel}</span>
                ) : gitRepo?.refreshing ? (
                  <span className="stack-badge">Refreshing…</span>
                ) : null}
              </div>
              <div className="project-card__foot mono">
                <span>{running > 0 ? `${running} running` : 'idle'}</span>
                <span>{formatRelativeTime(project.lastOpenedAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
