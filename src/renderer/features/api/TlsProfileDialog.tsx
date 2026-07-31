import { useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextArea } from '@renderer/components/TextArea';
import { TextField } from '@renderer/components/TextField';
import type { ApiSaveTlsProfileInput, ApiTlsProfile } from '@shared/contracts/apiWorkbench';

type Props = {
  profile: ApiTlsProfile | null;
  onCancel(): void;
  onSave(input: Omit<ApiSaveTlsProfileInput, 'workspaceId'>): void;
};

/**
 * Creating an invalid-certificate exception is a danger action: the dialog names every host it
 * will weaken and requires an explicit confirmation checkbox before Save is enabled.
 */
export function TlsProfileDialog({ profile, onCancel, onSave }: Props) {
  const [name, setName] = useState(profile?.name ?? 'TLS profile');
  const [caPem, setCaPem] = useState(profile?.caPem ?? '');
  const [clientCertPem, setClientCertPem] = useState(profile?.clientCertPem ?? '');
  const [minVersion, setMinVersion] = useState<'' | 'TLSv1.2' | 'TLSv1.3'>(
    profile?.minVersion ?? ''
  );
  const [hostsText, setHostsText] = useState(
    (profile?.allowInvalidCertificateHosts ?? []).join('\n')
  );
  const [enabled, setEnabled] = useState(profile?.enabled ?? true);
  const [acknowledged, setAcknowledged] = useState(false);

  const hosts = hostsText
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalidHosts = hosts.filter((host) => /[*/\s]/.test(host));
  const weakensTls = hosts.length > 0;
  const canSave =
    name.trim().length > 0 && invalidHosts.length === 0 && (!weakensTls || acknowledged);

  return (
    <Dialog
      open
      title={profile ? 'Edit TLS profile' : 'New TLS profile'}
      description="Client certificates and per-host verification rules a request can opt into."
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
                caPem: caPem.trim() || undefined,
                clientCertPem: clientCertPem.trim() || undefined,
                minVersion: minVersion === '' ? null : minVersion,
                allowInvalidCertificateHosts: hosts,
                enabled,
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
          <label className="api-field-label" htmlFor="api-tls-name">
            Profile name
          </label>
          <TextField id="api-tls-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>

        <Dropdown
          label="Minimum TLS version"
          value={minVersion}
          options={[
            { value: '', label: 'Node default' },
            { value: 'TLSv1.2', label: 'TLS 1.2' },
            { value: 'TLSv1.3', label: 'TLS 1.3' },
          ]}
          onChange={(value) => setMinVersion(value as '' | 'TLSv1.2' | 'TLSv1.3')}
        />

        <TextArea
          label="Custom CA certificate (PEM)"
          className="mono"
          rows={4}
          value={caPem}
          placeholder="-----BEGIN CERTIFICATE-----"
          onChange={(event) => setCaPem(event.target.value)}
        />

        <TextArea
          label="Client certificate (PEM)"
          className="mono"
          rows={4}
          value={clientCertPem}
          placeholder="-----BEGIN CERTIFICATE-----"
          onChange={(event) => setClientCertPem(event.target.value)}
        />
        <p className="api-field-hint">
          The matching private key and passphrase are stored in the secret vault, not in this
          profile. Add them as secrets and select them after saving.
        </p>

        <TextArea
          label="Allow invalid certificates for these hosts"
          className="mono"
          rows={3}
          value={hostsText}
          placeholder={'internal.example.com\nstaging.example.com:8443'}
          onChange={(event) => setHostsText(event.target.value)}
        />
        <p className="api-field-hint">
          One exact host or host:port per line. Wildcards are not accepted, and an exception never
          applies to a redirect that leaves the named host.
        </p>
        {invalidHosts.length > 0 ? (
          <p className="api-field-error" role="alert">
            Not exact hosts: {invalidHosts.join(', ')}
          </p>
        ) : null}

        {weakensTls ? (
          <div className="api-banner api-banner--danger" role="alert">
            <strong>This profile disables certificate verification</strong>
            <span>
              Traffic to {hosts.join(', ')} can be intercepted and modified without detection.
              Requests using this profile show a persistent warning.
            </span>
            <Checkbox
              checked={acknowledged}
              label={`I understand the risk for ${hosts.length} host${hosts.length === 1 ? '' : 's'}`}
              onChange={setAcknowledged}
            />
          </div>
        ) : null}

        <Checkbox
          checked={enabled}
          label="Profile enabled"
          onChange={setEnabled}
        />
      </div>
    </Dialog>
  );
}
