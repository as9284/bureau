import { useAppStore, type ProjectTab } from '../store/appStore';
import { ProjectOverview } from '../features/overview/ProjectOverview';
import { ProcessesTab } from '../features/processes/ProcessesTab';
import { PreviewTab } from '../features/preview/PreviewTab';
import { AndroidPanel } from '../features/android/AndroidPanel';
import { ToolchainsTab } from '../features/toolchains/ToolchainsTab';
import { PortsTab } from '../features/ports/PortsTab';
import { GitTab } from '../features/git/GitTab';
import { FilesTab } from '../features/files/FilesTab';

const TABS: Array<{ id: ProjectTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'files', label: 'Files' },
  { id: 'processes', label: 'Processes' },
  { id: 'preview', label: 'Preview' },
  { id: 'android', label: 'Android' },
  { id: 'toolchains', label: 'Toolchains' },
  { id: 'ports', label: 'Ports' },
  { id: 'git', label: 'Git' },
];

export function ProjectWorkspace() {
  const projectId = useAppStore((s) => s.selectedProjectId);
  const project = useAppStore((s) => s.projects.find((p) => p.projectId === s.selectedProjectId));
  const projectTab = useAppStore((s) => s.projectTab);
  const setProjectTab = useAppStore((s) => s.setProjectTab);

  if (!projectId || !project) return null;

  return (
    <div className="workspace-view">
      <div className="workspace-tabstrip">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={['workspace-tab', projectTab === tab.id ? 'active' : ''].join(' ')}
            aria-current={projectTab === tab.id ? 'page' : undefined}
            onClick={() => setProjectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="workspace-body">
        {projectTab === 'overview' && <ProjectOverview projectId={projectId} />}
        {projectTab === 'files' && <FilesTab projectId={projectId} />}
        {projectTab === 'processes' && <ProcessesTab projectId={projectId} />}
        {projectTab === 'preview' && <PreviewTab />}
        {projectTab === 'android' && <AndroidPanel key={projectId} projectId={projectId} />}
        {projectTab === 'toolchains' && <ToolchainsTab projectId={projectId} />}
        {projectTab === 'ports' && <PortsTab projectId={projectId} />}
        {projectTab === 'git' && <GitTab projectId={projectId} />}
      </div>
    </div>
  );
}
