import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ChangedFile, RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { ContextMenuTrigger } from '@renderer/components/GitContextMenu';
import { Dialog } from '@renderer/components/Dialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { TextInput } from '@renderer/components/TextInput';
import { useChangedFileContextMenuItems } from '@renderer/lib/gitContextMenuItems';
import { ConflictResolveBar } from '@renderer/features/git/recovery/ConflictResolveBar';
import { ChevronDownIcon, ChevronRightIcon } from '@renderer/components/icons';
import './ChangesPanel.css';

const DISCARD_ALL_CONFIRM_PHRASE = 'DISCARD';

type Props = {
  projectId: string;
  snapshot?: RepositorySnapshot;
  readOnly: boolean;
};

function splitPath(fullPath: string): { name: string; parent: string } {
  const normalized = fullPath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return { name: fullPath, parent: '' };
  return { name: normalized.slice(idx + 1), parent: normalized.slice(0, idx) };
}

function statusLabel(indexCode: string, worktreeCode: string, unmerged: boolean): string {
  if (unmerged) return 'Conflict';
  if (indexCode === '?' && worktreeCode === '?') return 'Untracked';
  if (indexCode !== ' ' && worktreeCode === ' ') return 'Staged';
  if (indexCode === ' ' && worktreeCode !== ' ') return 'Modified';
  return 'Changed';
}

type ChangedFileRowProps = {
  projectId: string;
  file: ChangedFile;
  area: 'staged' | 'unstaged';
  selected: boolean;
  readOnly: boolean;
  revision?: string;
  busy: boolean;
  onSelect: () => void;
  onDiscard: () => void;
  onToggleStage: () => void;
};

function ChangedFileRow({
  projectId,
  file,
  area,
  selected,
  readOnly,
  revision,
  busy,
  onSelect,
  onDiscard,
  onToggleStage,
}: ChangedFileRowProps): ReactElement {
  const menuItems = useChangedFileContextMenuItems({
    projectId,
    file,
    area,
    revision,
    readOnly,
    busy,
    onDiscard,
  });
  const pathParts = splitPath(file.path);
  const label = statusLabel(file.indexCode, file.worktreeCode, file.unmerged);

  return (
    <ContextMenuTrigger menu={menuItems}>
      <li className="changes-panel__item">
        <button
          type="button"
          className={`changes-panel__file ${selected ? 'changes-panel__file--selected' : ''} ${file.unmerged ? 'changes-panel__file--conflict' : ''}`}
          onClick={onSelect}
          title={file.path}
        >
          <span className="changes-panel__codes" aria-label={label}>
            {file.indexCode}
            {file.worktreeCode}
          </span>
          <span className="changes-panel__path">
            <span className="changes-panel__filename">{pathParts.name}</span>
            {pathParts.parent ? (
              <span className="changes-panel__parent"> {pathParts.parent}</span>
            ) : null}
          </span>
        </button>
        <div className="changes-panel__actions">
          {!readOnly && revision ? (
            <Checkbox
              checked={file.staged}
              disabled={busy}
              label={file.staged ? 'Staged' : 'Unstaged'}
              className="changes-panel__stage-toggle"
              onCheckedChange={onToggleStage}
            />
          ) : null}
          {!readOnly && revision && (file.unstaged || file.untracked) ? (
            <Button variant="ghost" disabled={busy} onClick={onDiscard}>
              Discard
            </Button>
          ) : null}
        </div>
      </li>
    </ContextMenuTrigger>
  );
}

