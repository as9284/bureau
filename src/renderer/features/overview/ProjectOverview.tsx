import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { StackBadge } from '../../components/StackBadge';
import { StateDot } from '../../components/StateDot';
import {
  BranchIcon,
  CodeIcon,
  CopyIcon,
  FolderIcon,
  GlobeIcon,
  PlayIcon,
  StopIcon,
  TerminalIcon,
} from '../../components/icons';
import { pendingLabel, statusLabel } from '../../lib/processStatus';
import { copyText } from '../../lib/contextMenu';
import { formatRelativeTime, formatUptime } from '../../lib/format';
import type { ProcessRuntime, ProjectProcesses } from '@shared/contracts/processes';
import type { ProcessDefinition, TrackedProject } from '@shared/contracts/projects';
import type { GitSnapshot } from '@shared/contracts/git';

function useSecondlyTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

export function ProjectOverview({ projectId }: { projectId: string }) {
  const project = useAppStore((s) => s.projects.find((p) => p.projectId === projectId));
  const processes = useAppStore((s) => s.processesByProject[projectId]);
  const git = useAppStore((s) => s.gitByProject[projectId]);
  const tools = useAppStore((s) => s.settings?.tools);

  const setProjectTab = useAppStore((s) => s.setProjectTab);
  const startAllProcesses = useAppStore((s) => s.startAllProcesses);
  const startProcess = useAppStore((s) => s.startProcess);
  const stopProcess = useAppStore((s) => s.stopProcess);
  const openUrlInPreview = useAppStore((s) => s.openUrlInPreview);
  const openInEditor = useAppStore((s) => s.openInEditor);
  const openInTerminal = useAppStore((s) => s.openInTerminal);
  const openInExplorer = useAppStore((s) => s.openInExplorer);
  const loadGit = useAppStore((s) => s.loadGit);
  const pushToast = useAppStore((s) => s.pushToast);

  // Refresh the git snapshot whenever this overview mounts for a project.
  useEffect(() => {
    void loadGit(projectId);
  }, [projectId, loadGit]);

  const runtimes = processes?.runtimes ?? [];
  const definitions = processes?.definitions ?? [];
  const running = runtimes.filter((r) => r.status === 'running' || r.status === 'starting');
  const detectedUrl = runtimes.find((r) => r.detectedUrl)?.detectedUrl;
  const allRunning = definitions.length > 0 && running.length >= definitions.length;

  useSecondlyTick(running.length > 0);

  if (!project) return null;

  const copyPath = (): void => {
    void copyText(project.path);
    pushToast('success', 'Path copied');
  };

  const openPreview = (): void => {
    if (detectedUrl) openUrlInPreview(detectedUrl);
    else setProjectTab('preview');
  };

  return (
    <div className="overview">
      <header className="overview-hero">
        <div className="overview-hero__main">
          <div className="overview-hero__titlerow">
            <h1 className="overview-hero__name">{project.name}</h1>
            {running.length > 0 && (
              <span className="overview-livepill">
                <span className="overview-livepill__dot" />
                {running.length} running
              </span>
            )}
          </div>
          <button className="overview-hero__path mono" title="Copy path" onClick={copyPath}>
            <span className="overview-hero__pathtext">{project.path}</span>
            <CopyIcon size={13} />
          </button>
          <div className="overview-hero__badges">
            {project.stack.length === 0 ? (
              <span className="overview-muted">No stack detected</span>
            ) : (
              project.stack.map((s) => <StackBadge key={s} stack={s} />)
            )}
          </div>
        </div>

        <div className="overview-hero__actions">
          <Button
            variant="primary"
            onClick={() => void startAllProcesses(projectId)}
            disabled={definitions.length === 0 || allRunning}
          >
            <PlayIcon size={14} />
            {allRunning ? 'All running' : 'Start all'}
          </Button>
          <Button variant="secondary" onClick={openPreview}>
            <GlobeIcon size={15} />
            Preview
          </Button>
          {tools?.showOpenInEditor !== false && (
            <Button variant="secondary" onClick={() => void openInEditor()}>
              <CodeIcon size={15} />
              Editor
            </Button>
          )}
          {tools?.showOpenInTerminal !== false && (
            <Button variant="secondary" onClick={() => void openInTerminal()}>
              <TerminalIcon size={15} />
              Terminal
            </Button>
          )}
          {tools?.showOpenInExplorer !== false && (
            <Button variant="secondary" onClick={() => void openInExplorer()}>
              <FolderIcon size={15} />
              Explorer
            </Button>
          )}
        </div>
      </header>

      {project.missing && (
        <div className="inline-banner warning">
          This folder no longer exists on disk. Reconnect it or remove the project.
        </div>
      )}

      <div className="overview-grid">
        <ProcessesCard
          projectId={projectId}
          processes={processes}
          runningCount={running.length}
          onManage={() => setProjectTab('processes')}
          startProcess={startProcess}
          stopProcess={stopProcess}
          openUrlInPreview={openUrlInPreview}
        />
        <div className="overview-subgrid">
          <GitCard git={git} />
          <PreviewCard detectedUrl={detectedUrl} onOpen={openPreview} />
          <DetailsCard project={project} />
        </div>
      </div>
    </div>
  );
}

