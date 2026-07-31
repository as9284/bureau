import type { MouseEvent } from 'react';
import { useAppStore, type ContextMenuItem } from '../store/appStore';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import { CommandPalette } from './CommandPalette';
import { LiveRegion } from '../components/LiveRegion';
import { ToastStack } from '../components/ToastStack';
import { UpdateNotifier } from '../components/UpdateNotifier';
import { OnboardingOverlay } from '../components/OnboardingOverlay';
import { ContextMenu } from '../components/ContextMenu';
import { ContextMenuProvider as GitContextMenuProvider } from '../components/GitContextMenu';
import { ShutdownOverlay } from '../components/ShutdownOverlay';
import { QuitConfirmDialog } from '../components/QuitConfirmDialog';
import { ProjectRemoveDialog } from '../components/ProjectRemoveDialog';
import { HubOverview } from '../pages/HubOverview';
import { SettingsPage } from '../pages/SettingsPage';
import { ProjectWorkspace } from '../pages/ProjectWorkspace';
import { ApiWorkspace } from '../features/api/ApiWorkspace';
import { AddProjectDialog } from '../features/projects/AddProjectDialog';
import { CloneDialog } from '../features/git/lifecycle/CloneDialog';
import { InitDialog } from '../features/git/lifecycle/InitDialog';
import { GitConfirmDialog } from '../features/git/GitConfirmDialog';
import { PublishToGitHubDialog } from '../features/git/github/PublishToGitHubDialog';
import { PublishToGiteaDialog } from '../features/git/gitea/PublishToGiteaDialog';
import { OperationsDrawer } from '../features/git/operations/OperationsDrawer';
import { buildEditMenuItems } from '../lib/contextMenu';

export function WorkbenchShell() {
  const view = useAppStore((s) => s.view);
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const openAddDialog = useAppStore((s) => s.openAddDialog);
  const backToHub = useAppStore((s) => s.backToHub);
  const openSettings = useAppStore((s) => s.openSettings);
  const openPalette = useAppStore((s) => s.openPalette);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const onContextMenu = (event: MouseEvent): void => {
    const editable = (event.target as HTMLElement).closest<HTMLElement>(
      'input, textarea, [contenteditable="true"], .cm-editor'
    );
    // Specialized surfaces (Files explorer, process rows, sidebar) handle their own menus.
    if (event.defaultPrevented) return;

    if (editable) {
      event.preventDefault();
      const field =
        editable.matches('input, textarea, [contenteditable="true"]')
          ? editable
          : editable.querySelector<HTMLElement>('[contenteditable="true"]') ?? editable;
      openContextMenu({ x: event.clientX, y: event.clientY, items: buildEditMenuItems(field) });
      return;
    }

    // Hub chrome actions do not belong inside a project or API workbench.
    if (view === 'project' || view === 'api') {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const items: ContextMenuItem[] = [
      { type: 'item', label: 'Add project…', onSelect: () => void openAddDialog() },
      { type: 'item', label: 'Go to Projects', onSelect: () => backToHub() },
      { type: 'separator' },
      { type: 'item', label: 'Command palette', onSelect: () => openPalette() },
      { type: 'item', label: 'Settings', onSelect: () => openSettings() },
      { type: 'separator' },
      { type: 'item', label: 'Toggle theme', onSelect: () => void toggleTheme() },
    ];
    openContextMenu({ x: event.clientX, y: event.clientY, items });
  };

  return (
    <GitContextMenuProvider>
      <div className="app-shell" onContextMenu={onContextMenu}>
        <TitleBar />
        <div className="workspace">
          <main className="stage">
            <div key={view} className="stage-page page-enter">
              {view === 'settings' && <SettingsPage />}
              {view === 'project' && <ProjectWorkspace />}
              {view === 'api' && <ApiWorkspace />}
              {view === 'hub' && <HubOverview />}
            </div>
          </main>
        </div>
        <StatusBar />
        <CommandPalette />
        <AddProjectDialog />
        <CloneDialog />
        <InitDialog />
        <GitConfirmDialog />
        <PublishToGitHubDialog />
        <PublishToGiteaDialog />
        <OperationsDrawer />
        <ToastStack />
        <UpdateNotifier />
        <ContextMenu />
        <QuitConfirmDialog />
        <ProjectRemoveDialog />
        <ShutdownOverlay />
        <OnboardingOverlay />
        <LiveRegion />
      </div>
    </GitContextMenuProvider>
  );
}
