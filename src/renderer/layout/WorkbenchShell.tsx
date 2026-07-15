import type { MouseEvent } from 'react';
import { useAppStore, type ContextMenuItem } from '../store/appStore';
import { ProjectRail } from './ProjectRail';
import { ImmersiveNavigationHost } from './ImmersiveNavigationHost';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import { CommandPalette } from './CommandPalette';
import { LiveRegion } from '../components/LiveRegion';
import { ToastStack } from '../components/ToastStack';
import { ContextMenu } from '../components/ContextMenu';
import { ContextMenuProvider as GitContextMenuProvider } from '../components/GitContextMenu';
import { ShutdownOverlay } from '../components/ShutdownOverlay';
import { QuitConfirmDialog } from '../components/QuitConfirmDialog';
import { ProjectRemoveDialog } from '../components/ProjectRemoveDialog';
import { HubOverview } from '../pages/HubOverview';
import { SettingsPage } from '../pages/SettingsPage';
import { ProjectWorkspace } from '../pages/ProjectWorkspace';
import { AddProjectDialog } from '../features/projects/AddProjectDialog';
import { CloneDialog } from '../features/git/lifecycle/CloneDialog';
import { InitDialog } from '../features/git/lifecycle/InitDialog';
import { PublishToGitHubDialog } from '../features/git/github/PublishToGitHubDialog';
import { OperationsDrawer } from '../features/git/operations/OperationsDrawer';
import { buildEditMenuItems } from '../lib/contextMenu';

export function WorkbenchShell() {
  const view = useAppStore((s) => s.view);
  const projectTab = useAppStore((s) => s.projectTab);
  const immersiveMode = useAppStore((s) => s.settings?.appearance.immersiveMode ?? false);
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const openAddDialog = useAppStore((s) => s.openAddDialog);
  const backToHub = useAppStore((s) => s.backToHub);
  const setSection = useAppStore((s) => s.setSection);
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

    // Hub chrome actions do not belong inside a project workbench (Files, Processes, …).
    if (view === 'project') {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const items: ContextMenuItem[] = [
      { type: 'item', label: 'Add project…', onSelect: () => void openAddDialog() },
      { type: 'item', label: 'Go to Projects', onSelect: () => backToHub() },
      { type: 'separator' },
      { type: 'item', label: 'Command palette', onSelect: () => openPalette() },
      { type: 'item', label: 'Settings', onSelect: () => setSection('settings') },
      { type: 'separator' },
      { type: 'item', label: 'Toggle theme', onSelect: () => void toggleTheme() },
    ];
    openContextMenu({ x: event.clientX, y: event.clientY, items });
  };

  const navigationChrome = immersiveMode ? (
    <ImmersiveNavigationHost edgeRevealDisabled={view === 'project' && projectTab === 'files'}>
      <ProjectRail />
    </ImmersiveNavigationHost>
  ) : (
    <ProjectRail />
  );

  return (
    <GitContextMenuProvider>
      <div className="app-shell" onContextMenu={onContextMenu}>
        <TitleBar />
        <div className={['workspace', immersiveMode ? 'workspace--immersive' : ''].filter(Boolean).join(' ')}>
          {navigationChrome}
          <main className="stage">
            {view === 'settings' && <SettingsPage />}
            {view === 'project' && <ProjectWorkspace />}
            {view === 'hub' && <HubOverview />}
          </main>
        </div>
        <StatusBar />
        <CommandPalette />
        <AddProjectDialog />
        <CloneDialog />
        <InitDialog />
        <PublishToGitHubDialog />
        <OperationsDrawer />
        <ToastStack />
        <ContextMenu />
        <QuitConfirmDialog />
        <ProjectRemoveDialog />
        <ShutdownOverlay />
        <LiveRegion />
      </div>
    </GitContextMenuProvider>
  );
}