export function ChangesPanel({ projectId, snapshot, readOnly }: Props): ReactElement {
  const selectedFile = useGitStore((s) => s.selectedFile);
  const loadDiff = useGitStore((s) => s.loadDiff);
  const stageFile = useGitStore((s) => s.stageFile);
  const unstageFile = useGitStore((s) => s.unstageFile);
  const stageAll = useGitStore((s) => s.stageAll);
  const unstageAll = useGitStore((s) => s.unstageAll);
  const discardFile = useGitStore((s) => s.discardFile);
  const discardAll = useGitStore((s) => s.discardAll);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);
  const confirmDiscard = useGitStore((s) => s.settings?.confirmations.discardChanges ?? true);

  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [conflictsOpen, setConflictsOpen] = useState(true);
  const [discardTarget, setDiscardTarget] = useState<{ path: string; revision: string } | null>(
    null
  );
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
  const [discardAllPhrase, setDiscardAllPhrase] = useState('');
  const discardAllInputRef = useRef<HTMLInputElement>(null);

  const files = snapshot?.changedFiles ?? [];
  const revision = snapshot?.revision;
  const conflictFiles = files.filter((f) => f.unmerged);
  const stagedFiles = files.filter((f) => f.staged && !f.unmerged);
  const unstagedFiles = files.filter((f) => (f.unstaged || f.untracked) && !f.unmerged);
  const discardAllConfirmed = discardAllPhrase === DISCARD_ALL_CONFIRM_PHRASE;
  const selectedConflict =
    selectedFile &&
    conflictFiles.some((f) => f.path === selectedFile.path) &&
    revision;

  useEffect(() => {
    if (!discardAllOpen) {
      setDiscardAllPhrase('');
    }
  }, [discardAllOpen]);

  const closeDiscardAll = () => setDiscardAllOpen(false);

  const renderFile = (file: ChangedFile, area: 'staged' | 'unstaged') => {
    const selected =
      selectedFile?.projectId === projectId &&
      selectedFile.path === file.path &&
      selectedFile.area === area;
    const busy = Boolean(operation);

    return (
      <ChangedFileRow
        key={`${file.path}-${area}`}
        projectId={projectId}
        file={file}
        area={area}
        selected={selected}
        readOnly={readOnly}
        revision={revision}
        busy={busy}
        onSelect={() => loadDiff(projectId, file.path, area)}
        onDiscard={() => {
          if (!revision) return;
          if (!confirmDiscard) {
            discardFile(projectId, revision, file.path);
            return;
          }
          setDiscardTarget({ path: file.path, revision });
        }}
        onToggleStage={() =>
          revision &&
          (file.staged
            ? unstageFile(projectId, revision, file.path)
            : stageFile(projectId, revision, file.path))
        }
      />
    );
  };

  return (
    <section className="changes-panel" aria-label="Changed files" id="changes-panel">
      {files.length === 0 ? (
        <EmptyState title="Working tree clean" description="No changed files in this repository." />
      ) : (
        <>
          {conflictFiles.length > 0 ? (
            <div className="changes-panel__group changes-panel__group--conflicts">
              <div className="changes-panel__group-header">
                <button
                  type="button"
                  className="changes-panel__group-toggle"
                  onClick={() => setConflictsOpen((o) => !o)}
                  aria-expanded={conflictsOpen}
                >
                  {conflictsOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  <span>Conflicts</span>
                  <span className="changes-panel__group-count">{conflictFiles.length}</span>
                </button>
              </div>
              {conflictsOpen ? (
                <ul className="changes-panel__list">
                  {conflictFiles.map((file) => renderFile(file, 'unstaged'))}
                </ul>
              ) : null}
              {selectedConflict ? (
                <ConflictResolveBar
                  projectId={projectId}
                  path={selectedFile!.path}
                  revision={revision!}
                  readOnly={readOnly}
                  busy={Boolean(operation)}
                />
              ) : null}
            </div>
          ) : null}
          <div className="changes-panel__group">
            <div className="changes-panel__group-header">
              <button
                type="button"
                className="changes-panel__group-toggle"
                onClick={() => setStagedOpen((o) => !o)}
                aria-expanded={stagedOpen}
              >
                {stagedOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                <span>Staged changes</span>
                <span className="changes-panel__group-count">{stagedFiles.length}</span>
              </button>
              {!readOnly && revision ? (
                <div className="changes-panel__group-actions">
                  <Button
                    variant="ghost"
                    disabled={Boolean(operation) || unstagedFiles.length === 0}
                    onClick={() => stageAll(projectId, revision)}
                  >
                    Stage all
                  </Button>
                </div>
              ) : null}
            </div>
            {stagedOpen ? (
              <ul className="changes-panel__list">
                {stagedFiles.length === 0 ? (
                  <li className="changes-panel__empty">No staged changes</li>
                ) : (
                  stagedFiles.map((f) => renderFile(f, 'staged'))
                )}
              </ul>
            ) : null}
          </div>

          <div className="changes-panel__group">
            <div className="changes-panel__group-header">
              <button
                type="button"
                className="changes-panel__group-toggle"
                onClick={() => setUnstagedOpen((o) => !o)}
                aria-expanded={unstagedOpen}
              >
                {unstagedOpen ? <ChevronDownIcon /> : <ChevronRightIcon />}
                <span>Changes</span>
                <span className="changes-panel__group-count">{unstagedFiles.length}</span>
              </button>
              {!readOnly && revision ? (
                <div className="changes-panel__group-actions">
                  <Button
                    variant="ghost"
                    disabled={Boolean(operation) || stagedFiles.length === 0}
                    onClick={() => unstageAll(projectId, revision)}
                  >
                    Unstage all
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={Boolean(operation) || unstagedFiles.length === 0}
                    onClick={() => setDiscardAllOpen(true)}
                  >
                    Discard all
                  </Button>
                </div>
              ) : null}
            </div>
            {unstagedOpen ? (
              <ul className="changes-panel__list">
                {unstagedFiles.length === 0 ? (
                  <li className="changes-panel__empty">No unstaged changes</li>
                ) : (
                  unstagedFiles.map((f) => renderFile(f, 'unstaged'))
                )}
              </ul>
            ) : null}
          </div>
        </>
      )}

      <Dialog
        open={Boolean(discardTarget)}
        title="Discard changes?"
        description={
          <>
            Changes to{' '}
            {discardTarget?.path ? (
              <span className="mono">{discardTarget.path}</span>
            ) : (
              'this file'
            )}{' '}
            will be permanently lost. This cannot be undone.
          </>
        }
        onClose={() => setDiscardTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDiscardTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (discardTarget) {
                  discardFile(projectId, discardTarget.revision, discardTarget.path);
                  setDiscardTarget(null);
                }
              }}
            >
              Discard changes
            </Button>
          </>
        }
      />

      <Dialog
        open={discardAllOpen}
        title="Discard all changes?"
        description={`This permanently discards every unstaged and untracked change in this repository (${unstagedFiles.length} file${unstagedFiles.length === 1 ? '' : 's'}). Staged changes are kept. This cannot be undone and cannot be skipped.`}
        initialFocusRef={discardAllInputRef}
        onClose={closeDiscardAll}
        actions={
          <>
            <Button variant="secondary" onClick={closeDiscardAll}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!discardAllConfirmed || Boolean(operation) || !revision}
              onClick={() => {
                if (!revision || !discardAllConfirmed) return;
                discardAll(projectId, revision);
                closeDiscardAll();
              }}
            >
              Discard all changes
            </Button>
          </>
        }
      >
        <label className="changes-panel__confirm-label" htmlFor="discard-all-confirm">
          Type <code>{DISCARD_ALL_CONFIRM_PHRASE}</code> to confirm
        </label>
        <TextInput
          ref={discardAllInputRef}
          id="discard-all-confirm"
          label={`Type ${DISCARD_ALL_CONFIRM_PHRASE} to confirm`}
          hideLabel
          value={discardAllPhrase}
          autoComplete="off"
          spellCheck={false}
          placeholder={DISCARD_ALL_CONFIRM_PHRASE}
          onChange={(e) => setDiscardAllPhrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && discardAllConfirmed && revision && !operation) {
              e.preventDefault();
              discardAll(projectId, revision);
              closeDiscardAll();
            }
          }}
        />
      </Dialog>
    </section>
  );
}
