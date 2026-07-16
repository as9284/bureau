import { useState, type ReactElement } from 'react';
import type { RemoteEntry } from '@shared/contracts/remotes';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { redactUrlCredentials } from '@shared/git/refChecks';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { Skeleton } from '@renderer/components/Skeleton';
import { PanelError } from '@renderer/features/git/PanelState';
import { TextInput } from '@renderer/components/TextInput';
import './RemotesPanel.css';

type Props = {
  projectId: string;
  snapshot?: RepositorySnapshot;
  readOnly: boolean;
};

type EditTarget = { remote: RemoteEntry; kind: 'rename' | 'url' };

export function RemotesPanel({ projectId, snapshot, readOnly }: Props): ReactElement {
  const remotes = useGitStore((s) => s.remotes);
  const remotesLoading = useGitStore((s) => s.remotesLoading);
  const remotesError = useGitStore((s) => s.remotesError);
  const loadRemotes = useGitStore((s) => s.loadRemotes);
  const addRemote = useGitStore((s) => s.addRemote);
  const renameRemote = useGitStore((s) => s.renameRemote);
  const removeRemote = useGitStore((s) => s.removeRemote);
  const setRemoteUrl = useGitStore((s) => s.setRemoteUrl);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [draft, setDraft] = useState('');

  const revision = snapshot?.revision;
  const busy = Boolean(operation);
  const canEdit = !readOnly && Boolean(revision);

  const closeAdd = () => {
    setAddOpen(false);
    setName('');
    setUrl('');
  };

  const openEdit = (remote: RemoteEntry, kind: EditTarget['kind']) => {
    // The URL field is prefilled with the *real* URL, not the redacted display value —
    // saving a redacted string back would write "***" into the git config. Showing
    // credentials is acceptable here because editing is a deliberate, explicit act.
    setDraft(kind === 'rename' ? remote.name : remote.fetchUrl);
    setEditTarget({ remote, kind });
  };

  const submitEdit = () => {
    if (!editTarget || !revision || !draft.trim()) return;
    if (editTarget.kind === 'rename') {
      void renameRemote(projectId, revision, editTarget.remote.name, draft.trim());
    } else {
      void setRemoteUrl(projectId, revision, editTarget.remote.name, draft.trim());
    }
    setEditTarget(null);
    setDraft('');
  };

  return (
    <section className="remotes-panel" aria-label="Remotes">
      <header className="remotes-panel__header">
        <h2 className="remotes-panel__title">Remotes</h2>
        <div className="remotes-panel__actions">
          {canEdit ? (
            <Button variant="secondary" disabled={busy} onClick={() => setAddOpen(true)}>
              Add
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => loadRemotes(projectId)}>
            Refresh
          </Button>
        </div>
      </header>

      {remotesError ? (
        <PanelError
          title="Could not load remotes"
          message={remotesError.message}
          onRetry={() => void loadRemotes(projectId)}
        />
      ) : null}

      {remotesLoading && remotes.length === 0 ? (
        <div className="remotes-panel__loading">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} width="100%" height="var(--size-hub-row)" />
          ))}
        </div>
      ) : remotes.length === 0 ? (
        remotesError ? null : (
          <EmptyState
            title="No remotes"
            description="Add a remote to fetch from and push to a server such as GitHub."
          />
        )
      ) : (
        <ul
          className={`remotes-panel__list ${remotesLoading ? 'git-stale' : ''}`}
          aria-busy={remotesLoading}
        >
          {remotes.map((remote) => (
            <li key={remote.name} className="remotes-panel__item">
              <div className="remotes-panel__copy">
                <span className="remotes-panel__name">{remote.name}</span>
                {/* Credentials embedded in a URL are redacted for display only. */}
                <span className="remotes-panel__url" title={redactUrlCredentials(remote.fetchUrl)}>
                  {redactUrlCredentials(remote.fetchUrl)}
                </span>
                {remote.pushUrl !== remote.fetchUrl ? (
                  <span className="remotes-panel__url" title={redactUrlCredentials(remote.pushUrl)}>
                    push: {redactUrlCredentials(remote.pushUrl)}
                  </span>
                ) : null}
              </div>
              {canEdit ? (
                <div className="remotes-panel__item-actions">
                  <Button variant="ghost" disabled={busy} onClick={() => openEdit(remote, 'url')}>
                    Change URL
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => openEdit(remote, 'rename')}>
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (revision) void removeRemote(projectId, revision, remote.name);
                    }}
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
        title="Add remote"
        description="Point this repository at a server you can fetch from and push to."
        onClose={closeAdd}
        actions={
          <>
            <Button variant="secondary" onClick={closeAdd}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim() || !url.trim() || busy || !revision}
              onClick={() => {
                if (!revision || !name.trim() || !url.trim()) return;
                void addRemote(projectId, revision, name.trim(), url.trim());
                closeAdd();
              }}
            >
              Add remote
            </Button>
          </>
        }
      >
        <div className="remotes-panel__fields">
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="origin"
          />
          <TextInput
            label="URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo.git"
          />
        </div>
      </Dialog>

      <Dialog
        open={Boolean(editTarget)}
        title={editTarget?.kind === 'rename' ? 'Rename remote' : 'Change remote URL'}
        description={
          editTarget?.kind === 'rename'
            ? `Renaming “${editTarget?.remote.name}” also renames its remote-tracking branches.`
            : `Point “${editTarget?.remote.name}” at a different URL. Fetch and push will use it from now on.`
        }
        onClose={() => setEditTarget(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!draft.trim() || busy || !revision} onClick={submitEdit}>
              {editTarget?.kind === 'rename' ? 'Rename' : 'Change URL'}
            </Button>
          </>
        }
      >
        <TextInput
          label={editTarget?.kind === 'rename' ? 'New name' : 'New URL'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            editTarget?.kind === 'rename' ? 'upstream' : 'https://github.com/owner/repo.git'
          }
        />
      </Dialog>
    </section>
  );
}
