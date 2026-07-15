import { useAppStore, type SettingsSection } from '../store/appStore';
import { IconButton } from '../components/IconButton';
import { PlusIcon } from '../components/icons';

const SETTINGS_NAV: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'tools', label: 'Editors & Terminals' },
  { id: 'toolchains', label: 'Toolchains' },
  { id: 'files', label: 'Files' },
  { id: 'git', label: 'Git' },
  { id: 'android', label: 'Android' },
];

export function Sidebar() {
  const activeSection = useAppStore((s) => s.activeSection);
  const settingsSection = useAppStore((s) => s.settingsSection);
  const setSettingsSection = useAppStore((s) => s.setSettingsSection);
  const projects = useAppStore((s) => s.projects);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectProject = useAppStore((s) => s.selectProject);
  const openAddDialog = useAppStore((s) => s.openAddDialog);
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const removeProject = useAppStore((s) => s.removeProject);

  if (activeSection === 'settings') {
    return (
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Settings</h2>
        </div>
        <div className="sidebar-body">
          {SETTINGS_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={['sidebar-row', settingsSection === item.id ? 'active' : ''].join(' ')}
              aria-current={settingsSection === item.id ? 'page' : undefined}
              onClick={() => setSettingsSection(item.id)}
            >
              <span className="label">{item.label}</span>
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Projects</h2>
        <div className="sidebar-header__actions">
          <span className="sidebar-header__meta">{projects.length}</span>
          <IconButton label="Add project" onClick={() => void openAddDialog()}>
            <PlusIcon size={16} />
          </IconButton>
        </div>
      </div>
      <div className="sidebar-body">
        {projects.length === 0 ? (
          <p className="sidebar-empty">
            No projects yet. Add one to start managing its processes and previews.
          </p>
        ) : (
          projects.map((project) => (
            <button
              key={project.projectId}
              type="button"
              className={[
                'sidebar-row',
                selectedProjectId === project.projectId ? 'active' : '',
              ].join(' ')}
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
              <span className="label">{project.name}</span>
              {project.missing && <span className="sidebar-row__flag">!</span>}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
