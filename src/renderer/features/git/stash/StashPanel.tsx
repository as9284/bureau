import { useState, type ReactElement } from 'react';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { ContextMenuTrigger } from '@renderer/components/GitContextMenu';
import { Dialog } from '@renderer/components/Dialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { Skeleton } from '@renderer/components/Skeleton';
import { PanelError } from '@renderer/features/git/PanelState';
import { TextInput } from '@renderer/components/TextInput';
import {
  useStashContextMenuItems,
  useStashFileContextMenuItems,
} from '@renderer/lib/gitContextMenuItems';
import './StashPanel.css';

type Props = {
  projectId: string;
  snapshot?: RepositorySnapshot;
  readOnly: boolean;
};

type StashRowProps = {
  projectId: string;
  index: number;
  message: string;
  selected: boolean;
  revision?: string;
  readOnly: boolean;
  busy: boolean;
  onSelect: () => void;
  onApply: () => void;
  onPop: () => void;
  onDrop: () => void;
  onCreateBranch: () => void;
};

function StashRow({
  projectId,
  index,
  message,
  selected,
  revision,
  readOnly,
  busy,
  onSelect,
  onApply,
  onPop,
  onDrop,
  onCreateBranch,
}: StashRowProps): ReactElement {
  const menuItems = useStashContextMenuItems({
    projectId,
    index,
    revision,
    readOnly,
    busy,
    onApply,
    onPop,
    onDrop,
    onCreateBranch,
  });

  return (
    <ContextMenuTrigger menu={menuItems}>
      <li className={`stash-panel__item ${selected ? 'stash-panel__item--selected' : ''}`}>
        <button type="button" className="stash-panel__select" onClick={onSelect}>
          <div className="stash-panel__copy">
            <code>
              stash@{'{'}
              {index}
              {'}'}
            </code>
            <span>{message || 'WIP'}</span>
          </div>
        </button>
        {!readOnly && revision ? (
          <div className="stash-panel__item-actions">
            <Button variant="ghost" disabled={busy} onClick={onApply}>
              Apply
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onPop}>
              Pop
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onDrop}>
              Drop
            </Button>
          </div>
        ) : null}
      </li>
    </ContextMenuTrigger>
  );
}

function StashFileRow({
  file,
  selected,
  revision,
  readOnly,
  busy,
  onSelect,
  onRestore,
}: {
  file: { path: string; status: string };
  selected: boolean;
  revision?: string;
  readOnly: boolean;
  busy: boolean;
  onSelect: () => void;
  onRestore: () => void;
}): ReactElement {
  const menuItems = useStashFileContextMenuItems({
    readOnly,
    revision,
    busy,
    onRestore,
  });

  return (
    <ContextMenuTrigger menu={menuItems}>
      <li className="stash-panel__file-item">
        <button
          type="button"
          className={`stash-panel__file ${selected ? 'stash-panel__file--selected' : ''}`}
          onClick={onSelect}
        >
          <span className="stash-panel__file-status">{file.status}</span>
          <span className="stash-panel__file-path">{file.path}</span>
        </button>
        {!readOnly && revision ? (
          <Button variant="ghost" disabled={busy} onClick={onRestore}>
            Restore
          </Button>
        ) : null}
      </li>
    </ContextMenuTrigger>
  );
}

