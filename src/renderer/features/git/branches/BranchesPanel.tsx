import { useState, type ReactElement } from 'react';
import type { BranchDetail } from '@shared/contracts/branches';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { TextInput } from '@renderer/components/TextInput';
import { ContextMenuTrigger } from '@renderer/components/GitContextMenu';
import { Dialog } from '@renderer/components/Dialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { Skeleton } from '@renderer/components/Skeleton';
import { PanelError } from '@renderer/features/git/PanelState';
import { BranchIcon } from '@renderer/components/icons';
import { useBranchContextMenuItems } from '@renderer/lib/gitContextMenuItems';
import './BranchesPanel.css';

type Props = {
  projectId: string;
  snapshot?: RepositorySnapshot;
  readOnly: boolean;
};

type BranchRowProps = {
  projectId: string;
  branch: BranchDetail;
  revision?: string;
  readOnly: boolean;
  busy: boolean;
  onCheckout: () => void;
  onDeleteLocal: () => void;
  onDeleteRemote: () => void;
  onRename: () => void;
  onSetUpstream: () => void;
  onUnsetUpstream: () => void;
  onPublish: () => void;
};

function trackingLabel(branch: BranchDetail): string | null {
  const parts: string[] = [];
  if (branch.upstreamRef) parts.push(branch.upstreamRef);
  if (branch.ahead != null && branch.ahead > 0) parts.push(`↑${branch.ahead}`);
  if (branch.behind != null && branch.behind > 0) parts.push(`↓${branch.behind}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function BranchRow({
  projectId,
  branch,
  revision,
  readOnly,
  busy,
  onCheckout,
  onDeleteLocal,
  onDeleteRemote,
  onRename,
  onSetUpstream,
  onUnsetUpstream,
  onPublish,
}: BranchRowProps): ReactElement {
  const menuItems = useBranchContextMenuItems({
    projectId,
    branch,
    revision,
    readOnly,
    busy,
    onCheckout,
    onDeleteLocal,
    onDeleteRemote,
    onRename,
    onSetUpstream,
    onUnsetUpstream,
    onPublish,
  });

  const tracking = trackingLabel(branch);

  return (
    <ContextMenuTrigger menu={menuItems}>
      <li className="branches-panel__item">
        <div className="branches-panel__name">
          <BranchIcon />
          <span title={branch.ref}>{branch.shortName}</span>
          {branch.current ? <span className="branches-panel__current">current</span> : null}
          {tracking ? <span className="branches-panel__tracking">{tracking}</span> : null}
        </div>
        <div className="branches-panel__actions">
          {!branch.current && revision && branch.kind === 'local' ? (
            <Button variant="ghost" disabled={readOnly || busy} onClick={onCheckout}>
              Checkout
            </Button>
          ) : null}
          {!branch.current && revision && branch.kind === 'remote' ? (
            <Button variant="ghost" disabled={readOnly || busy} onClick={onCheckout}>
              Checkout
            </Button>
          ) : null}
          {branch.kind === 'local' && !branch.published && revision ? (
            <Button variant="ghost" disabled={readOnly || busy} onClick={onPublish}>
              Publish
            </Button>
          ) : null}
        </div>
      </li>
    </ContextMenuTrigger>
  );
}

export function BranchesPanel({ projectId, snapshot, readOnly }: Props): ReactElement {
  const branchDetails = useGitStore((s) => s.branchDetails);
  const branchesLoading = useGitStore((s) => s.branchesLoading);
  const branchesError = useGitStore((s) => s.branchesError);
  const newBranchName = useGitStore((s) => s.newBranchName);
  const setNewBranchName = useGitStore((s) => s.setNewBranchName);
  const loadBranches = useGitStore((s) => s.loadBranches);
  const switchBranch = useGitStore((s) => s.switchBranch);
  const createBranch = useGitStore((s) => s.createBranch);
  const deleteBranch = useGitStore((s) => s.deleteBranch);
  const deleteRemoteBranch = useGitStore((s) => s.deleteRemoteBranch);
  const checkoutTracking = useGitStore((s) => s.checkoutTracking);
  const publishBranch = useGitStore((s) => s.publishBranch);
  const setGitHubPublishRepoId = useGitStore((s) => s.setGitHubPublishRepoId);
  const renameBranch = useGitStore((s) => s.renameBranch);
  const setUpstream = useGitStore((s) => s.setUpstream);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);
  const confirmDeleteLocal = useGitStore((s) => s.settings?.confirmations.deleteBranch ?? true);
  const confirmDeleteRemote = useGitStore(
    (s) => s.settings?.confirmations.deleteRemoteBranch ?? true
  );

  const [deleteLocalTarget, setDeleteLocalTarget] = useState<BranchDetail | null>(null);
  const [deleteRemoteTarget, setDeleteRemoteTarget] = useState<BranchDetail | null>(null);
  const [renameTarget, setRenameTarget] = useState<BranchDetail | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [checkoutRemoteTarget, setCheckoutRemoteTarget] = useState<BranchDetail | null>(null);
  const [checkoutLocalName, setCheckoutLocalName] = useState('');
  const [upstreamTarget, setUpstreamTarget] = useState<BranchDetail | null>(null);
  const [upstreamValue, setUpstreamValue] = useState('');
  const [publishTarget, setPublishTarget] = useState<BranchDetail | null>(null);
  const [publishRemoteName, setPublishRemoteName] = useState('origin');
  const [publishRemoteUrl, setPublishRemoteUrl] = useState('');
  const [search, setSearch] = useState('');

  const revision = snapshot?.revision;
  const busy = Boolean(operation);

  const filterBranch = (b: BranchDetail) =>
    b.shortName.toLowerCase().includes(search.toLowerCase()) ||
    b.ref.toLowerCase().includes(search.toLowerCase());

  const localBranches = branchDetails.filter((b) => b.kind === 'local' && filterBranch(b));
  const remoteBranches = branchDetails.filter((b) => b.kind === 'remote' && filterBranch(b));

  const handleCheckout = (branch: BranchDetail) => {
    if (!revision) return;
    if (branch.kind === 'local') {
      switchBranch(projectId, revision, branch.shortName);
      return;
    }
    const defaultName = branch.shortName.includes('/')
      ? branch.shortName.split('/').slice(1).join('/')
      : branch.shortName;
    setCheckoutRemoteTarget(branch);
    setCheckoutLocalName(defaultName);
  };

  return (
    <section className="branches-panel" aria-label="Branches">
      <header className="branches-panel__header">
        <h2>Branches</h2>
        <div className="branches-panel__header-actions">
          <TextInput
            label="Search branches"
            hideLabel
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="branches-panel__search"
          />
          <Button variant="ghost" onClick={() => loadBranches(projectId)}>
            Refresh
          </Button>
        </div>
      </header>

      {!readOnly && revision ? (
        <div className="branches-panel__create">
          <TextInput
            label="New branch name"
            hideLabel
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            placeholder="feature/my-branch"
            className="branches-panel__create-input"
          />
          <Button
            variant="primary"
            disabled={!newBranchName.trim() || busy}
            onClick={() => {
              createBranch(projectId, revision, newBranchName.trim());
              setNewBranchName('');
            }}
          >
            Create branch
          </Button>
        </div>
      ) : null}

      <div className="branches-panel__body">
        {branchesError ? (
          <PanelError
            title="Could not load branches"
            message={branchesError.message}
            onRetry={() => void loadBranches(projectId)}
          />
        ) : null}

        {/* Skeletons only when there is nothing to show. A refresh over an existing
          list marks it stale instead of wiping it back to placeholders. */}
        {branchesLoading && branchDetails.length === 0 ? (
          <div className="branches-panel__loading">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} width="100%" height="var(--size-list-row)" />
            ))}
          </div>
        ) : localBranches.length === 0 && remoteBranches.length === 0 ? (
          branchesError ? null : (
            <EmptyState
              title={search ? 'No matching branches' : 'No branches'}
              description={search ? 'Try a different search term.' : undefined}
            />
          )
        ) : (
          <div className={branchesLoading ? 'git-stale' : undefined} aria-busy={branchesLoading}>
            {localBranches.length > 0 ? (
              <div className="branches-panel__section">
                <h3 className="branches-panel__section-title">Local</h3>
                <ul className="branches-panel__list">
                  {localBranches.map((branch) => (
                    <BranchRow
                      key={branch.ref}
                      projectId={projectId}
                      branch={branch}
                      revision={revision}
                      readOnly={readOnly}
                      busy={busy}
                      onCheckout={() => handleCheckout(branch)}
                      onDeleteLocal={() => {
                        if (!confirmDeleteLocal && revision) {
                          deleteBranch(projectId, revision, branch.shortName);
                          return;
                        }
                        setDeleteLocalTarget(branch);
                      }}
                      onDeleteRemote={() => undefined}
                      onRename={() => {
                        setRenameTarget(branch);
                        setRenameValue(branch.shortName);
                      }}
                      onSetUpstream={() => {
                        setUpstreamTarget(branch);
                        setUpstreamValue(branch.upstreamRef ?? '');
                      }}
                      onUnsetUpstream={() => revision && setUpstream(projectId, revision, null)}
                      onPublish={() => {
                        if (branch.current) {
                          setGitHubPublishRepoId(projectId);
                          return;
                        }
                        setPublishTarget(branch);
                        setPublishRemoteName(branch.remoteName ?? 'origin');
                        setPublishRemoteUrl('');
                      }}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {remoteBranches.length > 0 ? (
              <div className="branches-panel__section">
                <h3 className="branches-panel__section-title">Remote</h3>
                <ul className="branches-panel__list">
                  {remoteBranches.map((branch) => (
                    <BranchRow
                      key={branch.ref}
                      projectId={projectId}
                      branch={branch}
                      revision={revision}
                      readOnly={readOnly}
                      busy={busy}
                      onCheckout={() => handleCheckout(branch)}
                      onDeleteLocal={() => undefined}
                      onDeleteRemote={() => {
                        if (!confirmDeleteRemote && revision && branch.remoteName) {
                          const name = branch.shortName.includes('/')
                            ? branch.shortName.split('/').slice(1).join('/')
                            : branch.shortName;
                          deleteRemoteBranch(projectId, revision, branch.remoteName, name);
                          return;
                        }
                        setDeleteRemoteTarget(branch);
                      }}
                      onRename={() => undefined}
                      onSetUpstream={() => undefined}
                      onUnsetUpstream={() => undefined}
                      onPublish={() => undefined}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(publishTarget)}
        title="Publish branch"
        description={
          <>
            Push <span className="mono">{publishTarget?.shortName}</span> and set its upstream.
            Public or private visibility is controlled by the remote repository.
          </>
        }
        onClose={() => setPublishTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPublishTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!publishRemoteName.trim() || busy}
              onClick={() => {
                if (publishTarget && revision && publishRemoteName.trim()) {
                  publishBranch(
                    projectId,
                    revision,
                    publishTarget.shortName,
                    publishRemoteName.trim(),
                    publishRemoteUrl.trim() || undefined
                  );
                  setPublishTarget(null);
                }
              }}
            >
              Publish
            </Button>
          </>
        }
      >
        <div className="branches-panel__publish-fields">
          <TextInput
            label="Remote name"
            value={publishRemoteName}
            onChange={(e) => setPublishRemoteName(e.target.value)}
            placeholder="origin"
          />
          <TextInput
            label="Remote URL"
            value={publishRemoteUrl}
            onChange={(e) => setPublishRemoteUrl(e.target.value)}
            placeholder="Optional when the remote already exists"
          />
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleteLocalTarget)}
        title="Delete branch?"
        description={
          <>
            Branch <span className="mono">{deleteLocalTarget?.shortName}</span> will be deleted.
            This cannot be undone if the branch has unmerged commits.
          </>
        }
        onClose={() => setDeleteLocalTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteLocalTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleteLocalTarget && revision) {
                  deleteBranch(projectId, revision, deleteLocalTarget.shortName);
                  setDeleteLocalTarget(null);
                }
              }}
            >
              Delete branch
            </Button>
          </>
        }
      />

      <Dialog
        open={Boolean(deleteRemoteTarget)}
        title="Delete remote branch?"
        description={
          <>
            Remote branch <span className="mono">{deleteRemoteTarget?.shortName}</span> will be
            deleted from the remote.
          </>
        }
        onClose={() => setDeleteRemoteTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteRemoteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleteRemoteTarget && revision && deleteRemoteTarget.remoteName) {
                  const name = deleteRemoteTarget.shortName.includes('/')
                    ? deleteRemoteTarget.shortName.split('/').slice(1).join('/')
                    : deleteRemoteTarget.shortName;
                  deleteRemoteBranch(projectId, revision, deleteRemoteTarget.remoteName, name);
                  setDeleteRemoteTarget(null);
                }
              }}
            >
              Delete remote branch
            </Button>
          </>
        }
      />

      <Dialog
        open={Boolean(renameTarget)}
        title="Rename branch"
        description={
          <>
            Enter a new name for <span className="mono">{renameTarget?.shortName}</span>.
          </>
        }
        onClose={() => setRenameTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!renameValue.trim()}
              onClick={() => {
                if (renameTarget && revision && renameValue.trim()) {
                  renameBranch(projectId, revision, renameValue.trim());
                  setRenameTarget(null);
                }
              }}
            >
              Rename
            </Button>
          </>
        }
      >
        <TextInput
          label="New branch name"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder="feature/new-name"
        />
      </Dialog>

      <Dialog
        open={Boolean(checkoutRemoteTarget)}
        title="Checkout remote branch"
        description={
          <>
            Create a local branch tracking{' '}
            <span className="mono">{checkoutRemoteTarget?.shortName}</span>.
          </>
        }
        onClose={() => setCheckoutRemoteTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setCheckoutRemoteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!checkoutLocalName.trim()}
              onClick={() => {
                if (checkoutRemoteTarget && revision && checkoutLocalName.trim()) {
                  checkoutTracking(
                    projectId,
                    revision,
                    checkoutRemoteTarget.ref,
                    checkoutLocalName.trim()
                  );
                  setCheckoutRemoteTarget(null);
                }
              }}
            >
              Checkout
            </Button>
          </>
        }
      >
        <TextInput
          label="Local branch name"
          value={checkoutLocalName}
          onChange={(e) => setCheckoutLocalName(e.target.value)}
          placeholder="feature/my-branch"
        />
      </Dialog>

      <Dialog
        open={Boolean(upstreamTarget)}
        title="Set upstream"
        description={
          <>
            Set upstream for <span className="mono">{upstreamTarget?.shortName}</span>.
          </>
        }
        onClose={() => setUpstreamTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setUpstreamTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!upstreamValue.trim()}
              onClick={() => {
                if (upstreamTarget && revision && upstreamValue.trim()) {
                  setUpstream(projectId, revision, upstreamValue.trim());
                  setUpstreamTarget(null);
                }
              }}
            >
              Set upstream
            </Button>
          </>
        }
      >
        <TextInput
          label="Upstream ref"
          value={upstreamValue}
          onChange={(e) => setUpstreamValue(e.target.value)}
          placeholder="origin/main"
        />
      </Dialog>
    </section>
  );
}
