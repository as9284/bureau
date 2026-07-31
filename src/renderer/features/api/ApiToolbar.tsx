import { Dropdown } from '@renderer/components/Dropdown';
import { Button } from '@renderer/components/Button';
import { IconButton } from '@renderer/components/IconButton';
import { KeyboardIcon } from '@renderer/components/icons';
import type { ApiWorkspaceSnapshot, ApiWorkspaceSummary } from '@shared/contracts/apiWorkbench';

type Props = {
  workspaces: ApiWorkspaceSummary[];
  activeWorkspaceId: string | null;
  snapshot: ApiWorkspaceSnapshot | null;
  activeEnvironmentId: string | null;
  onWorkspaceChange(workspaceId: string): void;
  onEnvironmentChange(environmentId: string | null): void;
  onNewRequest(): void;
  onImport(): void;
  onExport(): void;
  onRun(): void;
  onBackup(): void;
  onShortcuts(): void;
};

export function ApiToolbar({
  workspaces,
  activeWorkspaceId,
  snapshot,
  activeEnvironmentId,
  onWorkspaceChange,
  onEnvironmentChange,
  onNewRequest,
  onImport,
  onExport,
  onRun,
  onBackup,
  onShortcuts,
}: Props) {
  const workspaceOptions = workspaces.map((workspace) => ({
    value: workspace.workspaceId,
    label: workspace.name,
  }));

  const environmentOptions = [
    { value: '', label: 'No environment' },
    ...(snapshot?.environments.map((environment) => ({
      value: environment.environmentId,
      label: environment.name,
    })) ?? []),
  ];

  return (
    <header className="api-toolbar">
      <div className="api-toolbar__leading">
        <div className="api-toolbar__picker">
          <span className="api-toolbar__picker-label">Workspace</span>
          <Dropdown
            className="api-toolbar__workspace"
            label="Workspace"
            value={activeWorkspaceId ?? ''}
            options={
              workspaceOptions.length
                ? workspaceOptions
                : [{ value: '', label: 'No workspaces', disabled: true }]
            }
            onChange={onWorkspaceChange}
            disabled={!workspaceOptions.length}
          />
        </div>
        <div className="api-toolbar__picker">
          <span className="api-toolbar__picker-label">Environment</span>
          <Dropdown
            className="api-toolbar__environment"
            label="Environment"
            value={activeEnvironmentId ?? ''}
            options={environmentOptions}
            onChange={(value) => onEnvironmentChange(value || null)}
            disabled={!snapshot}
          />
        </div>
        <span className="api-toolbar__divider" aria-hidden="true" />
        <Button size="compact" variant="primary" onClick={onNewRequest} disabled={!snapshot}>
          New request
        </Button>
        <Button size="compact" variant="secondary" onClick={onRun} disabled={!snapshot}>
          Run collection
        </Button>
      </div>
      <div className="api-toolbar__trailing">
        {snapshot?.summary.linkedProjectId ? (
          <span className="api-toolbar__project-chip mono" title={snapshot.linkedProjectName ?? snapshot.summary.linkedProjectId}>
            {snapshot.linkedProjectStale
              ? 'Stale project link'
              : snapshot.linkedProjectName ?? 'Linked project'}
          </span>
        ) : null}
        <span className="api-toolbar__divider" aria-hidden="true" />
        <Button size="compact" variant="ghost" onClick={onImport} disabled={!snapshot}>
          Import
        </Button>
        <Button size="compact" variant="ghost" onClick={onExport} disabled={!snapshot}>
          Export
        </Button>
        <Button size="compact" variant="ghost" onClick={onBackup}>
          Backup
        </Button>
        <IconButton label="Keyboard shortcuts" onClick={onShortcuts}>
          <KeyboardIcon size={15} />
        </IconButton>
      </div>
    </header>
  );
}
