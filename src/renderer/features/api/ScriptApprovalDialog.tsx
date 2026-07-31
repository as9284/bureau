import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import type { BureauError } from '@shared/contracts/errors';
import type { ApiScriptLocation } from '@shared/contracts/apiWorkbench';

type Props = {
  collectionName: string;
  locations: ApiScriptLocation[];
  busy: boolean;
  error: BureauError | null;
  onApprove(enabled: boolean): void;
  onCancel(): void;
};

/**
 * The only place imported script source becomes runnable.
 *
 * It lists every script under the subtree with its location and provenance, so enabling is a
 * decision about a specific set of sources rather than a switch. The store sends the workspace
 * revision this list was read at, so an approval cannot land on a workspace that has since gained
 * another script.
 */
export function ScriptApprovalDialog({
  collectionName,
  locations,
  busy,
  error,
  onApprove,
  onCancel,
}: Props) {
  const imported = locations.filter((entry) => entry.origin === 'imported');
  const enabledCount = locations.filter((entry) => entry.enabled).length;
  const allEnabled = locations.length > 0 && enabledCount === locations.length;

  return (
    <Dialog
      open
      size="wide"
      title={`Scripts in ${collectionName}`}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {enabledCount > 0 ? (
            <Button variant="secondary" disabled={busy} onClick={() => onApprove(false)}>
              Disable all
            </Button>
          ) : null}
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || locations.length === 0 || allEnabled}
            onClick={() => onApprove(true)}
          >
            Enable {locations.length} script{locations.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="api-scripts-dialog">
        {error ? (
          <div className="api-banner api-banner--danger" role="alert">
            <strong>Could not update scripts</strong>
            <span>{error.message}</span>
          </div>
        ) : null}

        {imported.length > 0 ? (
          <div className="api-banner api-banner--danger" role="alert">
            <strong>
              {imported.length} script{imported.length === 1 ? '' : 's'} came from an import
            </strong>
            <span>
              Imported code runs in an isolated runtime with no network, filesystem, or module
              access — but it can still read this workspace&rsquo;s variables, including secret
              values, and use them in requests. Read them before enabling.
            </span>
          </div>
        ) : null}

        {locations.length === 0 ? (
          <p className="empty-state">No scripts here yet.</p>
        ) : (
          <ul className="api-scripts-dialog__list">
            {locations.map((entry) => (
              <li key={`${entry.holder.kind}:${entry.holder.id}`} className="api-scripts-dialog__row">
                <div className="api-scripts-dialog__row-main">
                  <span className="api-scripts-dialog__path mono">{entry.path}</span>
                  <span className="api-scripts-dialog__phases">
                    {entry.phases.map((phase) => (phase === 'pre-request' ? 'Pre-request' : 'Tests')).join(' · ')}
                  </span>
                </div>
                <div className="api-scripts-dialog__row-meta">
                  <span
                    className={
                      entry.origin === 'imported'
                        ? 'api-tag api-tag--warning'
                        : 'api-tag'
                    }
                  >
                    {entry.origin === 'imported' ? 'Imported' : 'Authored here'}
                  </span>
                  <span className={entry.enabled ? 'api-tag api-tag--success' : 'api-tag'}>
                    {entry.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
