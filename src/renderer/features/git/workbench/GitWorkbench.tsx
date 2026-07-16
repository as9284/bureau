import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { SyncBar } from '@renderer/features/git/sync/SyncBar';
import { ChangesPanel } from '@renderer/features/git/changes/ChangesPanel';
import { DiffPanel } from '@renderer/features/git/diff/DiffPanel';
import { CommitPanel } from '@renderer/features/git/commit/CommitPanel';
import { BranchesPanel } from '@renderer/features/git/branches/BranchesPanel';
import { StashPanel } from '@renderer/features/git/stash/StashPanel';
import { HistoryPanel } from '@renderer/features/git/history/HistoryPanel';
import { ReflogPanel } from '@renderer/features/git/history/ReflogPanel';
import { WorktreesPanel } from '@renderer/features/git/worktrees/WorktreesPanel';
import { RemotesPanel } from '@renderer/features/git/remotes/RemotesPanel';
import { SubmodulesPanel } from '@renderer/features/git/submodules/SubmodulesPanel';
import { TagsPanel } from '@renderer/features/git/tags/TagsPanel';
import { RecoveryBanner } from '@renderer/features/git/recovery/RecoveryBanner';
import { PanelError } from '@renderer/features/git/PanelState';
import { Button } from '@renderer/components/Button';
import { ContextMenuTrigger } from '@renderer/components/GitContextMenu';
import { PaneSeparator } from '@renderer/components/PaneSeparator';
import { EmptyState } from '@renderer/components/EmptyState';
import { useActiveRepositoryContextMenuItems } from '@renderer/lib/gitContextMenuItems';
import {
  clampPaneWidths,
  DEFAULT_PANE_WIDTHS,
  MIN_FILES,
  MIN_COMMIT,
} from '@renderer/lib/layoutPrefs';
import './GitWorkbench.css';

type Props = { projectId: string };

const MODES = [
  { id: 'changes' as const, label: 'Changes' },
  { id: 'history' as const, label: 'History' },
  { id: 'reflog' as const, label: 'Reflog' },
  { id: 'branches' as const, label: 'Branches' },
  { id: 'remotes' as const, label: 'Remotes' },
  { id: 'stash' as const, label: 'Stashes' },
  { id: 'worktrees' as const, label: 'Worktrees' },
  { id: 'submodules' as const, label: 'Submodules' },
  { id: 'tags' as const, label: 'Tags' },
];

