import { IconButton } from '../components/IconButton';
import { GearIcon, PlusIcon, StackIcon } from '../components/icons';
import { useAppStore } from '../store/appStore';

export function ProjectRail() {
  const activeSection = useAppStore((s) => s.activeSection);
  const view = useAppStore((s) => s.view);
  const projects = useAppStore((s) => s.projects);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setSection = useAppStore((s) => s.setSection);
  const selectProject = useAppStore((s) => s.selectProject);
  const openAddDialog = useAppStore((s) => s.openAddDialog);
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const removeProject = useAppStore((s) => s.removeProject);

  const projectsHomeActive = activeSection === 'projects' && view === 'hub';

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

      <div className="project-rail__projects" aria-label="Projects">
        {projects.length === 0 ? (
          <p className="project-rail__empty">No projects yet.</p>
        ) : (
          projects.map((project) => {
            const active = activeSection === 'projects' && selectedProjectId === project.projectId;
            return (
              <button
                key={project.projectId}
                type="button"
                className={['project-rail__item', active ? 'active' : ''].filter(Boolean).join(' ')}
                title={project.name}
                aria-current={active ? 'page' : undefined}
                onClick={() => void selectProject(project.projectId)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  openContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    items: [
                      {
                        type: 'item',
                        label: 'Open',
                        onSelect: () => void selectProject(project.projectId),
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
                <span className="project-rail__label">{project.name}</span>
                {project.missing ? (
                  <span className="project-rail__flag" aria-label="Project unavailable">
                    !
                  </span>
                ) : null}
              </button>
            );
          })
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
