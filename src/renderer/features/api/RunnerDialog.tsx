import { useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextField } from '@renderer/components/TextField';
import type { BureauError } from '@shared/contracts/errors';
import type {
  ApiRunConfig,
  ApiRunDataSummary,
  ApiRunTarget,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';
import type { ApiRunState } from '@renderer/store/apiStore';

type Props = {
  snapshot: ApiWorkspaceSnapshot | null;
  activeRequestId: string | null;
  runData: ApiRunDataSummary | null;
  runDataBusy: boolean;
  run: ApiRunState | null;
  error: BureauError | null;
  onChooseData(): void;
  onClearData(): void;
  onStart(config: Omit<ApiRunConfig, 'workspaceId' | 'dataSetId'>): void;
  onCancelRun(): void;
  onExportReport(format: 'json' | 'junit'): void;
  onDismissRun(): void;
  onClose(): void;
};

/**
 * The collection runner.
 *
 * Requests run sequentially and the panel shows each result as it lands, so a long run is legible
 * while it happens rather than only at the end. Whether scripts are enabled is stated before the
 * run starts (§13.4) — a run whose assertions silently did not execute would be worse than no run.
 */
export function RunnerDialog({
  snapshot,
  activeRequestId,
  runData,
  runDataBusy,
  run,
  error,
  onChooseData,
  onClearData,
  onStart,
  onCancelRun,
  onExportReport,
  onDismissRun,
  onClose,
}: Props) {
  const [collectionId, setCollectionId] = useState('');
  const [scope, setScope] = useState<'workspace' | 'collection' | 'request'>('workspace');
  const [environmentId, setEnvironmentId] = useState<string>(
    snapshot?.summary.activeEnvironmentId ?? ''
  );
  const [iterations, setIterations] = useState('1');
  const [delayMs, setDelayMs] = useState('0');
  const [stopOnFailure, setStopOnFailure] = useState(false);

  const folders = (snapshot?.collections ?? []).filter((node) => node.kind === 'folder');
  const running = run?.status === 'running';

  const target: ApiRunTarget =
    scope === 'request' && activeRequestId
      ? { kind: 'request', requestId: activeRequestId }
      : scope === 'collection' && collectionId
        ? { kind: 'collection', collectionId }
        : { kind: 'workspace' };

  const blocked =
    (scope === 'request' && !activeRequestId) || (scope === 'collection' && !collectionId);

  const parsedIterations = Math.max(1, Math.min(1000, Number(iterations) || 1));
  const parsedDelay = Math.max(0, Math.min(60_000, Number(delayMs) || 0));

  return (
    <Dialog
      open
      size="wide"
      title="Run"
      description="Send every request in a folder in order, optionally once per row of a data set."
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {!run ? (
            <Button
              variant="primary"
              disabled={blocked}
              onClick={() =>
                onStart({
                  target,
                  environmentId: environmentId || null,
                  iterations: parsedIterations,
                  delayMs: parsedDelay,
                  stopOnFailure,
                })
              }
            >
              Start run
            </Button>
          ) : running ? (
            <Button variant="danger" onClick={onCancelRun}>
              Cancel run
            </Button>
          ) : (
            <Button variant="primary" onClick={onDismissRun}>
              New run
            </Button>
          )}
        </>
      }
    >
      <div className="api-dialog">
        {error ? (
          <div className="api-banner api-banner--danger" role="alert">
            <strong>Run failed to start</strong>
            <span>{error.message}</span>
          </div>
        ) : null}

        {!run ? (
          <>
            <Dropdown
              label="What to run"
              value={scope}
              options={[
                { value: 'workspace', label: 'Whole workspace' },
                { value: 'collection', label: 'One folder' },
                { value: 'request', label: 'The open request' },
              ]}
              onChange={(value) => setScope(value as typeof scope)}
            />

            {scope === 'collection' ? (
              <Dropdown
                label="Folder"
                value={collectionId}
                options={[
                  { value: '', label: 'Choose a folder…' },
                  ...folders.map((folder) => ({ value: folder.collectionId, label: folder.name })),
                ]}
                onChange={setCollectionId}
              />
            ) : null}
            {scope === 'request' && !activeRequestId ? (
              <p className="api-field-hint">Open a request first.</p>
            ) : null}

            <Dropdown
              label="Environment"
              value={environmentId}
              options={[
                { value: '', label: 'None' },
                ...(snapshot?.environments ?? []).map((environment) => ({
                  value: environment.environmentId,
                  label: environment.name,
                })),
              ]}
              onChange={setEnvironmentId}
            />

            <div className="api-dialog__row">
              <div className="api-dialog__field">
                <label className="api-field-label" htmlFor="api-runner-iterations">
                  Iterations
                </label>
                <TextField
                  id="api-runner-iterations"
                  mono
                  inputMode="numeric"
                  value={iterations}
                  onChange={(event) => setIterations(event.target.value)}
                />
              </div>
              <div className="api-dialog__field">
                <label className="api-field-label" htmlFor="api-runner-delay">
                  Delay between requests (ms)
                </label>
                <TextField
                  id="api-runner-delay"
                  mono
                  inputMode="numeric"
                  value={delayMs}
                  onChange={(event) => setDelayMs(event.target.value)}
                />
              </div>
            </div>

            <Checkbox
              label="Stop on the first failure"
              checked={stopOnFailure}
              onChange={setStopOnFailure}
            />

            <div className="api-runner-dialog__data">
              <span className="api-field-label">Iteration data</span>
              {runData ? (
                <div className="api-runner-dialog__data-summary">
                  <span className="mono">{runData.fileName}</span>
                  <span className="api-field-hint">
                    {runData.rowCount} row{runData.rowCount === 1 ? '' : 's'} ·{' '}
                    {runData.columns.join(', ')}
                  </span>
                  {runData.warnings.map((note, index) => (
                    <span key={`${note.code}:${index}`} className="api-field-hint">
                      {note.message}
                    </span>
                  ))}
                  <Button variant="quiet" size="compact" onClick={onClearData}>
                    Remove
                  </Button>
                </div>
              ) : (
                <div className="api-runner-dialog__data-summary">
                  <span className="api-field-hint">
                    Optional. A JSON array or CSV with a header row; each row becomes one iteration.
                  </span>
                  <Button
                    variant="secondary"
                    size="compact"
                    loading={runDataBusy}
                    onClick={onChooseData}
                  >
                    Choose file…
                  </Button>
                </div>
              )}
            </div>
          </>
        ) : (
          <RunProgress
            run={run}
            onCancelRun={onCancelRun}
            onExportReport={onExportReport}
            onDismissRun={onDismissRun}
          />
        )}
      </div>
    </Dialog>
  );
}

