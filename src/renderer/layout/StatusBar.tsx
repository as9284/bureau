import { useAppStore, selectRunningCount } from '../store/appStore';
import { useGitStore } from '../store/gitStore';
import {
  formatAttentionLabel,
  formatSyncLabel,
  getAttentionLevel,
} from '../lib/attention';
import { markdownStats } from '../features/files/markdown';

export function StatusBar() {
  const capabilities = useAppStore((s) => s.capabilities);
  const projects = useAppStore((s) => s.projects);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const running = useAppStore(selectRunningCount);
  const projectTab = useAppStore((s) => s.projectTab);
  const filesProject = useAppStore((s) => selectedProjectId ? s.filesByProject[selectedProjectId] : undefined);
  const filesSettings = useAppStore((s) => s.settings?.files);
  const activeFilePath = filesProject?.activePath ?? null;
  const activeFile = activeFilePath ? filesProject?.buffers[activeFilePath] : undefined;
  const cursor = activeFilePath ? filesProject?.cursorByPath[activeFilePath] : undefined;
  const fileStats = activeFile?.kind === 'text' && activeFile.document.languageId === 'markdown' ? markdownStats(activeFile.content) : null;

  const gitRepo = useGitStore((s) =>
    selectedProjectId ? s.repos[selectedProjectId] : undefined
  );
  const snap = gitRepo?.snapshot;
  const attentionLevel = getAttentionLevel({ snapshot: snap, error: gitRepo?.error });
  const attentionLabel = formatAttentionLabel({ level: attentionLevel, snapshot: snap });
  const syncLabel = formatSyncLabel(snap);
  const branchLabel =
    snap?.branch.kind === 'named'
      ? snap.branch.name
      : snap?.branch.kind === 'detached'
        ? `detached @${snap.branch.headOid.slice(0, 7)}`
        : null;

  return (
    <footer className="status-bar">
      <div className="cluster">
        <span className={['status-dot', running > 0 ? '' : 'idle'].join(' ')} aria-hidden />
        <span>{running} running</span>
      </div>
      <div className="cluster">
        <span className="mono">{projects.length} projects</span>
      </div>
      {selectedProjectId && snap ? (
        <div className="cluster status-bar__git mono">
          {branchLabel ? <span>{branchLabel}</span> : null}
          <span>{attentionLabel}</span>
          {syncLabel ? <span>{syncLabel}</span> : null}
          {attentionLevel === 'blocked' ? <span className="status-bar__blocked">Blocked</span> : null}
        </div>
      ) : null}
      {projectTab === 'files' && activeFilePath && activeFile?.kind === 'text' ? (
        <div className="cluster status-bar__files mono">
          <span>{activeFilePath}</span>
          <span>Ln {cursor?.line ?? 1}, Col {cursor?.column ?? 1}</span>
          <span>Spaces: {filesSettings?.tabSize ?? 2}</span>
          <span>{activeFile.document.encoding.toUpperCase()}</span>
          <span>{activeFile.document.lineEnding.toUpperCase()}</span>
          <span>{activeFile.document.languageId}</span>
          <span>{activeFile.conflict ? 'Conflict' : activeFile.dirty ? 'Modified' : 'Saved'}</span>
          {fileStats ? <span>{fileStats.words} words, {fileStats.readMinutes} min, {Math.round(filesProject?.readingProgressByPath[activeFilePath] ?? 0)}%</span> : null}
        </div>
      ) : null}
      <div className="cluster right">
        {capabilities && (
          <>
            <span className="mono">{capabilities.platform}</span>
            <span className="mono">v{capabilities.appVersion}</span>
          </>
        )}
      </div>
    </footer>
  );
}
