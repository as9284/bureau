import { useState, type ReactElement } from 'react';
import type { WorktreeEntry } from '@shared/contracts/advanced';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { Skeleton } from '@renderer/components/Skeleton';
import { TextInput } from '@renderer/components/TextInput';
import './WorktreesPanel.css';

type Props = {
  projectId: string;
  snapshot?: RepositorySnapshot;
  readOnly: boolean;
};

export function WorktreesPanel({ projectId, snapshot, readOnly }: Props): ReactElement {
  const worktrees = useGitStore((s) => s.worktrees);
  const worktreesLoading = useGitStore((s) => s.worktreesLoading);
  const loadWorktrees = useGitStore((s) => s.loadWorktrees);
  const addWorktree = useGitStore((s) => s.addWorktree);
  const removeWorktree = useGitStore((s) => s.removeWorktree);
  const lockWorktree = useGitStore((s) => s.lockWorktree);
  const unlockWorktree = useGitStore((s) => s.unlockWorktree);
  const pruneWorktrees = useGitStore((s) => s.pruneWorktrees);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);

  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WorktreeEntry | null>(null);
  const [wtPath, setWtPath] = useState('');
  const [branch, setBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');

  const revision = snapshot?.revision;
  const busy = Boolean(operation);

  const browsePath = async () => {
    const result = await window.bureau.system.chooseDirectory({
      title: 'Choose worktree directory',
      buttonLabel: 'Select',
    });
    if (!result.cancelled && result.path) {
      setWtPath(result.path);
    }
  };

  return (
    <section className="worktrees-panel" aria-label="Worktrees">
      <header className="worktrees-panel__header">
        <h2>Worktrees</h2>
        <div className="worktrees-panel__actions">
          {!readOnly && revision ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setAddOpen(true)}
              >
                Add
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => pruneWorktrees(projectId, revision)}
              >
                Prune
              </Button>
            </>
          ) : null}
          <Button variant="ghost" onClick={() => loadWorktrees(projectId)}>
            Refresh
          </Button>
        </div>
      </header>

      {worktreesLoading ? (
        <div className="worktrees-panel__loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width="100%" height="40px" />
          ))}
        </div>
      ) : worktrees.length === 0 ? (
        <EmptyState
          title="No linked worktrees"
          description="Add a worktree to check out another branch in a separate directory."
        />
      ) : (
        <ul className="worktrees-panel__list">
          {worktrees.map((wt) => (
            <li
              key={wt.path}
              className={`worktrees-panel__item ${wt.isCurrent ? 'worktrees-panel__item--current' : ''}`}
            >
              <div className="worktrees-panel__copy">
                <span className="worktrees-panel__path" title={wt.path}>
                  {wt.path}
                </span>
                <span className="worktrees-panel__meta">
                  {wt.branch ?? 'detached'} · {wt.headOid.slice(0, 7)}
                  {wt.locked ? ' · locked' : ''}
                  {wt.prunable ? ' · prunable' : ''}
                  {wt.isCurrent ? ' · current' : ''}
                </span>
              </div>
              {!readOnly && revision && !wt.isCurrent ? (
                <div className="worktrees-panel__item-actions">
                  {wt.locked ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => unlockWorktree(projectId, revision, wt.path)}
                    >
                      Unlock
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => lockWorktree(projectId, revision, wt.path)}
                    >
                      Lock
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setRemoveTarget(wt)}
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={addOpen}
        title="Add worktree"
        description="Create a linked working directory for another branch."
        onClose={() => setAddOpen(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!wtPath.trim() || busy || !revision}
              onClick={() => {
                if (!revision || !wtPath.trim()) return;
                addWorktree(projectId, revision, wtPath.trim(), {
                  branch: branch.trim() || undefined,
                  newBranch: newBranch.trim() || undefined,
                });
                setAddOpen(false);
                setWtPath('');
                setBranch('');
                setNewBranch('');
              }}
            >
              Add worktree
            </Button>
          </>
        }
      >
        <div className="worktrees-panel__fields">
          <div className="worktrees-panel__path-row">
            <TextInput
              label="Directory path"
              value={wtPath}
              onChange={(e) => setWtPath(e.target.value)}
              placeholder="C:\Projects\my-repo-feature"
            />
            <Button variant="secondary" onClick={() => browsePath()}>
              Browse…
            </Button>
          </div>
          <TextInput
            label="Existing branch (optional)"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="feature/my-branch"
          />
          <TextInput
            label="New branch name (optional)"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            placeholder="feature/new-branch"
          />
        </div>
      </Dialog>

      <Dialog
        open={Boolean(removeTarget)}
        title="Remove worktree?"
        description="The worktree directory will be removed from Git tracking. Uncommitted changes may be lost."
        onClose={() => setRemoveTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removeTarget && revision) {
                  removeWorktree(projectId, revision, removeTarget.path);
                  setRemoveTarget(null);
                }
              }}
            >
              Remove
            </Button>
          </>
        }
      />
    </section>
  );
}
