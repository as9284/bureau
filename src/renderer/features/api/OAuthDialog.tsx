import { useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextField } from '@renderer/components/TextField';
import type {
  ApiOAuthProfile,
  ApiOAuthTokenStatus,
  ApiSaveOAuthProfileInput,
  ApiSecretSummary,
} from '@shared/contracts/apiWorkbench';

type Props = {
  profile: ApiOAuthProfile | null;
  status?: ApiOAuthTokenStatus;
  secrets: ApiSecretSummary[];
  phase: 'idle' | 'awaiting-callback' | 'exchanging' | 'refreshing' | 'authorized' | 'failed';
  errorMessage?: string;
  onCancel(): void;
  onSave(input: Omit<ApiSaveOAuthProfileInput, 'workspaceId'>): void;
  onAuthorize(): void;
  onCancelAuthorize(): void;
  onClearToken(): void;
};

export function OAuthDialog({
  profile,
  status,
  secrets,
  phase,
  errorMessage,
  onCancel,
  onSave,
  onAuthorize,
  onCancelAuthorize,
  onClearToken,
}: Props) {
  const [name, setName] = useState(profile?.name ?? 'OAuth profile');
  const [grant, setGrant] = useState<ApiOAuthProfile['grant']>(profile?.grant ?? 'authorization_code');
  const [authorizationUrl, setAuthorizationUrl] = useState(profile?.authorizationUrl ?? '');
  const [tokenUrl, setTokenUrl] = useState(profile?.tokenUrl ?? '');
  const [clientId, setClientId] = useState(profile?.clientId ?? '');
  const [clientSecretId, setClientSecretId] = useState(profile?.clientSecretId ?? '');
  const [scope, setScope] = useState(profile?.scope ?? '');
  const [audience, setAudience] = useState(profile?.audience ?? '');
  const [redirectPort, setRedirectPort] = useState(profile?.redirectPort?.toString() ?? '');

  const needsAuthorizationUrl = grant === 'authorization_code';
  const canSave =
    name.trim().length > 0 &&
    tokenUrl.trim().length > 0 &&
    clientId.trim().length > 0 &&
    (!needsAuthorizationUrl || authorizationUrl.trim().length > 0);
  const busy = phase === 'awaiting-callback' || phase === 'exchanging' || phase === 'refreshing';

  return (
    <Dialog
      open
      title={profile ? 'Edit OAuth 2 profile' : 'New OAuth 2 profile'}
      description="Bureau performs the authorization flow and stores the token; requests reference the profile, never the token."
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={() =>
              onSave({
                profileId: profile?.profileId,
                expectedRevision: profile?.revision,
                name: name.trim(),
                grant,
                authorizationUrl: needsAuthorizationUrl ? authorizationUrl.trim() : undefined,
                tokenUrl: tokenUrl.trim(),
                clientId: clientId.trim(),
                clientSecretId: clientSecretId || null,
                scope: scope.trim() || undefined,
                audience: audience.trim() || undefined,
                redirectPort: redirectPort ? Number.parseInt(redirectPort, 10) : null,
              })
            }
          >
            Save profile
          </Button>
        </>
      }
    >
      <div className="api-dialog">
        <div className="api-dialog__field">
          <label className="api-field-label" htmlFor="api-oauth-name">
            Profile name
          </label>
          <TextField id="api-oauth-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>

        <Dropdown
          label="Grant type"
          value={grant}
          options={[
            { value: 'authorization_code', label: 'Authorization Code with PKCE' },
            { value: 'client_credentials', label: 'Client Credentials' },
          ]}
          onChange={(value) => setGrant(value as ApiOAuthProfile['grant'])}
        />

        {needsAuthorizationUrl ? (
          <div className="api-dialog__field">
            <label className="api-field-label" htmlFor="api-oauth-authorize-url">
              Authorization URL
            </label>
            <TextField
              id="api-oauth-authorize-url"
              className="mono"
              value={authorizationUrl}
              placeholder="https://provider.example.com/authorize"
              onChange={(event) => setAuthorizationUrl(event.target.value)}
            />
          </div>
        ) : null}

        <div className="api-dialog__field">
          <label className="api-field-label" htmlFor="api-oauth-token-url">
            Token URL
          </label>
          <TextField
            id="api-oauth-token-url"
            className="mono"
            value={tokenUrl}
            placeholder="https://provider.example.com/token"
            onChange={(event) => setTokenUrl(event.target.value)}
          />
        </div>

        <div className="api-dialog__field">
          <label className="api-field-label" htmlFor="api-oauth-client-id">
            Client ID
          </label>
          <TextField
            id="api-oauth-client-id"
            className="mono"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          />
        </div>

        <Dropdown
          label="Client secret"
          value={clientSecretId}
          options={[
            { value: '', label: 'No client secret (public client)' },
            ...secrets.map((secret) => ({ value: secret.secretId, label: secret.label })),
          ]}
          onChange={setClientSecretId}
        />

        <div className="api-dialog__field">
          <label className="api-field-label" htmlFor="api-oauth-scope">
            Scope
          </label>
          <TextField
            id="api-oauth-scope"
            className="mono"
            value={scope}
            placeholder="openid profile"
            onChange={(event) => setScope(event.target.value)}
          />
        </div>

        <div className="api-dialog__field">
          <label className="api-field-label" htmlFor="api-oauth-audience">
            Audience
          </label>
          <TextField
            id="api-oauth-audience"
            className="mono"
            value={audience}
            placeholder="Optional"
            onChange={(event) => setAudience(event.target.value)}
          />
        </div>

        {needsAuthorizationUrl ? (
          <>
            <div className="api-dialog__field">
              <label className="api-field-label" htmlFor="api-oauth-port">
                Fixed loopback port
              </label>
              <TextField
                id="api-oauth-port"
                className="mono"
                inputMode="numeric"
                value={redirectPort}
                placeholder="Ephemeral"
                onChange={(event) => setRedirectPort(event.target.value.replace(/\D/g, ''))}
              />
            </div>
            <p className="api-field-hint mono">
              Redirect URI: http://127.0.0.1:{redirectPort || '<port>'}/bureau/oauth/callback
            </p>
            <p className="api-field-hint">
              Leave the port empty unless your provider requires a fixed registered redirect URI.
              Authorization opens your system browser, never an in-app login view.
            </p>
          </>
        ) : null}

        {profile ? (
          <div className="api-oauth-dialog__token">
            <span className="api-field-label">Token</span>
            <p className="mono">
              {status?.hasAccessToken
                ? `Access token stored${status.expiresAt ? ` · expires ${status.expiresAt.slice(0, 19).replace('T', ' ')}` : ''}`
                : 'No access token yet'}
              {status?.hasRefreshToken ? ' · refresh token stored' : ''}
            </p>
            {phase === 'awaiting-callback' ? (
              <p role="status">Waiting for the provider callback in your browser…</p>
            ) : null}
            {phase === 'exchanging' ? <p role="status">Exchanging the authorization code…</p> : null}
            {phase === 'failed' && errorMessage ? (
              <div className="api-banner api-banner--danger" role="alert">
                <strong>Authorization failed</strong>
                <span>{errorMessage}</span>
              </div>
            ) : null}
            <div className="api-oauth-dialog__token-actions">
              {busy ? (
                <Button size="compact" variant="secondary" onClick={onCancelAuthorize}>
                  Cancel authorization
                </Button>
              ) : (
                <Button size="compact" variant="secondary" onClick={onAuthorize}>
                  {status?.hasAccessToken ? 'Reauthorize' : 'Authorize'}
                </Button>
              )}
              {status?.hasAccessToken || status?.hasRefreshToken ? (
                <Button size="compact" variant="ghost" onClick={onClearToken}>
                  Clear token
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
