import { useAppStore } from '../store/appStore';
import { ProjectOverview } from '../features/overview/ProjectOverview';
import { ProcessesTab } from '../features/processes/ProcessesTab';
import { TerminalTab } from '../features/terminal/TerminalTab';
import { PreviewTab } from '../features/preview/PreviewTab';
import { AndroidPanel } from '../features/android/AndroidPanel';
import { ToolchainsTab } from '../features/toolchains/ToolchainsTab';
import { PortsTab } from '../features/ports/PortsTab';
import { GitTab } from '../features/git/GitTab';
import { FilesTab } from '../features/files/FilesTab';
import { orderProjectTabs, PROJECT_TAB_LABELS } from '../lib/projectTabs';

export function ProjectWorkspace() {
  const projectId = useAppStore((s) => s.selectedProjectId);
  const project = useAppStore((s) => s.projects.find((p) => p.projectId === s.selectedProjectId));
  const projectTab = useAppStore((s) => s.projectTab);
  const setProjectTab = useAppStore((s) => s.setProjectTab);
  const tabOrder = useAppStore((s) => s.settings?.appearance.projectTabOrder);

  if (!projectId || !project) return null;

  const tabs = orderProjectTabs(tabOrder);

  return (
    <div className="workspace-view">
      <div className="workspace-tabstrip">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            className={['workspace-tab', projectTab === id ? 'active' : ''].join(' ')}
            aria-current={projectTab === id ? 'page' : undefined}
            onClick={() => setProjectTab(id)}
          >
            {PROJECT_TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="workspace-body">
        {projectTab === 'overview' && <ProjectOverview projectId={projectId} />}
        {projectTab === 'files' && <FilesTab projectId={projectId} />}
        {projectTab === 'processes' && <ProcessesTab projectId={projectId} />}
        {projectTab === 'terminal' && <TerminalTab projectId={projectId} />}
        {projectTab === 'preview' && <PreviewTab />}
        {projectTab === 'android' && <AndroidPanel key={projectId} projectId={projectId} />}
        {projectTab === 'toolchains' && <ToolchainsTab projectId={projectId} />}
        {projectTab === 'ports' && <PortsTab projectId={projectId} />}
        {projectTab === 'git' && <GitTab projectId={projectId} />}
      </div>
    </div>
  );
}
