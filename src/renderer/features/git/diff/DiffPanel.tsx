import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { useAppStore } from '@renderer/store/appStore';
import { Button } from '@renderer/components/Button';
import { ContextMenuTrigger } from '@renderer/components/GitContextMenu';
import { Dialog } from '@renderer/components/Dialog';
import { IconButton } from '@renderer/components/IconButton';
import { ExpandIcon, CollapseIcon } from '@renderer/components/icons';
import { useDiffContextMenuItems } from '@renderer/lib/gitContextMenuItems';
import {
  buildHunkPatch,
  parseUnifiedDiff,
  type ParsedDiffHunk,
  type ParsedDiffLine,
} from './parseUnifiedDiff';
import './DiffPanel.css';

function renderHighlightedText(line: ParsedDiffLine): ReactNode {
  const ranges = line.highlightRanges;
  if (!ranges || ranges.length === 0) {
    return line.text.length === 0 ? '\u00A0' : line.text;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(line.text.slice(cursor, range.start));
    }
    parts.push(
      <mark key={`${index}-${range.start}`} className="diff-panel__inline">
        {line.text.slice(range.start, range.end) || '\u00A0'}
      </mark>
    );
    cursor = range.end;
  });
  if (cursor < line.text.length) {
    parts.push(line.text.slice(cursor));
  }
  return parts.length > 0 ? parts : '\u00A0';
}

function DiffLineRow({ line }: { line: ParsedDiffLine }): ReactElement | null {
  if (line.kind === 'hunk') return null;

  const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : '';

  return (
    <div className={`diff-panel__row diff-panel__row--${line.kind}`}>
      <div className="diff-panel__gutter" aria-hidden="true">
        <span className="diff-panel__line-no">{line.oldLine ?? ''}</span>
        <span className="diff-panel__line-no">{line.newLine ?? ''}</span>
        <span className="diff-panel__marker">{marker}</span>
      </div>
      <pre className="diff-panel__code">{renderHighlightedText(line)}</pre>
    </div>
  );
}

type HunkBlockProps = {
  hunk: ParsedDiffHunk;
  hunkIndex: number;
  path: string;
  area: 'staged' | 'unstaged';
  revision?: string;
  readOnly: boolean;
  busy: boolean;
  confirmDiscard: boolean;
  onApply: (patch: string, action: 'stage' | 'unstage' | 'discard') => void;
};

