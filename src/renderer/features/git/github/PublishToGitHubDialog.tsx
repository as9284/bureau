import { useEffect, useState, type ReactElement } from 'react';
import type { GitHubCliStatus } from '@shared/contracts/github';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { TextInput } from '@renderer/components/TextInput';
import { GitMark } from '@renderer/components/icons';
import './PublishToGitHubDialog.css';

function defaultRepositoryName(name: string): string {
  return (
    name
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._-]/g, '')
      .replace(/^[.-]+|[.-]+$/g, '') || 'new-repository'
  );
}

export function PublishToGitHubDialog(): ReactElement {
  const projectId = useGitStore((s) => s.githubPublishRepoId);
  const repo = useGitStore((s) => (projectId ? s.repos[projectId] : undefined));
  const setRepoId = useGitStore((s) => s.setGitHubPublishRepoId);
  const publishToGitHub = useGitStore((s) => s.publishToGitHub);
  const repoName = repo?.catalogue.displayName;

  const [status, setStatus] = useState<GitHubCliStatus>();
  const [owner, setOwner] = useState('');
  const [repositoryName, setRepositoryName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [loading, setLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string>();
  const [publishedUrl, setPublishedUrl] = useState<string>();

  useEffect(() => {
    if (!projectId || !repoName) return;
    let active = true;
    setStatus(undefined);
    setOwner('');
    setRepositoryName(defaultRepositoryName(repoName));
    setDescription('');
    setVisibility('private');
    setError(undefined);
    setPublishedUrl(undefined);
    window.bureau.github
      .getStatus()
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setOwner(next.account ?? '');
      })
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      active = false;
    };
  }, [projectId, repoName]);

  const close = () => {
    if (!loading && !signingIn) setRepoId(undefined);
  };

  const snapshot = repo?.snapshot;
  const branchName = snapshot?.branch.kind === 'named' ? snapshot.branch.name : '';
  const canPublish = Boolean(
    status?.authenticated &&
    snapshot?.latestCommit &&
    branchName &&
    repositoryName.trim() &&
    !loading
  );

  const signIn = async () => {
    setSigningIn(true);
    setError(undefined);
    try {
      const next = await window.bureau.github.signIn();
      setStatus(next);
      setOwner(next.account ?? '');
      if (!next.authenticated) setError('GitHub sign-in did not complete.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSigningIn(false);
    }
  };

  const publish = async () => {
    if (!projectId || !snapshot || !branchName || !canPublish) return;
    setLoading(true);
    setError(undefined);
    const result = await publishToGitHub({
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
      <Button
        variant="secondary"
        onClick={() => window.bureau.github.openUrl({ url: publishedUrl })}
      >
        Open on GitHub
      </Button>
      <Button variant="primary" onClick={() => setRepoId(undefined)}>
        Done
      </Button>
    </>
  ) : !status ? (
    <Button variant="secondary" onClick={close}>
      Cancel
    </Button>
  ) : !status.available ? (
    <>
      <Button variant="secondary" onClick={close}>
        Cancel
      </Button>
      <Button
        variant="primary"
        onClick={() =>
          window.bureau.github.openUrl({ url: 'https://github.com/cli/cli#installation' })
        }
      >
        Get GitHub CLI
      </Button>
    </>
  ) : !status.authenticated ? (
    <>
      <Button variant="secondary" disabled={signingIn} onClick={close}>
        Cancel
      </Button>
      <Button variant="primary" loading={signingIn} onClick={signIn}>
        Sign in with GitHub
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" disabled={loading} onClick={close}>
        Cancel
      </Button>
      <Button variant="primary" loading={loading} disabled={!canPublish} onClick={publish}>
        Publish repository
      </Button>
    </>
  );

  return (
    <Dialog
      open={Boolean(projectId)}
      title={publishedUrl ? 'Published to GitHub' : 'Publish to GitHub'}
      description={
        publishedUrl
          ? 'The repository is ready on GitHub and this branch now tracks origin.'
          : 'Create or connect the GitHub repository, configure origin, and publish the current branch in one step.'
      }
      onClose={close}
      actions={actions}
    >
      {!status ? (
        <div className="github-publish__checking" role="status">
          Checking GitHub connection…
        </div>
      ) : publishedUrl ? (
        <div className="github-publish__success">
          <GitMark aria-hidden="true" />
          <code>{publishedUrl}</code>
        </div>
      ) : !status.available ? (
        <div className="github-publish__setup">
          <strong>GitHub CLI is required</strong>
          <p>Install it once, restart Bureau, and this screen will handle the rest.</p>
        </div>
      ) : !status.authenticated ? (
        <div className="github-publish__setup">
          <strong>Connect your GitHub account</strong>
          <p>
            A browser will open for secure sign-in. The one-time code is copied to your clipboard.
          </p>
        </div>
      ) : (
        <div className="github-publish__form">
          <div className="github-publish__destination" aria-label="Publishing destination">
            <span>Destination</span>
            <strong>
              {owner || status.account}/{repositoryName || 'repository'}
            </strong>
            <span className="github-publish__branch">Branch: {branchName || 'Unavailable'}</span>
          </div>

          <div className="github-publish__field">
            <span>Owner or organization</span>
            <TextInput
              label="GitHub owner or organization"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder={status.account ?? 'github-account'}
            />
          </div>

          <div className="github-publish__field">
            <span>Repository name</span>
            <TextInput
              label="GitHub repository name"
              value={repositoryName}
              onChange={(event) => setRepositoryName(event.target.value)}
              placeholder="my-project"
            />
          </div>

          <div className="github-publish__field">
            <span>
              Description <small>Optional</small>
            </span>
            <TextInput
              label="GitHub repository description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What this project does"
            />
          </div>

          <fieldset className="github-publish__visibility">
            <legend>Visibility for a new repository</legend>
            <label className={visibility === 'private' ? 'is-selected' : undefined}>
              <input
                type="radio"
                name="github-visibility"
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
                name="github-visibility"
                value="public"
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
              />
              <span>
                <strong>Public</strong>
                <small>Visible to everyone</small>
              </span>
            </label>
          </fieldset>

          <p className="github-publish__hint">
            If origin already points to GitHub, its existing visibility is kept.
          </p>

          {snapshot?.dirty ? (
            <p className="github-publish__notice">
              Uncommitted changes remain local. Commit them before publishing if they should be
              included.
            </p>
          ) : null}
          {!snapshot?.latestCommit ? (
            <p className="github-publish__notice github-publish__notice--error">
              Create the first commit before publishing this repository.
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <p className="github-publish__error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
