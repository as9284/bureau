import { useEffect, useState, type ReactElement } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { TextInput } from '@renderer/components/TextInput';
import { GitMark } from '@renderer/components/icons';
import { GiteaConnectFields } from './GiteaConnectFields';
import { useGiteaConnection } from './useGiteaConnection';
import './PublishToGiteaDialog.css';

function defaultRepositoryName(name: string): string {
  return (
    name
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._-]/g, '')
      .replace(/^[.-]+|[.-]+$/g, '') || 'new-repository'
  );
}

export function PublishToGiteaDialog(): ReactElement {
  const projectId = useGitStore((s) => s.giteaPublishRepoId);
  const repo = useGitStore((s) => (projectId ? s.repos[projectId] : undefined));
  const setRepoId = useGitStore((s) => s.setGiteaPublishRepoId);
  const publishToGitea = useGitStore((s) => s.publishToGitea);
  const repoName = repo?.catalogue.displayName;

  const connection = useGiteaConnection(Boolean(projectId));
  const { status, connected, busy: connecting, error, setError } = connection;

  const [owner, setOwner] = useState('');
  const [repositoryName, setRepositoryName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [loading, setLoading] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string>();

  useEffect(() => {
    if (!projectId || !repoName) return;
    setRepositoryName(defaultRepositoryName(repoName));
    setDescription('');
    setVisibility('private');
    setPublishedUrl(undefined);
  }, [projectId, repoName]);

  // The account is only known once the connection resolves, and it changes when
  // the operator connects a different instance from inside this dialog.
  useEffect(() => {
    setOwner(status?.account ?? '');
  }, [status?.account]);

  const close = () => {
    if (!loading && !connecting) setRepoId(undefined);
  };

  const snapshot = repo?.snapshot;
  const branchName = snapshot?.branch.kind === 'named' ? snapshot.branch.name : '';
  const canPublish = Boolean(
    connected && snapshot?.latestCommit && branchName && repositoryName.trim() && !loading
  );

  const publish = async () => {
    if (!projectId || !snapshot || !branchName || !canPublish) return;
    setLoading(true);
    setError(undefined);
    const result = await publishToGitea({
      projectId,
      snapshotRevision: snapshot.revision,
      branchName,
      owner: owner.trim() || undefined,
      repositoryName: repositoryName.trim(),
      visibility,
      description: description.trim() || undefined,
    });
    setLoading(false);
    if (result.ok) setPublishedUrl(result.repositoryUrl);
    else setError(result.error.message);
  };

  const actions = publishedUrl ? (
    <>
      <Button variant="secondary" onClick={() => openPublished(publishedUrl)}>
        Open on Gitea
      </Button>
      <Button variant="primary" onClick={() => setRepoId(undefined)}>
        Done
      </Button>
    </>
  ) : !status ? (
    <Button variant="secondary" onClick={close}>
      Cancel
    </Button>
  ) : !connected ? (
    <>
      <Button variant="secondary" disabled={connecting} onClick={close}>
        Cancel
      </Button>
      <Button
        variant="primary"
        loading={connecting}
        disabled={!connection.canConnect}
        onClick={() => void connection.connect()}
      >
        Connect
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="secondary"
        disabled={loading || connecting}
        onClick={() => void connection.disconnect()}
      >
        Disconnect
      </Button>
      <Button variant="primary" loading={loading} disabled={!canPublish} onClick={publish}>
        Publish repository
      </Button>
    </>
  );

  return (
    <Dialog
      open={Boolean(projectId)}
      title={publishedUrl ? 'Published to Gitea' : 'Publish to Gitea'}
      description={
        publishedUrl
          ? 'The repository is ready on Gitea and this branch now tracks origin.'
          : 'Create or connect the Gitea repository, configure origin, and publish the current branch in one step.'
      }
      onClose={close}
      actions={actions}
    >
      {!status ? (
        <div className="gitea-publish__checking" role="status">
          Checking Gitea connection…
        </div>
      ) : publishedUrl ? (
        <div className="gitea-publish__success">
          <GitMark aria-hidden="true" />
          <code>{publishedUrl}</code>
        </div>
      ) : !connected ? (
        <GiteaConnectFields connection={connection} />
      ) : (
        <div className="gitea-publish__form">
          <div className="gitea-publish__destination" aria-label="Publishing destination">
            <span>Destination</span>
            <strong>
              {owner || status.account}/{repositoryName || 'repository'}
            </strong>
            <span className="gitea-publish__host">{status.hostUrl}</span>
            <span className="gitea-publish__branch">Branch: {branchName || 'Unavailable'}</span>
          </div>

          <div className="gitea-publish__field">
            <span>
              Owner or organisation <small>Defaults to {status.account}</small>
            </span>
            <TextInput
              label="Gitea owner or organisation"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder={status.account ?? 'gitea-account'}
            />
          </div>

          <div className="gitea-publish__field">
            <span>Repository name</span>
            <TextInput
              label="Gitea repository name"
              value={repositoryName}
              onChange={(event) => setRepositoryName(event.target.value)}
              placeholder="my-project"
            />
          </div>

          <div className="gitea-publish__field">
            <span>
              Description <small>Optional</small>
            </span>
            <TextInput
              label="Gitea repository description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this project does"
            />
          </div>

          <fieldset className="gitea-publish__visibility">
            <legend>Visibility for a new repository</legend>
            <label className={visibility === 'private' ? 'is-selected' : undefined}>
              <input
                type="radio"
                name="gitea-visibility"
                value="private"
                checked={visibility === 'private'}
                onChange={() => setVisibility('private')}
              />
              <span>
                <strong>Private</strong>
                <small>Only you and invited collaborators</small>
              </span>
            </label>
            <label className={visibility === 'public' ? 'is-selected' : undefined}>
              <input
                type="radio"
                name="gitea-visibility"
                value="public"
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
              />
              <span>
                <strong>Public</strong>
                <small>Visible to everyone on this instance</small>
              </span>
            </label>
          </fieldset>

          <p className="gitea-publish__hint">
            If origin already points at this instance, its existing visibility is kept.
          </p>

          {snapshot?.dirty ? (
            <p className="gitea-publish__notice">
              Uncommitted changes remain local. Commit them before publishing if they should be
              included.
            </p>
          ) : null}
          {!snapshot?.latestCommit ? (
            <p className="gitea-publish__notice gitea-publish__notice--error">
              Create the first commit before publishing this repository.
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="gitea-publish__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

/** Opens a published repository page; main allows the connected Gitea origin. */
function openPublished(url: string): void {
  void window.bureau.github.openUrl({ url });
}
