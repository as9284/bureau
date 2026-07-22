import type { ReactElement } from 'react';
import { TextInput } from '@renderer/components/TextInput';
import type { GiteaConnection } from './useGiteaConnection';
import './PublishToGiteaDialog.css';

/** The instance URL + token pair, shared by the publish dialog and Git settings. */
export function GiteaConnectFields({
  connection,
  showExplainer = true,
}: {
  connection: GiteaConnection;
  showExplainer?: boolean;
}): ReactElement {
  return (
    <div className="gitea-publish__connect">
      {showExplainer ? (
        <p>
          Gitea is self-hosted, so Bureau needs the address of your instance and a personal access
          token with the <strong>repository</strong> scope. The token is encrypted with your
          operating system keyring and never written to the repository.
        </p>
      ) : null}

      <div className="gitea-publish__field">
        <span>Instance URL</span>
        <TextInput
          label="Gitea instance URL"
          value={connection.hostUrl}
          onChange={(event) => connection.setHostUrl(event.target.value)}
          placeholder="https://gitea.example.com"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="gitea-publish__field">
        <span>Personal access token</span>
        <TextInput
          label="Gitea personal access token"
          type="password"
          value={connection.token}
          onChange={(event) => connection.setToken(event.target.value)}
          placeholder="Paste the token from Settings → Applications"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
