import { useEffect, useState, type ReactElement } from 'react';
import type { GraphConnector, HistoryCommit } from '@shared/contracts/history';
import type { CommitFileChange } from '@shared/contracts/operations';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { TextInput } from '@renderer/components/TextInput';
import { ContextMenuTrigger } from '@renderer/components/GitContextMenu';
import { Dialog } from '@renderer/components/Dialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { Skeleton } from '@renderer/components/Skeleton';
import { PanelError } from '@renderer/features/git/PanelState';
import { useCommitContextMenuItems } from '@renderer/lib/gitContextMenuItems';
import { CompareCommitsDialog } from '@renderer/features/git/history/CompareCommitsDialog';
import { ResetCommitDialog } from '@renderer/features/git/history/ResetCommitDialog';
import {
  MergeParentDialog,
  type MergeParentAction,
} from '@renderer/features/git/history/MergeParentDialog';
import './HistoryPanel.css';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusLabel(kind: CommitFileChange['kind']): string {
  switch (kind) {
    case 'added':
      return 'Added';
    case 'modified':
      return 'Modified';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    case 'copied':
      return 'Copied';
    case 'typechange':
      return 'Type change';
    default:
      return 'Changed';
  }
}

function statusCode(kind: CommitFileChange['kind']): string {
  switch (kind) {
    case 'added':
      return 'A';
    case 'modified':
      return 'M';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'copied':
      return 'C';
    case 'typechange':
      return 'T';
    default:
      return '?';
  }
}

function splitPath(fullPath: string): { name: string; parent: string } {
  const normalized = fullPath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return { name: fullPath, parent: '' };
  return { name: normalized.slice(idx + 1), parent: normalized.slice(0, idx) };
}

const LANE_WIDTH = 10;

function connectorPath(fromLane: number, toLane: number, height: number): string {
  const x1 = fromLane * LANE_WIDTH + LANE_WIDTH / 2;
  const x2 = toLane * LANE_WIDTH + LANE_WIDTH / 2;
  const midY = height / 2;
  if (x1 === x2) return `M ${x1} 0 L ${x2} ${height}`;
  return `M ${x1} 0 L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${height}`;
}

function GraphLane({
  lane,
  lanes,
  connectors,
  parentCount,
}: {
  lane?: number;
  lanes?: number[];
  connectors?: GraphConnector[];
  parentCount: number;
}): ReactElement {
  const maxLane = Math.max(
    lane ?? 0,
    ...(lanes ?? [0]),
    ...(connectors?.map((c) => c.toLane) ?? [0]),
    0
  );
  const laneCount = maxLane + 1;
  const width = laneCount * LANE_WIDTH;
  const height = 24;
  const parentLabel = parentCount === 1 ? '1 parent' : `${parentCount} parents`;

  return (
    <svg
      className="history-panel__graph-svg"
      width={width}
      height={height}
      aria-label={`Commit graph, ${parentLabel}`}
      role="img"
    >
      {lanes
        ?.filter((l) => l !== lane)
        .map((l) => (
          <line
            key={`carry-${l}`}
            x1={l * LANE_WIDTH + LANE_WIDTH / 2}
            y1={0}
            x2={l * LANE_WIDTH + LANE_WIDTH / 2}
            y2={height}
            className="history-panel__graph-carry"
          />
        ))}
      {connectors?.map((connector, idx) => (
        <path
          key={`${connector.parentOid}-${idx}`}
          d={connectorPath(connector.fromLane, connector.toLane, height)}
          className="history-panel__graph-connector"
          fill="none"
        />
      ))}
      {lane != null ? (
        <circle
          cx={lane * LANE_WIDTH + LANE_WIDTH / 2}
          cy={height / 2}
          r={4}
          className="history-panel__graph-node"
        />
      ) : null}
    </svg>
  );
}