export function StashPanel({ projectId, snapshot, readOnly }: Props): ReactElement {
  const stashEntries = useGitStore((s) => s.stashEntries);
  const stashLoading = useGitStore((s) => s.stashLoading);
  const stashError = useGitStore((s) => s.stashError);
  const selectedStashIndex = useGitStore((s) => s.selectedStashIndex);
  const stashFiles = useGitStore((s) => s.stashFiles);
  const selectedFile = useGitStore((s) => s.selectedFile);
  const loadStash = useGitStore((s) => s.loadStash);
  const stashPush = useGitStore((s) => s.stashPush);
  const stashPop = useGitStore((s) => s.stashPop);
  const stashDrop = useGitStore((s) => s.stashDrop);
  const stashApply = useGitStore((s) => s.stashApply);
  const stashBranch = useGitStore((s) => s.stashBranch);
  const stashRestoreFiles = useGitStore((s) => s.stashRestoreFiles);
  const selectStash = useGitStore((s) => s.selectStash);
  const loadStashDiff = useGitStore((s) => s.loadStashDiff);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);
  const confirmDrop = useGitStore((s) => s.settings?.confirmations.dropStash ?? true);

  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [branchTarget, setBranchTarget] = useState<number | null>(null);
  const [branchName, setBranchName] = useState('');
  const [includeUntracked, setIncludeUntracked] = useState(false);

  const revision = snapshot?.revision;
  const busy = Boolean(operation);

  const openCreateBranch = (index: number) => {
    setBranchTarget(index);
    setBranchName('');
  };

  return (
    <section className="stash-panel" aria-label="Stashes">
      <div className="stash-panel__list-pane">
        <header className="stash-panel__header">
          <h2>Stashes</h2>
          <div className="stash-panel__actions">
            <Button variant="ghost" onClick={() => loadStash(projectId)}>
              Refresh
            </Button>
          </div>
        </header>

        {/* The push controls are their own toolbar row: the pane is one narrow
            column beside the diff, too tight to share a line with the title. */}
        {!readOnly && revision ? (
          <div className="stash-panel__create">
            <Checkbox
              checked={includeUntracked}
              onCheckedChange={setIncludeUntracked}
              label="Include untracked"
            />
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => stashPush(projectId, revision, undefined, includeUntracked)}
            >
              Stash changes
            </Button>
          </div>
        ) : null}

        {stashError ? (
          <PanelError
            title="Could not load stashes"
            message={stashError.message}
            onRetry={() => void loadStash(projectId)}
          />
        ) : null}

        {stashLoading && stashEntries.length === 0 ? (
          <div className="stash-panel__loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} width="100%" height="var(--size-hub-row)" />
            ))}
          </div>
        ) : stashEntries.length === 0 ? (
          stashError ? null : (
            <EmptyState
              title="No stashes"
              description="Stash your current changes to switch branches without committing."
            />
          )
        ) : (
          <ul
            className={`stash-panel__list ${stashLoading ? 'git-stale' : ''}`}
            aria-busy={stashLoading}
          >
            {stashEntries.map((entry) => (
              <StashRow
                key={entry.index}
                projectId={projectId}
                index={entry.index}
                message={entry.message}
                selected={selectedStashIndex === entry.index}
                revision={revision}
                readOnly={readOnly}
                busy={busy}
                onSelect={() => selectStash(projectId, entry.index)}
                onApply={() => revision && stashApply(projectId, revision, entry.index)}
                onPop={() => revision && stashPop(projectId, revision, entry.index)}
                onDrop={() => {
                  if (!confirmDrop && revision) {
                    stashDrop(projectId, revision, entry.index);
                    return;
                  }
                  setDropTarget(entry.index);
                }}
                onCreateBranch={() => openCreateBranch(entry.index)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="stash-panel__files-pane" aria-label="Stash files">
        <header className="stash-panel__header">
          <h2>Files</h2>
          {/* Machine text when it names a stash, prose when it prompts — so the mono
              treatment follows the content rather than the element. */}
          <p className={`stash-panel__hint${selectedStashIndex != null ? ' mono' : ''}`}>
            {selectedStashIndex != null
              ? `stash@{${selectedStashIndex}}`
              : 'Select a stash to browse files'}
          </p>
        </header>

        {selectedStashIndex == null ? (
          <EmptyState title="Select a stash" description="Pick a stash to see changed files." />
        ) : stashFiles.length === 0 ? (
          <EmptyState title="No files" description="This stash has no file changes." />
        ) : (
          <ul className="stash-panel__file-list">
            {stashFiles.map((file) => (
              <StashFileRow
                key={file.path}
                file={file}
                selected={
                  selectedFile?.projectId === projectId &&
                  selectedFile.path === file.path &&
                  selectedFile.area === 'stash' &&
                  selectedFile.stashIndex === selectedStashIndex
                }
                revision={revision}
                readOnly={readOnly}
                busy={busy}
                onSelect={() => loadStashDiff(projectId, selectedStashIndex, file.path)}
                onRestore={() => {
                  if (revision != null) {
                    stashRestoreFiles(projectId, revision, selectedStashIndex, [file.path]);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={dropTarget !== null}
        title="Drop stash?"
        description="The stash will be permanently deleted. This cannot be undone."
        onClose={() => setDropTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDropTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (dropTarget !== null && revision) {
                  stashDrop(projectId, revision, dropTarget);
                  setDropTarget(null);
                }
              }}
            >
              Drop stash
            </Button>
          </>
        }
      />

      <Dialog
        open={branchTarget !== null}
        title="Create branch from stash"
        description={
          <>
            Create a branch from <span className="mono">{`stash@{${branchTarget}}`}</span>.
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
                if (branchTarget !== null && revision && branchName.trim()) {
                  stashBranch(projectId, revision, branchTarget, branchName.trim());
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
          placeholder="feature/from-stash"
        />
      </Dialog>
    </section>
  );
}
