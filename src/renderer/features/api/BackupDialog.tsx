import { useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import type { BureauError } from '@shared/contracts/errors';
import type { ApiRestorePlan, ApiRestoreReport } from '@shared/contracts/apiWorkbench';

type Props = {
  plan: ApiRestorePlan | null;
  report: ApiRestoreReport | null;
  busy: boolean;
  error: BureauError | null;
  onBackup(): void;
  onChooseFile(): void;
  onCommit(mode: 'merge' | 'replace'): void;
  onClose(): void;
};

/**
 * Backup and restore.
 *
 * Restore is the most destructive thing in the workbench, so it is two-step like import: choosing a
 * file only produces a plan, and the plan names every workspace and every conflict before anything
 * is written. `Replace` gets its own danger banner because it overwrites documents that exist now.
 */
export function BackupDialog({
  plan,
  report,
  busy,
  error,
  onBackup,
  onChooseFile,
  onCommit,
  onClose,
}: Props) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const conflicts = plan?.workspaces.filter((entry) => entry.conflict) ?? [];

  return (
    <Dialog
      open
      size="wide"
      title="Backup and restore"
      description="Back up every workspace to one file, or restore workspaces from a backup you already have."
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {plan ? (
            <Button
              variant={mode === 'replace' ? 'danger' : 'primary'}
              loading={busy}
              disabled={busy}
              onClick={() => onCommit(mode)}
            >
              {mode === 'replace' ? 'Overwrite and restore' : 'Restore'}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="api-dialog">
        {error ? (
          <div className="api-banner api-banner--danger" role="alert">
            <strong>That did not work</strong>
            <span>{error.message}</span>
          </div>
        ) : null}

        {report ? (
          <div className="api-banner api-banner--success" role="status">
            <strong>Restore complete</strong>
            <span>
              {report.restored} restored · {report.replaced} replaced · {report.skipped} skipped
            </span>
          </div>
        ) : null}

        {!plan ? (
          <>
            <div className="api-dialog__section">
              <span className="api-field-label">Back up</span>
              <p className="api-field-hint">
                Writes every API workspace to one file. Secret values stay in the OS vault and are
                not included, so a restored workspace needs its secrets re-entered.
              </p>
              <Button variant="secondary" loading={busy} onClick={onBackup}>
                Save backup…
              </Button>
            </div>

            <div className="api-dialog__section">
              <span className="api-field-label">Restore</span>
              <p className="api-field-hint">
                Choosing a file only shows what it contains. Nothing is written until you confirm.
              </p>
              <Button variant="secondary" loading={busy} onClick={onChooseFile}>
                Choose backup…
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="api-backup-dialog__summary mono">
              {plan.sourceLabel}
              {plan.createdAt ? ` · ${plan.createdAt.slice(0, 10)}` : ''} · {plan.workspaces.length}{' '}
              workspace{plan.workspaces.length === 1 ? '' : 's'}
            </div>

            <ul className="api-backup-dialog__list">
              {plan.workspaces.map((entry) => (
                <li key={entry.workspaceId} className="api-backup-dialog__row">
                  <span className="api-backup-dialog__name">{entry.name}</span>
                  <span className="api-backup-dialog__meta mono">
                    {entry.requestCount} request{entry.requestCount === 1 ? '' : 's'} ·{' '}
                    {entry.environmentCount} environment{entry.environmentCount === 1 ? '' : 's'}
                  </span>
                  {entry.conflict ? (
                    <span className="api-tag api-tag--warning">already exists</span>
                  ) : null}
                </li>
              ))}
            </ul>

            {plan.warnings.length > 0 ? (
              <ul className="api-backup-dialog__warnings">
                {plan.warnings.map((note, index) => (
                  <li key={`${note.code}:${index}`}>{note.message}</li>
                ))}
              </ul>
            ) : null}

            {conflicts.length > 0 ? (
              <div className="api-backup-dialog__mode">
                <span className="api-field-label">
                  {conflicts.length} workspace{conflicts.length === 1 ? '' : 's'} already exist
                </span>
                <div className="api-backup-dialog__mode-options" role="radiogroup" aria-label="Conflict handling">
                  <Button
                    variant={mode === 'merge' ? 'primary' : 'secondary'}
                    size="compact"
                    aria-pressed={mode === 'merge'}
                    onClick={() => setMode('merge')}
                  >
                    Keep existing
                  </Button>
                  <Button
                    variant={mode === 'replace' ? 'danger' : 'secondary'}
                    size="compact"
                    aria-pressed={mode === 'replace'}
                    onClick={() => setMode('replace')}
                  >
                    Overwrite
                  </Button>
                </div>
                {mode === 'replace' ? (
                  <div className="api-banner api-banner--danger" role="alert">
                    <strong>
                      {conflicts.length} existing workspace{conflicts.length === 1 ? '' : 's'} will be
                      overwritten
                    </strong>
                    <span>
                      {conflicts.map((entry) => entry.name).join(', ')} — their current requests,
                      environments, and profiles are replaced by the backup&rsquo;s.
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