type HistoryCommitRowProps = {
  commit: HistoryCommit;
  revision?: string;
  readOnly: boolean;
  busy: boolean;
  selected: boolean;
  onSelect: () => void;
  onCreateBranch: () => void;
  onCreateTag: () => void;
  onReset: () => void;
  onCheckout: () => void;
  onCherryPick: () => void;
  onRevert: () => void;
  compareBaseOid?: string;
  onSetCompareBase: () => void;
  onCompareWithBase: () => void;
};

function HistoryCommitRow({
  commit,
  revision,
  readOnly,
  busy,
  selected,
  onSelect,
  onCreateBranch,
  onCreateTag,
  onReset,
  onCheckout,
  onCherryPick,
  onRevert,
  compareBaseOid,
  onSetCompareBase,
  onCompareWithBase,
}: HistoryCommitRowProps): ReactElement {
  const menuItems = useCommitContextMenuItems({
    commit,
    revision,
    readOnly,
    busy,
    compareBaseOid,
    onCreateBranch,
    onCreateTag,
    onReset,
    onCheckout,
    onCherryPick,
    onRevert,
    onSetCompareBase,
    onCompareWithBase,
  });

  const decorations =
    commit.decorations.length > 0 ? commit.decorations.map((d) => d.name).join(', ') : null;

  return (
    <ContextMenuTrigger menu={menuItems}>
      <li className="history-panel__item">
        <button
          type="button"
          className={`history-panel__commit ${selected ? 'history-panel__commit--selected' : ''}`}
          onClick={onSelect}
          aria-current={selected ? 'true' : undefined}
        >
          <GraphLane
            lane={commit.graphLane}
            lanes={commit.graphLanes}
            connectors={commit.graphConnectors}
            parentCount={commit.parentOids.length}
          />
          <code className="history-panel__hash" title={commit.oid}>
            {commit.abbreviatedOid}
          </code>
          <span className="history-panel__copy">
            <span className="history-panel__subject">{commit.subject}</span>
            <span className="history-panel__meta">
              {commit.authorName} · {relativeTime(commit.committedAt)}
              {decorations ? ` · ${decorations}` : ''}
            </span>
          </span>
        </button>
      </li>
    </ContextMenuTrigger>
  );
}

type Props = {
  projectId: string;
  readOnly?: boolean;
};

