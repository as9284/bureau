import { useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextArea } from '@renderer/components/TextArea';
import { TextField } from '@renderer/components/TextField';
import type {
  ApiProxyMode,
  ApiProxyProfile,
  ApiSaveProxyProfileInput,
  ApiSecretSummary,
} from '@shared/contracts/apiWorkbench';

type Props = {
  profile: ApiProxyProfile | null;
  secrets: ApiSecretSummary[];
  onCancel(): void;
  onSave(input: Omit<ApiSaveProxyProfileInput, 'workspaceId'>): void;
};

const MODE_LABELS: Array<{ value: ApiProxyMode; label: string }> = [
  { value: 'direct', label: 'Direct (no proxy)' },
  { value: 'system', label: 'System (read HTTP_PROXY / HTTPS_PROXY)' },
  { value: 'http', label: 'HTTP proxy' },
  { value: 'https', label: 'HTTPS proxy' },
  { value: 'socks5', label: 'SOCKS5 proxy' },
];

/**
 * A proxy profile.
 *
 * `system` is spelled out rather than implied: Bureau's launch environment is read *only* under
 * that mode, so a shell that exports a proxy cannot silently redirect a request configured as
 * direct. The dialog says so, because a proxy that applies invisibly is how traffic ends up
 * somewhere the user did not intend.
 */
export function ProxyProfileDialog({ profile, secrets, onCancel, onSave }: Props) {
  const [name, setName] = useState(profile?.name ?? 'Proxy');
  const [mode, setMode] = useState<ApiProxyMode>(profile?.mode ?? 'http');
  const [host, setHost] = useState(profile?.host ?? '');
  const [port, setPort] = useState(profile?.port ? String(profile.port) : '8080');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [passwordSecretId, setPasswordSecretId] = useState(profile?.passwordSecretId ?? '');
  const [bypass, setBypass] = useState((profile?.bypass ?? []).join('\n'));
  const [enabled, setEnabled] = useState(profile?.enabled ?? true);

  const needsHost = mode === 'http' || mode === 'https' || mode === 'socks5';
  const parsedPort = Number(port);
  const portValid = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535;
  const blocked = needsHost && (!host.trim() || !portValid);

  return (
    <Dialog
      open
      title={profile ? 'Edit proxy profile' : 'New proxy profile'}
      description="Where matching requests are routed. A request opts in from its Settings tab."
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={blocked}
            onClick={() =>
              onSave({
                profileId: profile?.profileId,
                expectedRevision: profile?.revision,
                name: name.trim() || 'Proxy',
                mode,
                host: needsHost ? host.trim() : undefined,
                port: needsHost ? parsedPort : undefined,
                username: username.trim() || undefined,
                passwordSecretId: passwordSecretId || null,
                bypass: bypass
                  .split('\n')
                  .map((entry) => entry.trim())
                  .filter(Boolean),
                enabled,
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="api-dialog">
        <div className="api-dialog__field">
          <label className="api-field-label" htmlFor="api-proxy-name">
            Profile name
          </label>
          <TextField
            id="api-proxy-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <Dropdown
          label="Mode"
          value={mode}
          options={MODE_LABELS}
          onChange={(value) => setMode(value as ApiProxyMode)}
        />

        {mode === 'system' ? (
          <p className="api-field-hint">
            Bureau reads <span className="mono">HTTP_PROXY</span>,{' '}
            <span className="mono">HTTPS_PROXY</span>, and <span className="mono">NO_PROXY</span>{' '}
            from its own launch environment — but only while this mode is selected. No other profile
            is affected by those variables.
          </p>
        ) : null}

        {needsHost ? (
          <div className="api-dialog__row">
            <div className="api-dialog__field">
              <label className="api-field-label" htmlFor="api-proxy-host">
                Host
              </label>
              <TextField
                id="api-proxy-host"
                mono
                value={host}
                placeholder="proxy.corp"
                onChange={(event) => setHost(event.target.value)}
              />
            </div>
            <div className="api-dialog__field">
              <label className="api-field-label" htmlFor="api-proxy-port">
                Port
              </label>
              <TextField
                id="api-proxy-port"
                mono
                inputMode="numeric"
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
              {!portValid ? <p className="api-field-error">Port must be 1–65535.</p> : null}
            </div>
          </div>
        ) : null}

        {needsHost ? (
          <div className="api-dialog__row">
            <div className="api-dialog__field">
              <label className="api-field-label" htmlFor="api-proxy-user">
                Username
              </label>
              <TextField
                id="api-proxy-user"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <Dropdown
              label="Password"
              value={passwordSecretId}
              options={[
                { value: '', label: 'None' },
                ...secrets.map((secret) => ({ value: secret.secretId, label: secret.label })),
              ]}
              onChange={setPasswordSecretId}
            />
          </div>
        ) : null}

        <TextArea
          label="Bypass (one host per line)"
          className="mono"
          rows={4}
          spellCheck={false}
          value={bypass}
          placeholder={'localhost\n.internal.test'}
          helper="An exact host, a leading-dot suffix, or * for everything. Bypassed hosts go direct."
          onChange={(event) => setBypass(event.target.value)}
        />

        <Checkbox
          label="Use this profile"
          checked={enabled}
          onChange={setEnabled}
          description="A disabled profile is kept but never applied, the same as a TLS profile."
        />
      </div>
    </Dialog>
  );
}
