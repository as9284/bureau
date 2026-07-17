import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { ProjectOverview } from '../features/overview/ProjectOverview';
import { ProcessesTab } from '../features/processes/ProcessesTab';
import { TerminalTab } from '../features/terminal/TerminalTab';
import { PreviewTab } from '../features/preview/PreviewTab';
import { AndroidPanel } from '../features/android/AndroidPanel';
import { GitTab } from '../features/git/GitTab';
import { FilesTab } from '../features/files/FilesTab';
import { orderProjectTabs, PROJECT_TAB_LABELS } from '../lib/projectTabs';
import { PROJECT_TAB_IDS, type ProjectTabId } from '@shared/contracts/settings';

const KNOWN_TABS = new Set<ProjectTabId>(PROJECT_TAB_IDS);

export function ProjectWorkspace() {
  const projectId = useAppStore((s) => s.selectedProjectId);
  const project = useAppStore((s) => s.projects.find((p) => p.projectId === s.selectedProjectId));
  const projectTab = useAppStore((s) => s.projectTab);
  const setProjectTab = useAppStore((s) => s.setProjectTab);
  const tabOrder = useAppStore((s) => s.settings?.appearance.projectTabOrder);

  const tabs = orderProjectTabs(tabOrder);
  const activeTab = KNOWN_TABS.has(projectTab) ? projectTab : 'overview';

  // Sessions that still hold a removed tab id (Toolchains/Ports) land on Overview.
  useEffect(() => {
    if (!KNOWN_TABS.has(projectTab)) setProjectTab('overview');
  }, [projectTab, setProjectTab]);

  if (!projectId || !project) return null;

  return (
    <div className="workspace-view">
      <div className="workspace-tabstrip">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            className={['workspace-tab', activeTab === id ? 'active' : ''].join(' ')}
            aria-current={activeTab === id ? 'page' : undefined}
            onClick={() => setProjectTab(id)}
          >
            {PROJECT_TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="workspace-body">
        {activeTab === 'overview' && <ProjectOverview projectId={projectId} />}
        {activeTab === 'files' && <FilesTab projectId={projectId} />}
        {activeTab === 'processes' && <ProcessesTab projectId={projectId} />}
        {activeTab === 'terminal' && <TerminalTab projectId={projectId} />}
        {activeTab === 'preview' && <PreviewTab />}
        {activeTab === 'android' && <AndroidPanel key={projectId} projectId={projectId} />}
        {activeTab === 'git' && <GitTab projectId={projectId} />}
      </div>
    </div>
  );
}