export function HistoryPanel({ projectId, readOnly = false }: Props): ReactElement {
  const historyCommits = useGitStore((s) => s.historyCommits);
  const historyLoading = useGitStore((s) => s.historyLoading);
  const historyError = useGitStore((s) => s.historyError);
  const historyHasMore = useGitStore((s) => s.historyHasMore);
  const loadHistory = useGitStore((s) => s.loadHistory);
  const selectedCommitOid = useGitStore((s) => s.selectedCommitOid);
  const commitFiles = useGitStore((s) => s.commitFiles);
  const commitFilesLoading = useGitStore((s) => s.commitFilesLoading);
  const selectedFile = useGitStore((s) => s.selectedFile);
  const selectCommit = useGitStore((s) => s.selectCommit);
  const loadDiff = useGitStore((s) => s.loadDiff);
  const loadMoreHistory = useGitStore((s) => s.loadMoreHistory);
  const setHistoryFilters = useGitStore((s) => s.setHistoryFilters);
  const historyFilters = useGitStore((s) => s.historyFilters);
  const createBranchFromCommit = useGitStore((s) => s.createBranchFromCommit);
  const createTag = useGitStore((s) => s.createTag);
  const cherryPick = useGitStore((s) => s.cherryPick);
  const revertCommit = useGitStore((s) => s.revertCommit);
  const checkoutCommit = useGitStore((s) => s.checkoutCommit);
  const compareCommits = useGitStore((s) => s.compareCommits);
  const compareBaseOid = useGitStore((s) => s.compareBaseOid);
  const setCompareBaseOid = useGitStore((s) => s.setCompareBaseOid);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);
  const snapshot = useGitStore((s) => s.repos[projectId]?.snapshot);
  const commitFilesError = useGitStore((s) => s.commitFilesError);

  const [filterDraft, setFilterDraft] = useState(historyFilters.text ?? '');
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [authorDraft, setAuthorDraft] = useState(historyFilters.author ?? '');
  const [pathDraft, setPathDraft] = useState(historyFilters.path ?? '');
  const [sinceDraft, setSinceDraft] = useState(historyFilters.since ?? '');
  const [untilDraft, setUntilDraft] = useState(historyFilters.until ?? '');
  const [branchTarget, setBranchTarget] = useState<HistoryCommit | null>(null);
  const [branchName, setBranchName] = useState('');
  const [resetTarget, setResetTarget] = useState<HistoryCommit | null>(null);
  const [mergeParentTarget, setMergeParentTarget] = useState<HistoryCommit | null>(null);
  const [mergeParentAction, setMergeParentAction] = useState<MergeParentAction>('revert');
  const [tagTarget, setTagTarget] = useState<HistoryCommit | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagAnnotated, setTagAnnotated] = useState(false);
  const [tagMessage, setTagMessage] = useState('');

  const revision = snapshot?.revision;
  const busy = Boolean(operation);

  /**
   * Git needs `-m <parent>` for a merge commit and rejects it for an ordinary one, so
   * the parent count decides which path runs. The count comes from the commit's own
   * `parentOids` (already populated from `%P` by GitHistoryService) — nothing here has
   * to ask main, and nothing defaults the mainline.
   */
  const runCommitReplay = (commit: HistoryCommit, action: MergeParentAction) => {
    if (!revision) return;
    if (commit.parentOids.length > 1) {
      setMergeParentAction(action);
      setMergeParentTarget(commit);
      return;
    }
    if (action === 'revert') {
      void revertCommit(projectId, revision, commit.oid);
    } else {
      void cherryPick(projectId, revision, commit.oid);
    }
  };

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const current = useGitStore.getState().historyFilters;
      setHistoryFilters(projectId, {
        ...current,
        text: filterDraft.trim() || undefined,
        author: authorDraft.trim() || undefined,
        path: pathDraft.trim() || undefined,
        since: sinceDraft.trim() || undefined,
        until: untilDraft.trim() || undefined,
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [
    filterDraft,
    authorDraft,
    pathDraft,
    sinceDraft,
    untilDraft,
    projectId,
    setHistoryFilters,
  ]);

  const selectedCommit = historyCommits.find((c) => c.oid === selectedCommitOid);

  return (
    <section className="history-panel" aria-label="Commit history">
      <div className="history-panel__commits">
        <header className="history-panel__header">
          <h2>History</h2>
          <p className="history-panel__header-hint">Select a commit to inspect its file changes.</p>
          <TextInput
            label="Filter commits"
            hideLabel
            value={filterDraft}
            onChange={(e) => setFilterDraft(e.target.value)}
            placeholder="Filter by subject…"
            className="history-panel__filter"
          />
          <Button
            variant="ghost"
            className="history-panel__more-filters-toggle"
            onClick={() => setMoreFiltersOpen((open) => !open)}
            aria-expanded={moreFiltersOpen}
          >
            {moreFiltersOpen ? 'Fewer filters' : 'More filters'}
          </Button>
          {moreFiltersOpen ? (
            <div className="history-panel__more-filters">
              <TextInput
                label="Author"
                value={authorDraft}
                onChange={(e) => setAuthorDraft(e.target.value)}
                placeholder="Author name or email"
              />
              <TextInput
                label="Path"
                value={pathDraft}
                onChange={(e) => setPathDraft(e.target.value)}
                placeholder="File path"
              />
              <TextInput
                label="Since"
                value={sinceDraft}
                onChange={(e) => setSinceDraft(e.target.value)}
                placeholder="YYYY-MM-DD or relative"
              />
              <TextInput
                label="Until"
                value={untilDraft}
                onChange={(e) => setUntilDraft(e.target.value)}
                placeholder="YYYY-MM-DD or relative"
              />
            </div>
          ) : null}
          {compareBaseOid ? (
            <p className="history-panel__compare-base mono">
              Compare base: {compareBaseOid.slice(0, 7)}
              <Button variant="ghost" onClick={() => setCompareBaseOid(undefined)}>
                Clear
              </Button>
            </p>
          ) : null}
        </header>

        {historyError ? (
          <PanelError
            title="Could not load history"
            message={historyError.message}
            onRetry={() => void loadHistory(projectId)}
          />
        ) : null}

        {historyLoading && historyCommits.length === 0 ? (
          <div className="history-panel__loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width="100%" height="var(--size-hub-row)" />
            ))}
          </div>
        ) : historyCommits.length === 0 ? (
          historyError ? null : (
            <EmptyState
              title="No commits yet"
              description="This repository has no commit history."
            />
          )
        ) : (
          <>
            <ul
              className={`history-panel__list ${historyLoading ? 'git-stale' : ''}`}
              aria-busy={historyLoading}
            >
              {historyCommits.map((commit) => (
                <HistoryCommitRow
                  key={commit.oid}
                  commit={commit}
                  revision={revision}
                  readOnly={readOnly}
                  busy={busy}
                  selected={selectedCommitOid === commit.oid}
                  onSelect={() => selectCommit(projectId, commit.oid)}
                  onCreateBranch={() => {
                    setBranchTarget(commit);
                    setBranchName('');
                  }}
                  onCreateTag={() => {
                    setTagTarget(commit);
                    setTagName('');
                  }}
                  onReset={() => setResetTarget(commit)}
                  onCheckout={() => {
                    if (revision) void checkoutCommit(projectId, revision, commit.oid);
                  }}
                  onCherryPick={() => runCommitReplay(commit, 'cherry-pick')}
                  onRevert={() => runCommitReplay(commit, 'revert')}
                  compareBaseOid={compareBaseOid}
                  onSetCompareBase={() => setCompareBaseOid(commit.oid)}
                  onCompareWithBase={() => {
                    if (compareBaseOid) {
                      void compareCommits(projectId, compareBaseOid, commit.oid);
                    }
                  }}
                />
              ))}
            </ul>
            {historyHasMore ? (
              <div className="history-panel__more">
                <Button
                  variant="secondary"
                  loading={historyLoading}
                  onClick={() => loadMoreHistory(projectId)}
                >
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="history-panel__files" aria-label="Files changed in commit">
        <header className="history-panel__header">
          <h2>Changed files</h2>
          {selectedCommit ? (
            <p className="history-panel__header-hint" title={selectedCommit.oid}>
              <span className="mono">{selectedCommit.abbreviatedOid}</span> ·{' '}
              {selectedCommit.subject}
            </p>
          ) : (
            <p className="history-panel__header-hint">No commit selected</p>
          )}
        </header>

        {!selectedCommitOid ? (
          <EmptyState
            title="Select a commit"
            description="Pick a commit from the list to browse the files it changed."
          />
        ) : commitFilesLoading ? (
          <div className="history-panel__loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} width="100%" height="var(--size-list-row)" />
            ))}
          </div>
        ) : commitFilesError ? (
          // Was an EmptyState, which asserts "this commit changed nothing" — the
          // opposite of what a failed load knows. It is an error, with a Retry.
          <PanelError
            title="Could not load files"
            message={commitFilesError}
            onRetry={() => void selectCommit(projectId, selectedCommitOid)}
          />
        ) : commitFiles.length === 0 ? (
          <EmptyState
            title="No file changes"
            description="This commit did not change any tracked files."
          />
        ) : (
          <ul className="history-panel__file-list">
            {commitFiles.map((file: CommitFileChange) => {
              const pathParts = splitPath(file.path);
              const selected =
                selectedFile?.projectId === projectId &&
                selectedFile.path === file.path &&
                selectedFile.area === 'commit' &&
                selectedFile.commitOid === selectedCommitOid;
              return (
                <li key={`${file.statusCode}:${file.path}`} className="history-panel__file-item">
                  <button
                    type="button"
                    className={`history-panel__file ${selected ? 'history-panel__file--selected' : ''}`}
                    onClick={() => loadDiff(projectId, file.path, 'commit', selectedCommitOid)}
                    title={file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
                  >
                    <span
                      className={`history-panel__file-code history-panel__file-code--${file.kind}`}
                      aria-label={statusLabel(file.kind)}
                    >
                      {statusCode(file.kind)}
                    </span>
                    <span className="history-panel__file-path">
                      <span className="history-panel__file-name">{pathParts.name}</span>
                      {pathParts.parent ? (
                        <span className="history-panel__file-parent"> {pathParts.parent}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog
        open={Boolean(branchTarget)}
        title="Create branch from commit"
        description={
          <>
            Create a branch pointing at <span className="mono">{branchTarget?.abbreviatedOid}</span>.
          </>
        }
        onClose={() => setBranchTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setBranchTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!branchName.trim()}
              onClick={() => {
                if (branchTarget && revision && branchName.trim()) {
                  createBranchFromCommit(projectId, revision, branchName.trim(), branchTarget.oid);
                  setBranchTarget(null);
                }
              }}
            >
              Create branch
            </Button>
          </>
        }
      >
        <TextInput
          label="Branch name"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
          placeholder="feature/my-branch"
        />
      </Dialog>

      <Dialog
        open={Boolean(tagTarget)}
        title="Create tag"
        description={
          <>
            Tag commit <span className="mono">{tagTarget?.abbreviatedOid}</span>.
          </>
        }
        onClose={() => {
          setTagTarget(null);
          setTagAnnotated(false);
          setTagMessage('');
        }}
        actions={
          <>
            <Button variant="secondary" onClick={() => setTagTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!tagName.trim() || (tagAnnotated && !tagMessage.trim())}
              onClick={() => {
                if (tagTarget && revision && tagName.trim()) {
                  createTag(
                    projectId,
                    revision,
                    tagName.trim(),
                    tagTarget.oid,
                    tagAnnotated ? tagMessage.trim() : undefined
                  );
                  setTagTarget(null);
                  setTagAnnotated(false);
                  setTagMessage('');
                }
              }}
            >
              Create tag
            </Button>
          </>
        }
      >
        <TextInput
          label="Tag name"
          value={tagName}
          onChange={(e) => setTagName(e.target.value)}
          placeholder="v1.0.0"
        />
        <Checkbox checked={tagAnnotated} onCheckedChange={setTagAnnotated} label="Annotated tag" />
        {tagAnnotated ? (
          <TextInput
            label="Tag message"
            value={tagMessage}
            onChange={(e) => setTagMessage(e.target.value)}
            placeholder="Release notes or description"
          />
        ) : null}
      </Dialog>

      <ResetCommitDialog
        projectId={projectId}
        revision={revision}
        target={
          resetTarget
            ? {
                oid: resetTarget.oid,
                abbreviatedOid: resetTarget.abbreviatedOid,
                label: resetTarget.subject,
              }
            : null
        }
        onClose={() => setResetTarget(null)}
      />

      <MergeParentDialog
        projectId={projectId}
        revision={revision}
        action={mergeParentAction}
        target={
          mergeParentTarget
            ? {
                oid: mergeParentTarget.oid,
                abbreviatedOid: mergeParentTarget.abbreviatedOid,
                label: mergeParentTarget.subject,
                parentOids: mergeParentTarget.parentOids,
              }
            : null
        }
        onClose={() => setMergeParentTarget(null)}
      />

      <CompareCommitsDialog />
    </section>
  );
}