function HunkBlock({
  hunk,
  hunkIndex,
  path,
  area,
  readOnly,
  busy,
  revision,
  confirmDiscard,
  onApply,
}: HunkBlockProps): ReactElement {
  const [discardOpen, setDiscardOpen] = useState(false);
  const patch = useMemo(() => buildHunkPatch(path, hunk), [path, hunk]);
  const canMutate = !readOnly && Boolean(revision) && !busy;

  const runDiscard = () => {
    onApply(patch, 'discard');
    setDiscardOpen(false);
  };

  return (
    <div className="diff-panel__hunk">
      <div className="diff-panel__hunk-header">
        <pre className="diff-panel__hunk-title">{hunk.header}</pre>
        {area === 'staged' || area === 'unstaged' ? (
          <div className="diff-panel__hunk-actions">
            {area === 'unstaged' ? (
              <Button
                variant="ghost"
                disabled={!canMutate}
                onClick={() => onApply(patch, 'stage')}
              >
                Stage
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={!canMutate}
                onClick={() => onApply(patch, 'unstage')}
              >
                Unstage
              </Button>
            )}
            {area === 'unstaged' ? (
              <Button
                variant="ghost"
                disabled={!canMutate}
                onClick={() => {
                  if (confirmDiscard) {
                    setDiscardOpen(true);
                    return;
                  }
                  runDiscard();
                }}
              >
                Discard
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {hunk.lines.map((line, lineIndex) => (
        <DiffLineRow key={`${hunkIndex}-${lineIndex}-${line.kind}`} line={line} />
      ))}
      <Dialog
        open={discardOpen}
        title="Discard hunk?"
        description="This hunk's changes will be permanently discarded from the working tree."
        onClose={() => setDiscardOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDiscardOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={runDiscard}>
              Discard hunk
            </Button>
          </>
        }
      />
    </div>
  );
}

export function DiffPanel(): ReactElement {
  const selectedFile = useGitStore((s) => s.selectedFile);
  const diffText = useGitStore((s) => s.diffText);
  const diffLoading = useGitStore((s) => s.diffLoading);
  const blameLines = useGitStore((s) => s.blameLines);
  const blameLoading = useGitStore((s) => s.blameLoading);
  const blameHasMore = useGitStore((s) => s.blameHasMore);
  const loadBlame = useGitStore((s) => s.loadBlame);
  const clearBlame = useGitStore((s) => s.clearBlame);
  const applyHunk = useGitStore((s) => s.applyHunk);
  const confirmDiscard = useGitStore((s) => s.settings?.confirmations.discardChanges ?? true);
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'diff' | 'blame'>('diff');

  const projectId = selectedFile?.projectId;
  const snapshot = useGitStore((s) => (projectId ? s.repos[projectId]?.snapshot : undefined));
  const operation = useGitStore((s) => (projectId ? s.operationByRepo[projectId] : undefined));
  const revision = snapshot?.revision;
  const readOnly = Boolean(snapshot?.blockedOperation);
  const busy = Boolean(operation);

  const parsed = useMemo(() => parseUnifiedDiff(diffText), [diffText]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setExpanded(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expanded]);

  useEffect(() => {
    if (!selectedFile) {
      setExpanded(false);
      setViewMode('diff');
      clearBlame();
    }
  }, [selectedFile, clearBlame]);

  const canBlame = selectedFile?.area === 'commit' && Boolean(selectedFile.commitOid);

  useEffect(() => {
    if (viewMode !== 'blame' || !canBlame || !selectedFile?.commitOid) return;
    loadBlame(selectedFile.projectId, selectedFile.path, selectedFile.commitOid).catch(
      () => undefined
    );
  }, [viewMode, canBlame, selectedFile, loadBlame]);

  const fileName = selectedFile?.path.split(/[/\\]/).at(-1) ?? '';
  const historyCommits = useGitStore((s) => s.historyCommits);
  const selectedCommit = historyCommits.find((c) => c.oid === selectedFile?.commitOid);
  const areaLabel =
    selectedFile?.area === 'staged'
      ? 'Staged'
      : selectedFile?.area === 'stash'
        ? `Stash @${selectedFile.stashIndex ?? 0}`
        : selectedFile?.area === 'commit'
          ? selectedCommit
            ? `Commit ${selectedCommit.abbreviatedOid}`
            : 'Commit'
          : 'Unstaged';
  const emptyHint =
    selectedFile?.area === 'commit' || selectedFile?.area === 'stash' || !selectedFile
      ? 'Select a file to preview the diff.'
      : 'Select a changed file to preview the diff.';
  const diffMenuItems = useDiffContextMenuItems(selectedFile?.path);
  const isBinaryDiff = Boolean(diffText && /(?:Binary files|GIT binary patch)/.test(diffText));
  const canOpenWorkingCopy =
    selectedFile?.area === 'staged' || selectedFile?.area === 'unstaged';

  const openWorkingCopyInFiles = async () => {
    if (!selectedFile || !canOpenWorkingCopy) return;
    const appStore = useAppStore.getState();
    await appStore.ensureFilesProject(selectedFile.projectId);
    await appStore.openProjectFile(selectedFile.projectId, selectedFile.path);
    appStore.setProjectTab('files');
  };

  const handleHunkAction = (patch: string, action: 'stage' | 'unstage' | 'discard') => {
    if (!selectedFile || !revision) return;
    if (selectedFile.area !== 'staged' && selectedFile.area !== 'unstaged') return;
    applyHunk(selectedFile.projectId, revision, selectedFile.path, selectedFile.area, patch, action);
  };

  return (
    <section
      className={`diff-panel${expanded ? ' diff-panel--expanded' : ''}`}
      aria-label="Diff viewer"
      aria-modal={expanded || undefined}
    >
      <ContextMenuTrigger menu={diffMenuItems}>
        <header className="diff-panel__header">
          <div className="diff-panel__header-main">
            <h2>{selectedFile ? fileName : 'Diff'}</h2>
            {selectedFile ? (
              <p className="diff-panel__path" title={selectedFile.path}>
                <span className="diff-panel__area">{areaLabel}</span>
                <span className="diff-panel__sep">·</span>
                <span className="diff-panel__path-text">{selectedFile.path}</span>
              </p>
            ) : null}
          </div>
          {canBlame ? (
            <div className="diff-panel__mode-toggle" role="tablist" aria-label="Diff view mode">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'diff'}
                className={`diff-panel__mode-btn ${viewMode === 'diff' ? 'diff-panel__mode-btn--active' : ''}`}
                onClick={() => setViewMode('diff')}
              >
                Diff
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'blame'}
                className={`diff-panel__mode-btn ${viewMode === 'blame' ? 'diff-panel__mode-btn--active' : ''}`}
                onClick={() => setViewMode('blame')}
              >
                Blame
              </button>
            </div>
          ) : null}
          <IconButton
            label={expanded ? 'Exit fullscreen' : 'Expand diff'}
            onClick={() => setExpanded((value) => !value)}
            disabled={!selectedFile}
          >
            {expanded ? <CollapseIcon /> : <ExpandIcon />}
          </IconButton>
        </header>
      </ContextMenuTrigger>

      <div className="diff-panel__body" aria-label="File diff">
        {viewMode === 'blame' && canBlame ? (
          blameLoading && blameLines.length === 0 ? (
            <div className="diff-panel__empty">Loading blame…</div>
          ) : blameLines.length === 0 ? (
            <div className="diff-panel__empty">No blame data for this file.</div>
          ) : (
            <>
              <div className="diff-panel__blame">
                {blameLines.map((line) => (
                  <div key={`${line.lineNumber}-${line.oid}`} className="diff-panel__blame-row">
                    <div className="diff-panel__blame-meta">
                      <span className="diff-panel__blame-oid" title={line.oid}>
                        {line.abbreviatedOid}
                      </span>
                      <span className="diff-panel__blame-author" title={line.authorName}>
                        {line.authorName}
                      </span>
                      <span className="diff-panel__blame-line">{line.lineNumber}</span>
                    </div>
                    <pre className="diff-panel__blame-code">{line.content || '\u00A0'}</pre>
                  </div>
                ))}
              </div>
              {blameHasMore ? (
                <div className="diff-panel__blame-more">
                  <Button
                    variant="secondary"
                    loading={blameLoading}
                    onClick={() => {
                      if (selectedFile?.commitOid) {
                        loadBlame(
                          selectedFile.projectId,
                          selectedFile.path,
                          selectedFile.commitOid,
                          true
                        );
                      }
                    }}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          )
        ) : diffLoading ? (
          <div className="diff-panel__empty">Loading diff…</div>
        ) : !selectedFile ? (
          <div className="diff-panel__empty">{emptyHint}</div>
        ) : parsed.isEmpty ? (
          <div className="diff-panel__empty">No changes in this file.</div>
        ) : parsed.isRawFallback ? (
          <>
            {isBinaryDiff ? (
              <div className="diff-panel__binary" role="status">
                <div>
                  <strong>Binary file</strong>
                  <p>Git cannot show this change line by line.</p>
                </div>
                {canOpenWorkingCopy ? (
                  <Button size="compact" variant="secondary" onClick={() => void openWorkingCopyInFiles()}>
                    Open working copy in Files
                  </Button>
                ) : null}
              </div>
            ) : null}
            <pre className="diff-panel__fallback">{parsed.raw}</pre>
          </>
        ) : (
          parsed.hunks.map((hunk, hunkIndex) =>
            selectedFile.area === 'staged' || selectedFile.area === 'unstaged' ? (
              <HunkBlock
                key={`${hunk.header}-${hunkIndex}`}
                hunk={hunk}
                hunkIndex={hunkIndex}
                path={selectedFile.path}
                area={selectedFile.area}
                revision={revision}
                readOnly={readOnly}
                busy={busy}
                confirmDiscard={confirmDiscard}
                onApply={handleHunkAction}
              />
            ) : (
              <div key={`${hunk.header}-${hunkIndex}`} className="diff-panel__hunk">
                <div className="diff-panel__hunk-header">
                  <pre className="diff-panel__hunk-title">{hunk.header}</pre>
                </div>
                {hunk.lines.map((line, lineIndex) => (
                  <DiffLineRow key={`${hunkIndex}-${lineIndex}-${line.kind}`} line={line} />
                ))}
              </div>
            )
          )
        )}
      </div>
    </section>
  );
}