function RunProgress({
  run,
  onExportReport,
  onDismissRun,
}: {
  run: ApiRunState;
  onCancelRun(): void;
  onExportReport(format: 'json' | 'junit'): void;
  onDismissRun(): void;
}) {
  const totals = run.report?.totals;
  const percent =
    run.plannedItems > 0 ? Math.round((run.completed / run.plannedItems) * 100) : 0;

  return (
    <div className="api-runner-progress">
      <div className="api-runner-progress__header">
        <span className="api-runner-progress__status">
          {run.status === 'running'
            ? 'Running'
            : run.status === 'cancelled'
              ? 'Cancelled'
              : run.status === 'failed'
                ? 'Failed'
                : 'Passed'}
        </span>
        <span className="api-runner-progress__count mono">
          {run.completed}/{run.plannedItems || '?'}
        </span>
      </div>

      <div
        className="api-runner-progress__bar"
        role="progressbar"
        aria-valuenow={run.completed}
        aria-valuemin={0}
        aria-valuemax={run.plannedItems || undefined}
      >
        <div className="api-runner-progress__bar-fill" style={{ width: `${percent}%` }} />
      </div>

      {!run.scriptsEnabled ? (
        <div className="api-banner api-banner--warning" role="status">
          <strong>No scripts are enabled</strong>
          <span>
            This run sends requests but asserts nothing. Enable a collection&rsquo;s scripts to run
            its tests.
          </span>
        </div>
      ) : null}

      <ul className="api-runner-progress__items">
        {run.items.map((item) => {
          const failed = item.tests.filter((test) => !test.passed);
          return (
            <li
              key={item.itemId}
              className={item.ok ? 'api-runner-item' : 'api-runner-item is-failed'}
            >
              <div className="api-runner-item__main">
                <span className={item.ok ? 'state-dot success' : 'state-dot danger'} />
                <span className="api-runner-item__name">{item.name}</span>
                <span className="api-runner-item__meta mono">
                  #{item.iteration} · {item.status ?? '—'} · {item.totalMs} ms
                </span>
              </div>
              {item.errorMessage ? (
                <p className="api-runner-item__error">{item.errorMessage}</p>
              ) : null}
              {failed.map((test, index) => (
                <p key={`${item.itemId}:${index}`} className="api-runner-item__error">
                  {test.name}: {test.message}
                </p>
              ))}
            </li>
          );
        })}
      </ul>

      {totals ? (
        <div className="api-runner-progress__totals mono">
          {totals.requests} request{totals.requests === 1 ? '' : 's'} · {totals.failedRequests}{' '}
          failed · {totals.assertions} assertion{totals.assertions === 1 ? '' : 's'} ·{' '}
          {totals.failedAssertions} failed · {totals.totalMs} ms
        </div>
      ) : null}

      {run.report ? (
        <div className="api-runner-progress__actions">
          <Button variant="secondary" size="compact" onClick={() => onExportReport('json')}>
            Export JSON…
          </Button>
          <Button variant="secondary" size="compact" onClick={() => onExportReport('junit')}>
            Export JUnit…
          </Button>
          <Button variant="quiet" size="compact" onClick={onDismissRun}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}
