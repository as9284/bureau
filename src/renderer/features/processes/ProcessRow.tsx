import type { MouseEvent as ReactMouseEvent } from 'react';
import { useAppStore } from '../../store/appStore';
import { IconButton } from '../../components/IconButton';
import { StateDot } from '../../components/StateDot';
import { pendingLabel, statusLabel } from '../../lib/processStatus';
import { copyText } from '../../lib/contextMenu';
import { LogConsole } from '../../components/LogConsole';
import { ResizablePanel } from '../../components/ResizablePanel';
import { ChevronIcon, PlayIcon, RestartIcon, StopIcon } from '../../components/icons';
import { TerminalPane } from './TerminalPane';
import type { ProcessDefinition } from '@shared/contracts/projects';

function formatMem(bytes?: number): string | null {
  if (bytes === undefined) return null;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProcessRow({
  projectId,
  definition,
  onEdit,
}: {
  projectId: string;
  definition: ProcessDefinition;
  onEdit?: () => void;
}) {
  const key = `${projectId}:${definition.id}`;
  const runtimes = useAppStore((s) => s.processesByProject[projectId]?.runtimes);
  const pending = useAppStore((s) => s.pendingProcesses[key]);
  const expanded = useAppStore((s) => s.expandedProcess === key);
  const logs = useAppStore((s) => s.logsByProject[key]);
  const toggleProcess = useAppStore((s) => s.toggleProcess);
  const startProcess = useAppStore((s) => s.startProcess);
  const stopProcess = useAppStore((s) => s.stopProcess);
  const restartProcess = useAppStore((s) => s.restartProcess);
  const removeProcessDefinition = useAppStore((s) => s.removeProcessDefinition);
  const openUrlInPreview = useAppStore((s) => s.openUrlInPreview);
  const openContextMenu = useAppStore((s) => s.openContextMenu);

  const runtime = runtimes?.find((r) => r.processId === definition.id);
  const status = runtime?.status ?? 'idle';
  const active = status === 'running' || status === 'starting';
  const busy = Boolean(pending);
  const mem = formatMem(runtime?.memoryBytes);

  const onContextMenu = (e: ReactMouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const command = `${definition.command} ${definition.args.join(' ')}`.trim();
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(active
          ? [
              {
                type: 'item' as const,
                label: 'Stop',
                onSelect: () => void stopProcess(projectId, definition.id),
              },
              {
                type: 'item' as const,
                label: 'Restart',
                onSelect: () => void restartProcess(projectId, definition.id),
              },
            ]
          : [
              {
                type: 'item' as const,
                label: 'Start',
                onSelect: () => void startProcess(projectId, definition.id),
              },
            ]),
        { type: 'separator' },
        {
          type: 'item',
          label: 'Edit…',
          onSelect: () => onEdit?.(),
        },
        {
          type: 'item',
          label: 'Remove',
          danger: true,
          onSelect: () => void removeProcessDefinition(projectId, definition.id),
        },
        { type: 'separator' },
        { type: 'item', label: 'Copy command', onSelect: () => copyText(command) },
      ],
    });
  };

  return (
    <div className={['process-row', expanded ? 'expanded' : ''].join(' ')}>
      <div className="process-row__head" onContextMenu={onContextMenu}>
        <button
          type="button"
          className="process-row__disclosure"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse logs' : 'Expand logs'}
          onClick={() => void toggleProcess(projectId, definition.id)}
        >
          <span className={['process-row__chevron', expanded ? 'open' : ''].join(' ')}>
            <ChevronIcon size={14} />
          </span>
          <StateDot status={status} busy={busy} />
          <span className="process-row__label">{definition.label}</span>
          <span className="process-row__command mono">
            {definition.command} {definition.args.join(' ')}
          </span>
        </button>

        <div className="process-row__meta mono">
          {runtime?.detectedUrl && (
            <button
              type="button"
              className="process-row__url"
              title="Open in preview"
              onClick={() => openUrlInPreview(runtime.detectedUrl as string)}
            >
              {runtime.detectedUrl}
            </button>
          )}
          {runtime?.pid && active && !busy && <span>PID {runtime.pid}</span>}
          {active && runtime?.cpu !== undefined && <span>{runtime.cpu.toFixed(0)}% CPU</span>}
          {active && mem && <span>{mem}</span>}
          {status === 'crashed' && runtime?.exitCode !== undefined && !busy && (
            <span className="danger">exit {runtime.exitCode}</span>
          )}
          <span className={['process-row__status', busy ? 'pending' : ''].join(' ')}>
            {pending ? pendingLabel(pending) : statusLabel(status)}
          </span>
        </div>

        <div className="process-row__controls">
          {busy ? (
            <IconButton label="Working…" disabled>
              <span className="btn-spinner" />
            </IconButton>
          ) : active ? (
            <IconButton label="Stop" onClick={() => void stopProcess(projectId, definition.id)}>
              <StopIcon size={14} />
            </IconButton>
          ) : (
            <IconButton label="Start" onClick={() => void startProcess(projectId, definition.id)}>
              <PlayIcon size={14} />
            </IconButton>
          )}
          <IconButton
            label="Restart"
            disabled={!active || busy}
            onClick={() => void restartProcess(projectId, definition.id)}
          >
            <RestartIcon size={14} />
          </IconButton>
        </div>
      </div>

      {expanded && (
        <ResizablePanel
          axis="vertical"
          edge="start"
          className="process-row__log"
          defaultSize={320}
          minSize={140}
          maxSize={640}
          storageKey={`process-log-${projectId}-${definition.id}`}
          resizeLabel={`Resize ${definition.label} process log`}
        >
          {definition.runMode === 'terminal' && active ? (
            <TerminalPane projectId={projectId} processId={definition.id} active={expanded} />
          ) : (
            <LogConsole lines={logs ?? []} />
          )}
        </ResizablePanel>
      )}
    </div>
  );
}