export function GitWorkbench({ projectId }: Props): ReactElement {
  const repo = useGitStore((s) => s.repos[projectId]);
  const repoPanel = useGitStore((s) => s.repoPanel);
  const setRepoPanel = useGitStore((s) => s.setRepoPanel);
  const refreshRepo = useGitStore((s) => s.refreshRepo);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);
  const clearOperationError = useGitStore((s) => s.clearOperationError);
  const retryOperation = useGitStore((s) => s.retryOperation);
  const loadBranches = useGitStore((s) => s.loadBranches);
  const loadStash = useGitStore((s) => s.loadStash);
  const loadHistory = useGitStore((s) => s.loadHistory);
  const loadReflog = useGitStore((s) => s.loadReflog);
  const loadWorktrees = useGitStore((s) => s.loadWorktrees);
  const loadRemotes = useGitStore((s) => s.loadRemotes);
  const loadSubmodules = useGitStore((s) => s.loadSubmodules);
  const loadTags = useGitStore((s) => s.loadTags);
  const openInEditor = useGitStore((s) => s.openInEditor);
  const openInTerminal = useGitStore((s) => s.openInTerminal);
  const openInFileExplorer = useGitStore((s) => s.openInFileExplorer);
  const settings = useGitStore((s) => s.settings);
  const updateSettings = useGitStore((s) => s.updateSettings);

  const containerRef = useRef<HTMLDivElement>(null);
  const [paneWidths, setPaneWidths] = useState(() =>
    clampPaneWidths(settings?.layout.paneWidths ?? DEFAULT_PANE_WIDTHS, 1200)
  );
  const paneWidthsRef = useRef(paneWidths);
  paneWidthsRef.current = paneWidths;

  useEffect(() => {
    if (settings?.layout.paneWidths) {
      setPaneWidths(
        clampPaneWidths(settings.layout.paneWidths, containerRef.current?.clientWidth ?? 1200)
      );
    }
  }, [settings?.layout.paneWidths]);

  useEffect(() => {
    refreshRepo(projectId).catch(() => undefined);
    const intervalMs = settings?.general.refreshIntervalMs ?? 15000;
    if (intervalMs <= 0) return;
    const interval = window.setInterval(() => {
      refreshRepo(projectId).catch(() => undefined);
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [projectId, refreshRepo, settings?.general.refreshIntervalMs]);

  useEffect(() => {
    if (!settings?.general.refreshOnFocus) return;
    const onFocus = () => refreshRepo(projectId).catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [projectId, refreshRepo, settings?.general.refreshOnFocus]);

  useEffect(() => {
    if (repoPanel === 'branches') loadBranches(projectId);
    if (repoPanel === 'stash') loadStash(projectId);
    if (repoPanel === 'history') loadHistory(projectId);
    if (repoPanel === 'reflog') loadReflog(projectId);
    if (repoPanel === 'worktrees') loadWorktrees(projectId);
    if (repoPanel === 'remotes') loadRemotes(projectId);
    if (repoPanel === 'submodules') loadSubmodules(projectId);
    if (repoPanel === 'tags') loadTags(projectId);
  }, [
    repoPanel,
    projectId,
    loadBranches,
    loadStash,
    loadHistory,
    loadReflog,
    loadWorktrees,
    loadRemotes,
    loadSubmodules,
    loadTags,
  ]);

  const resizeFiles = useCallback((delta: number) => {
    setPaneWidths((w) =>
      clampPaneWidths(
        { ...w, files: Math.max(MIN_FILES, w.files + delta) },
        containerRef.current?.clientWidth ?? 1200
      )
    );
  }, []);

  const resizeCommit = useCallback((delta: number) => {
    setPaneWidths((w) =>
      clampPaneWidths(
        { ...w, commit: Math.max(MIN_COMMIT, w.commit - delta) },
        containerRef.current?.clientWidth ?? 1200
      )
    );
  }, []);

  const persistPaneWidths = useCallback(() => {
    updateSettings({ layout: { paneWidths: paneWidthsRef.current } });
  }, [updateSettings]);

  const repoContextMenu = useActiveRepositoryContextMenuItems(projectId);

  if (!repo) {
    return (
      <EmptyState
        title="Repository not found"
        description="This repository may have been removed from Bureau."
      />
    );
  }

  const snap = repo.snapshot;
  const readOnly = Boolean(snap?.blockedOperation);
  const changedCount = snap?.changedFileCount ?? 0;
  const showEditor = settings?.tools.showOpenInEditor !== false;
  const showTerminal = settings?.tools.showOpenInTerminal !== false;
  const showExplorer = settings?.tools.showOpenInExplorer !== false;
  const showOpenTools = showEditor || showTerminal || showExplorer;

  return (
    <div className="repo-workbench">
      <RecoveryBanner projectId={projectId} snapshotRevision={snap?.revision} />
      <header className="repo-workbench__header">
        <div className="repo-workbench__header-start">
          <ContextMenuTrigger menu={repoContextMenu}>
            <div className="repo-workbench__identity">
              <h1 className="repo-workbench__title">{repo.catalogue.displayName}</h1>
              <p className="repo-workbench__path" title={repo.catalogue.canonicalPath}>
                {repo.catalogue.canonicalPath}
              </p>
            </div>
          </ContextMenuTrigger>
          {showOpenTools ? (
            <div className="repo-workbench__open-tools" aria-label="Open repository in">
              {showEditor ? (
                <Button variant="ghost" onClick={() => openInEditor(projectId)}>
                  Editor
                </Button>
              ) : null}
              {showTerminal ? (
                <Button variant="ghost" onClick={() => openInTerminal(projectId)}>
                  Terminal
                </Button>
              ) : null}
              {showExplorer ? (
                <Button variant="ghost" onClick={() => openInFileExplorer(projectId)}>
                  Explorer
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {snap ? (
          <div className="repo-workbench__header-end">
            <SyncBar projectId={projectId} snapshot={snap} readOnly={readOnly} />
          </div>
        ) : null}
      </header>

      {/* A failed refresh leaves the panels showing the last good snapshot rather
          than blanking, so it reports itself here and offers the refresh again. */}
      {repo.error ? (
        <PanelError
          title="Could not refresh this repository"
          message={repo.error.message}
          onRetry={() => void refreshRepo(projectId)}
        />
      ) : null}

      {operation?.error ? (
        <PanelError
          title={`${operation.name ?? 'Operation'} failed`}
          message={operation.error.message}
          onRetry={operation.retry ? () => void retryOperation(projectId) : undefined}
          onDismiss={() => clearOperationError(projectId)}
        />
      ) : null}

      <nav className="repo-workbench__modes" aria-label="Repository modes">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={`repo-workbench__mode ${repoPanel === mode.id ? 'repo-workbench__mode--active' : ''}`}
            onClick={() => setRepoPanel(mode.id)}
            aria-current={repoPanel === mode.id ? 'page' : undefined}
          >
            {mode.label}
            {mode.id === 'changes' && changedCount > 0 ? (
              <span className="repo-workbench__mode-count">{changedCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {repoPanel === 'changes' ? (
        <div className="repo-workbench__panes repo-workbench__panes--changes" ref={containerRef}>
          <div className="repo-workbench__pane" style={{ width: paneWidths.files, flexShrink: 0 }}>
            <ChangesPanel projectId={projectId} snapshot={snap} readOnly={readOnly} />
          </div>
          <PaneSeparator
            orientation="vertical"
            onResize={resizeFiles}
            onResizeEnd={persistPaneWidths}
            label="Resize files pane"
          />
          <div className="repo-workbench__pane repo-workbench__pane--diff">
            <DiffPanel />
          </div>
          <PaneSeparator
            orientation="vertical"
            onResize={resizeCommit}
            onResizeEnd={persistPaneWidths}
            label="Resize commit pane"
          />
          <div className="repo-workbench__pane" style={{ width: paneWidths.commit, flexShrink: 0 }}>
            <CommitPanel projectId={projectId} snapshot={snap} readOnly={readOnly} />
          </div>
        </div>
      ) : null}

      {repoPanel === 'branches' ? (
        <BranchesPanel projectId={projectId} snapshot={snap} readOnly={readOnly} />
      ) : null}
      {repoPanel === 'stash' ? (
        <div className="repo-workbench__panes" ref={containerRef}>
          <div
            className="repo-workbench__pane"
            style={{ width: Math.max(paneWidths.files, 360), flexShrink: 0 }}
          >
            <StashPanel projectId={projectId} snapshot={snap} readOnly={readOnly} />
          </div>
          <PaneSeparator
            orientation="vertical"
            onResize={resizeFiles}
            onResizeEnd={persistPaneWidths}
            label="Resize stash pane"
          />
          <div className="repo-workbench__pane repo-workbench__pane--diff">
            <DiffPanel />
          </div>
        </div>
      ) : null}
      {repoPanel === 'history' ? (
        <div className="repo-workbench__panes" ref={containerRef}>
          <div
            className="repo-workbench__pane"
            style={{ width: Math.max(paneWidths.files, 300), flexShrink: 0 }}
          >
            <HistoryPanel projectId={projectId} readOnly={readOnly} />
          </div>
          <PaneSeparator
            orientation="vertical"
            onResize={resizeFiles}
            onResizeEnd={persistPaneWidths}
            label="Resize history pane"
          />
          <div className="repo-workbench__pane repo-workbench__pane--diff">
            <DiffPanel />
          </div>
        </div>
      ) : null}
      {repoPanel === 'reflog' ? (
        <ReflogPanel projectId={projectId} snapshot={snap} readOnly={readOnly} />
      ) : null}
      {repoPanel === 'worktrees' ? (
        <WorktreesPanel projectId={projectId} snapshot={snap} readOnly={readOnly} />
      ) : null}
      {repoPanel === 'remotes' ? (
        <RemotesPanel projectId={projectId} snapshot={snap} readOnly={readOnly} />
      ) : null}
      {repoPanel === 'submodules' ? (
        <SubmodulesPanel projectId={projectId} snapshot={snap} readOnly={readOnly} />
      ) : null}
      {repoPanel === 'tags' ? (
        <TagsPanel projectId={projectId} snapshot={snap} readOnly={readOnly} />
      ) : null}
    </div>
  );
}