function ProcessesCard({
  projectId,
  processes,
  runningCount,
  onManage,
  startProcess,
  stopProcess,
  openUrlInPreview,
}: {
  projectId: string;
  processes: ProjectProcesses | undefined;
  runningCount: number;
  onManage: () => void;
  startProcess: (projectId: string, processId: string) => Promise<void>;
  stopProcess: (projectId: string, processId: string) => Promise<void>;
  openUrlInPreview: (url: string) => void;
}) {
  const definitions = processes?.definitions ?? [];
  const runtimeFor = (id: string): ProcessRuntime | undefined =>
    processes?.runtimes.find((r) => r.processId === id);

  return (
    <section className="overview-card overview-card--processes">
      <div className="overview-card__head">
        <h2 className="overview-card__title">Processes</h2>
        <span className="overview-count">
          {runningCount}/{definitions.length} running
        </span>
      </div>

      {definitions.length === 0 ? (
        <p className="overview-card__empty">No runnable commands were detected for this project.</p>
      ) : (
        <ul className="overview-proclist">
          {definitions.map((definition) => (
            <ProcessLine
              key={definition.id}
              projectId={projectId}
              definition={definition}
              runtime={runtimeFor(definition.id)}
              startProcess={startProcess}
              stopProcess={stopProcess}
              openUrlInPreview={openUrlInPreview}
            />
          ))}
        </ul>
      )}

      <div className="overview-card__foot">
        <button type="button" className="overview-link" onClick={onManage}>
          Manage processes →
        </button>
      </div>
    </section>
  );
}

function ProcessLine({
  projectId,
  definition,
  runtime,
  startProcess,
  stopProcess,
  openUrlInPreview,
}: {
  projectId: string;
  definition: ProcessDefinition;
  runtime: ProcessRuntime | undefined;
  startProcess: (projectId: string, processId: string) => Promise<void>;
  stopProcess: (projectId: string, processId: string) => Promise<void>;
  openUrlInPreview: (url: string) => void;
}) {
  const pending = useAppStore((s) => s.pendingProcesses[`${projectId}:${definition.id}`]);
  const status = runtime?.status ?? 'idle';
  const active = status === 'running' || status === 'starting';
  const busy = Boolean(pending);

  return (
    <li className="overview-procline">
      <StateDot status={status} busy={busy} />
      <span className="overview-procline__label">{definition.label}</span>
      <span className="overview-procline__meta mono">
        {pending ? (
          <span className="overview-procline__pending">{pendingLabel(pending)}</span>
        ) : active && runtime?.startedAt ? (
          <span>up {formatUptime(runtime.startedAt)}</span>
        ) : (
          <span className="overview-muted">{statusLabel(status)}</span>
        )}
      </span>
      {runtime?.detectedUrl && !busy && (
        <button
          type="button"
          className="overview-procline__url mono"
          title="Open in preview"
          onClick={() => openUrlInPreview(runtime.detectedUrl as string)}
        >
          {shortUrl(runtime.detectedUrl)}
        </button>
      )}
      {busy ? (
        <IconButton label="Working…" disabled>
          <span className="btn-spinner" />
        </IconButton>
      ) : active ? (
        <IconButton label="Stop" onClick={() => void stopProcess(projectId, definition.id)}>
          <StopIcon size={13} />
        </IconButton>
      ) : (
        <IconButton label="Start" onClick={() => void startProcess(projectId, definition.id)}>
          <PlayIcon size={13} />
        </IconButton>
      )}
    </li>
  );
}

function GitCard({ git }: { git: GitSnapshot | undefined }) {
  return (
    <section className="overview-card">
      <div className="overview-card__head">
        <h2 className="overview-card__title">Source control</h2>
        <BranchIcon size={15} className="overview-card__headicon" />
      </div>

      {!git || !git.isRepo ? (
        <p className="overview-card__empty">Not a Git repository.</p>
      ) : (
        <div className="overview-git">
          <div className="overview-git__branch">
            <BranchIcon size={16} />
            <span className="mono">
              {git.detached ? 'detached HEAD' : (git.branch ?? 'unknown')}
            </span>
          </div>
          <div className="overview-git__stats">
            {git.changes === 0 ? (
              <span className="overview-chip success">Clean</span>
            ) : (
              <span className="overview-chip warning">
                {git.changes} {git.changes === 1 ? 'change' : 'changes'}
              </span>
            )}
            {git.ahead > 0 && <span className="overview-chip muted mono">↑{git.ahead}</span>}
            {git.behind > 0 && <span className="overview-chip muted mono">↓{git.behind}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

function PreviewCard({
  detectedUrl,
  onOpen,
}: {
  detectedUrl: string | undefined;
  onOpen: () => void;
}) {
  return (
    <section className="overview-card">
      <div className="overview-card__head">
        <h2 className="overview-card__title">Preview</h2>
        <GlobeIcon size={15} className="overview-card__headicon" />
      </div>

      {detectedUrl ? (
        <div className="overview-preview">
          <button type="button" className="overview-preview__url mono" onClick={onOpen}>
            {detectedUrl}
          </button>
          <Button variant="secondary" onClick={onOpen}>
            Open preview
          </Button>
        </div>
      ) : (
        <p className="overview-card__empty">
          No dev server detected yet. Start a process and its URL appears here.
        </p>
      )}
    </section>
  );
}

function DetailsCard({ project }: { project: TrackedProject }) {
  return (
    <section className="overview-card">
      <div className="overview-card__head">
        <h2 className="overview-card__title">Details</h2>
      </div>
      <dl className="overview-details">
        <div>
          <dt>Last opened</dt>
          <dd className="mono">{formatRelativeTime(project.lastOpenedAt)}</dd>
        </div>
        <div>
          <dt>Added</dt>
          <dd className="mono">{formatRelativeTime(project.addedAt)}</dd>
        </div>
      </dl>
    </section>
  );
}

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}
