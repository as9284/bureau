import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { TextField } from '@renderer/components/TextField';
import { copyText } from '@renderer/lib/contextMenu';
import { useAppStore } from '@renderer/store/appStore';
import type { ApiSecretSummary } from '@shared/contracts/apiWorkbench';
import { buildSecretMenuItems } from './apiContextMenu';

type Props = {
  secrets: ApiSecretSummary[];
  storageAvailable: boolean;
  onSave(label: string, value: string, persist: boolean): void;
  onDelete(secretId: string): void;
};

/**
 * Secret vault UI. Values are write-only: plaintext crosses IPC once on save and is cleared from
 * local state immediately. There is no reveal action, by design.
 */
export function SecretsPane({ secrets, storageAvailable, onSave, onDelete }: Props) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [persist, setPersist] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const canSave = label.trim().length > 0 && value.length > 0;

  const openSecretMenu = (event: ReactMouseEvent, secret: ApiSecretSummary): void => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildSecretMenuItems(secret, {
        copyLabel: () => copyText(secret.label),
        remove: () => setPendingDelete(secret.secretId),
      }),
    });
  };

  return (
    <div className="api-secrets">
      {!storageAvailable ? (
        <div className="api-banner api-banner--warning" role="alert">
          <strong>Encrypted storage unavailable</strong>
          <span>
            Secrets can be used for this session but cannot be saved to disk. Bureau never writes a
            secret in plaintext.
          </span>
        </div>
      ) : null}

      <form
        className="api-secrets__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave) return;
          onSave(label.trim(), value, persist && storageAvailable);
          // Clear the field as soon as the value is handed to main.
          setLabel('');
          setValue('');
        }}
      >
        <div className="api-secrets__field">
          <label className="api-field-label" htmlFor="api-secret-label">
            Label
          </label>
          <TextField
            id="api-secret-label"
            value={label}
            placeholder="Staging API key"
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="api-secrets__field">
          <label className="api-field-label" htmlFor="api-secret-value">
            Value
          </label>
          <TextField
            id="api-secret-value"
            type="password"
            className="mono"
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Checkbox
          checked={persist && storageAvailable}
          disabled={!storageAvailable}
          label="Save encrypted to disk"
          onChange={setPersist}
        />
        <Button type="submit" size="compact" variant="primary" disabled={!canSave}>
          Add secret
        </Button>
      </form>

      <div className="api-secrets__list">
        {secrets.length === 0 ? (
          <div className="api-pane-empty">No secrets yet.</div>
        ) : (
          secrets.map((secret) => (
            <div
              key={secret.secretId}
              className="api-secrets__row"
              onContextMenu={(event) => openSecretMenu(event, secret)}
            >
              <span className="api-secrets__label">{secret.label}</span>
              <span className="api-secrets__meta mono">
                {secret.persisted ? 'encrypted' : 'session only'}
              </span>
              {pendingDelete === secret.secretId ? (
                <span className="api-secrets__confirm">
                  <span>Delete?</span>
                  <Button
                    size="compact"
                    variant="danger"
                    onClick={() => {
                      onDelete(secret.secretId);
                      setPendingDelete(null);
                    }}
                  >
                    Delete
                  </Button>
                  <Button size="compact" variant="ghost" onClick={() => setPendingDelete(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button
                  size="compact"
                  variant="ghost"
                  onClick={() => setPendingDelete(secret.secretId)}
                >
                  Delete
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
