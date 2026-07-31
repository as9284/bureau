import { useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextField } from '@renderer/components/TextField';
import type { ApiCookie } from '@shared/contracts/apiWorkbench';

type Props = {
  cookie: ApiCookie | null;
  onCancel(): void;
  onSave(cookie: ApiCookie): void;
};

const SAME_SITE_OPTIONS = [
  { value: 'lax', label: 'Lax' },
  { value: 'strict', label: 'Strict' },
  { value: 'none', label: 'None' },
];

function expiryForField(value: string | undefined): string {
  return value ? value.slice(0, 16) : '';
}

/** A deliberate cookie writer. Existing identity fields stay fixed so an edit cannot leave a stale twin. */
export function CookieEditorDialog({ cookie, onCancel, onSave }: Props) {
  const isEditing = cookie !== null;
  const [name, setName] = useState(cookie?.name ?? '');
  const [value, setValue] = useState(cookie?.value ?? '');
  const [domain, setDomain] = useState(cookie?.domain ?? '');
  const [path, setPath] = useState(cookie?.path ?? '/');
  const [secure, setSecure] = useState(cookie?.secure ?? true);
  const [httpOnly, setHttpOnly] = useState(cookie?.httpOnly ?? false);
  const [hostOnly, setHostOnly] = useState(cookie?.hostOnly ?? true);
  const [sameSite, setSameSite] = useState<ApiCookie['sameSite']>(cookie?.sameSite ?? 'lax');
  const [expiresAt, setExpiresAt] = useState(expiryForField(cookie?.expiresAt));
  const invalid = !name.trim() || !domain.trim() || !path.startsWith('/') || (sameSite === 'none' && !secure);

  return (
    <Dialog
      open
      title={isEditing ? 'Edit cookie' : 'Add cookie'}
      description="Cookie values are stored with the platform keychain when it is available."
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={invalid}
            onClick={() => onSave({
              name: name.trim(), value, domain: domain.trim(), path, secure, httpOnly, hostOnly, sameSite,
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
            })}
          >
            Save cookie
          </Button>
        </>
      }
    >
      <div className="api-dialog">
        <div className="api-dialog__row">
          <div className="api-dialog__field">
            <label className="api-field-label" htmlFor="api-cookie-name">Name</label>
            <TextField id="api-cookie-name" mono disabled={isEditing} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="api-dialog__field">
            <label className="api-field-label" htmlFor="api-cookie-value">Value</label>
            <TextField id="api-cookie-value" mono value={value} onChange={(event) => setValue(event.target.value)} />
          </div>
        </div>

        <div className="api-dialog__row">
          <div className="api-dialog__field">
            <label className="api-field-label" htmlFor="api-cookie-domain">Domain</label>
            <TextField id="api-cookie-domain" mono disabled={isEditing} value={domain} onChange={(event) => setDomain(event.target.value)} />
          </div>
          <div className="api-dialog__field">
            <label className="api-field-label" htmlFor="api-cookie-path">Path</label>
            <TextField id="api-cookie-path" mono disabled={isEditing} value={path} onChange={(event) => setPath(event.target.value)} />
          </div>
        </div>

        <div className="api-dialog__row">
          <Dropdown label="SameSite" value={sameSite} options={SAME_SITE_OPTIONS} onChange={(next) => setSameSite(next as ApiCookie['sameSite'])} />
          <div className="api-dialog__field">
            <label className="api-field-label" htmlFor="api-cookie-expires">Expiry</label>
            <TextField id="api-cookie-expires" type="datetime-local" mono value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </div>
        </div>
        {sameSite === 'none' && !secure ? <p className="api-field-error">SameSite=None requires Secure.</p> : null}

        <Checkbox checked={secure} onChange={setSecure} label="Secure" description="Send only over HTTPS." />
        <Checkbox checked={httpOnly} onChange={setHttpOnly} label="HttpOnly" description="Marks this cookie unavailable to browser script." />
        <Checkbox checked={hostOnly} onChange={setHostOnly} label="Host only" description="Do not send to subdomains." />
      </div>
    </Dialog>
  );
}
