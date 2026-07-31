import { useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import type { BureauError } from '@shared/contracts/errors';
import type {
  ApiExportPlan,
  ApiExportScope,
  ApiInterchangeFormat,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';

type Props = {
  snapshot: ApiWorkspaceSnapshot | null;
  activeRequestId: string | null;
  selectedHistoryIds: string[];
  plan: ApiExportPlan | null;
  busy: boolean;
  error: BureauError | null;
  onPlan(format: ApiInterchangeFormat, scope: ApiExportScope): void;
  onCommit(format: ApiInterchangeFormat, scope: ApiExportScope): void;
  onCancel(): void;
};

const FORMAT_LABELS: Record<ApiInterchangeFormat, string> = {
  bureau: 'Bureau (lossless)',
  postman: 'Postman Collection v2.1',
  openapi: 'OpenAPI 3.2',
  har: 'HAR 1.2 (history)',
  curl: 'cURL command (one request)',
};

/**
 * Two-step export: planning renders the document and reports what will be lost, and only an
 * explicit save writes a file. Secrets are never included.
 */
export function ExportDialog({
  snapshot,
  activeRequestId,
  selectedHistoryIds,
  plan,
  busy,
  error,
  onPlan,
  onCommit,
  onCancel,
}: Props) {
  const [format, setFormat] = useState<ApiInterchangeFormat>('bureau');
  const [collectionId, setCollectionId] = useState<string>('');

  const folders = (snapshot?.collections ?? []).filter((node) => node.kind === 'folder');

  const scope: ApiExportScope =
    format === 'curl'
      ? { kind: 'request', requestId: activeRequestId ?? '' }
      : format === 'har'
        ? { kind: 'history', historyIds: selectedHistoryIds }
        : collectionId
          ? { kind: 'collection', collectionId }
          : { kind: 'workspace' };

  const blocked =
    (format === 'curl' && !activeRequestId) ||
    (format === 'har' && selectedHistoryIds.length === 0);

  return (
    <Dialog
      open
      size="wide"
      title="Export"
      description="Write this workspace, a folder or a single request to a file. Secrets are never included."
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {plan ? (
            <Button
              variant="primary"
              loading={busy}
              disabled={busy}
              onClick={() => onCommit(format, scope)}
            >
              Save file…
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={busy}
              disabled={busy || blocked}
              onClick={() => onPlan(format, scope)}
            >
              Review export
            </Button>
          )}
        </>
      }
    >
      <div className="api-dialog">
        <Dropdown
          label="Format"
          value={format}
          options={(Object.keys(FORMAT_LABELS) as ApiInterchangeFormat[]).map((value) => ({
            value,
            label: FORMAT_LABELS[value],
          }))}
          onChange={(value) => setFormat(value as ApiInterchangeFormat)}
        />

        {format !== 'curl' && format !== 'har' ? (
          <Dropdown
            label="Scope"
            value={collectionId}
            options={[
              { value: '', label: 'Whole workspace' },
              ...folders.map((folder) => ({ value: folder.collectionId, label: folder.name })),
            ]}
            onChange={setCollectionId}
          />
        ) : null}

        {format === 'curl' && !activeRequestId ? (
          <p className="api-field-hint">Open a request first — cURL exports a single request.</p>
        ) : null}
        {format === 'har' ? (
          <p className="api-field-hint">
            {selectedHistoryIds.length === 0
              ? 'Select history entries first — HAR exports recorded traffic, not collections.'
              : `${selectedHistoryIds.length} history entr${selectedHistoryIds.length === 1 ? 'y' : 'ies'} selected.`}
          </p>
        ) : null}

        {error ? (
          <div className="api-banner api-banner--danger" role="alert">
            <strong>Export failed</strong>
            <span>{error.message}</span>
          </div>
        ) : null}

        {plan ? (
          <>
            <div className="api-export-dialog__summary mono">
              {plan.itemCount} item{plan.itemCount === 1 ? '' : 's'} · {plan.suggestedFileName}
            </div>

            {plan.privacySensitive ? (
              <div className="api-banner api-banner--danger" role="alert">
                <strong>This export contains captured traffic</strong>
                <span>
                  HAR files record real requests and responses. Credential headers are redacted,
                  but response bodies may still contain personal data. Review before sharing.
                </span>
              </div>
            ) : null}

            <div className="api-banner api-banner--warning" role="status">
              <strong>Secrets are not exported</strong>
              <span>
                Secret values stay in the vault. Anything that needs one is exported as a
                placeholder.
              </span>
            </div>

            {plan.omissions.length > 0 ? (
              <div className="api-export-dialog__omissions">
                <span className="api-field-label">
                  {plan.omissions.length} thing{plan.omissions.length === 1 ? '' : 's'} will not be
                  exported
                </span>
                <ul>
                  {plan.omissions.map((entry, index) => (
                    <li key={`${entry.code}:${index}`}>{entry.message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plan.inlinePreview ? (
              <pre className="api-export-dialog__preview mono">{plan.inlinePreview}</pre>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
