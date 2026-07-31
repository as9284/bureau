import { useMemo, useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextArea } from '@renderer/components/TextArea';
import type { BureauError } from '@shared/contracts/errors';
import type {
  ApiImportConflictStrategy,
  ApiImportPreview,
  ApiInterchangeFormat,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';

type Props = {
  snapshot: ApiWorkspaceSnapshot | null;
  preview: ApiImportPreview | null;
  busy: boolean;
  error: BureauError | null;
  onInspect(input: { format: ApiInterchangeFormat | 'auto'; text?: string; fromFile?: boolean }): void;
  onCommit(input: { parentId: string | null; conflictStrategy: ApiImportConflictStrategy }): void;
  onCancel(): void;
};

const FORMATS: Array<{ value: ApiInterchangeFormat | 'auto'; label: string }> = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'curl', label: 'cURL command' },
  { value: 'postman', label: 'Postman Collection v2.1' },
  { value: 'openapi', label: 'OpenAPI / Swagger' },
  { value: 'har', label: 'HAR 1.2' },
  { value: 'bureau', label: 'Bureau export' },
];

/**
 * Two-step import: inspect produces a preview, and only an explicit commit writes anything.
 * Nothing in the source is executed or fetched at any point.
 */
export function ImportDialog({
  snapshot,
  preview,
  busy,
  error,
  onInspect,
  onCommit,
  onCancel,
}: Props) {
  const [format, setFormat] = useState<ApiInterchangeFormat | 'auto'>('auto');
  const [text, setText] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [strategy, setStrategy] = useState<ApiImportConflictStrategy>('rename');

  const folders = useMemo(
    () => (snapshot?.collections ?? []).filter((node) => node.kind === 'folder'),
    [snapshot?.collections]
  );

  const conflicts = preview
    ? preview.nodes.filter((node) => node.conflict).length +
      preview.environments.filter((environment) => environment.conflict).length
    : 0;

  return (
    <Dialog
      open
      size="wide"
      title="Import"
      description="Bring in a Postman, Insomnia, OpenAPI or HAR collection. Nothing is written until you commit."
      onClose={onCancel}
      actions={
        !preview ? (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              loading={busy}
              disabled={busy}
              onClick={() => onInspect({ format, fromFile: true })}
            >
              Choose file…
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={busy || !text.trim()}
              onClick={() => onInspect({ format, text })}
            >
              Inspect
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={busy}
              onClick={() => onCommit({ parentId: parentId || null, conflictStrategy: strategy })}
            >
              Import {preview.counts.requests} request
              {preview.counts.requests === 1 ? '' : 's'}
            </Button>
          </>
        )
      }
    >
      <div className="api-dialog">
        {!preview ? (
          <>
            <Dropdown
              label="Format"
              value={format}
              options={FORMATS}
              onChange={(value) => setFormat(value as ApiInterchangeFormat | 'auto')}
            />

            <TextArea
              label="Paste a cURL command or a collection document"
              className="mono"
              rows={10}
              value={text}
              placeholder={"curl https://api.example.com/health\n\n…or paste JSON / YAML"}
              onChange={(event) => setText(event.target.value)}
            />

            <p className="api-field-hint">
              Nothing is sent or executed while importing. Scripts always arrive disabled, and
              credentials in the source are never stored — you re-add them as secrets.
            </p>

            {error ? (
              <div className="api-banner api-banner--danger" role="alert">
                <strong>Import failed</strong>
                <span>{error.message}</span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="api-import-dialog__summary">
              <span className="api-import-dialog__source mono">{preview.sourceLabel}</span>
              <span className="api-import-dialog__counts mono">
                {preview.counts.folders} folders · {preview.counts.requests} requests ·{' '}
                {preview.counts.environments} environments
              </span>
            </div>

            {preview.truncated ? (
              <div className="api-banner api-banner--warning" role="alert">
                <strong>The import was truncated</strong>
                <span>The source exceeded the item limit. Only the listed items will be created.</span>
              </div>
            ) : null}

            {preview.counts.scripts > 0 ? (
              <div className="api-banner api-banner--warning" role="alert">
                <strong>
                  {preview.counts.scripts} imported script
                  {preview.counts.scripts === 1 ? '' : 's'}
                </strong>
                <span>
                  Scripts are imported disabled and never run until you enable them for the
                  collection.
                </span>
              </div>
            ) : null}

            <div className="api-import-dialog__tree" role="tree" aria-label="Items to import">
              {preview.nodes.map((node) => (
                <div
                  key={node.tempId}
                  role="treeitem"
                  aria-selected={false}
                  className={`api-import-dialog__row${node.conflict ? ' is-conflict' : ''}`}
                >
                  <span className="api-import-dialog__kind mono">
                    {node.kind === 'folder' ? 'DIR' : (node.method ?? 'REQ')}
                  </span>
                  <span className="api-import-dialog__name">{node.name}</span>
                  {node.url ? <span className="api-import-dialog__url mono">{node.url}</span> : null}
                  {node.hasScripts ? (
                    <span className="api-import-dialog__flag mono">script</span>
                  ) : null}
                  {node.conflict ? (
                    <span className="api-import-dialog__flag api-import-dialog__flag--conflict mono">
                      name taken
                    </span>
                  ) : null}
                </div>
              ))}
            </div>

            {preview.warnings.length > 0 ? (
              <details className="api-import-dialog__warnings">
                <summary>
                  {preview.warnings.length} warning{preview.warnings.length === 1 ? '' : 's'}
                </summary>
                <ul>
                  {preview.warnings.map((warning, index) => (
                    <li key={`${warning.code}:${index}`}>{warning.message}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            <Dropdown
              label="Destination"
              value={parentId}
              options={[
                { value: '', label: 'Workspace root' },
                ...folders.map((folder) => ({ value: folder.collectionId, label: folder.name })),
              ]}
              onChange={setParentId}
            />

            <Dropdown
              label={`If a name already exists${conflicts > 0 ? ` (${conflicts} will collide)` : ''}`}
              value={strategy}
              options={[
                { value: 'rename', label: 'Keep both — rename the imported item' },
                { value: 'skip', label: 'Skip the imported item' },
                { value: 'replace', label: 'Replace the existing item' },
              ]}
              onChange={(value) => setStrategy(value as ApiImportConflictStrategy)}
            />

            {strategy === 'replace' && conflicts > 0 ? (
              <div className="api-banner api-banner--danger" role="alert">
                <strong>Replace removes existing items</strong>
                <span>
                  {conflicts} existing item{conflicts === 1 ? '' : 's'} and everything inside{' '}
                  {conflicts === 1 ? 'it' : 'them'} will be deleted.
                </span>
              </div>
            ) : null}

            {error ? (
              <div className="api-banner api-banner--danger" role="alert">
                <strong>Import failed</strong>
                <span>{error.message}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}
