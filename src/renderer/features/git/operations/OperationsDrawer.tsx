import { useEffect, useRef, type ReactElement } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { useAppStore } from '@renderer/store/appStore';
import { Button } from '@renderer/components/Button';
import { Skeleton } from '@renderer/components/Skeleton';
import { PanelError } from '@renderer/features/git/PanelState';
import './OperationsDrawer.css';

function formatState(state: string): string {
  switch (state) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return state;
  }
}

export function OperationsDrawer(): ReactElement | null {
  const open = useGitStore((s) => s.operationDrawerOpen);
  const setOpen = useGitStore((s) => s.setOperationDrawerOpen);
  const operations = useGitStore((s) => s.operations);
  const operationsLoading = useGitStore((s) => s.operationsLoading);
  const operationsError = useGitStore((s) => s.operationsError);
  const loadOperations = useGitStore((s) => s.loadOperations);
  const cancelOperation = useGitStore((s) => s.cancelOperation);
  const announce = useAppStore((s) => s.announce);
  const lastStates = useRef(new Map<string, string>());

  useEffect(() => {
    if (!open) return;
    void loadOperations();
    const interval = window.setInterval(() => {
      void loadOperations();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [open, loadOperations]);

  // The 2s poll silently rewrote Queued → Running → Succeeded. Diff each operation's
  // state against the previous poll and push only real transitions to the live region;
  // an id we have not seen before is the first paint, not a change worth announcing.
  useEffect(() => {
    if (!open) {
      lastStates.current.clear();
      return;
    }
    operations.forEach((op) => {
      const previous = lastStates.current.get(op.id);
      if (previous !== undefined && previous !== op.state) {
        announce(`${op.summary}: ${formatState(op.state)}`);
      }
      lastStates.current.set(op.id, op.state);
    });
  }, [open, operations, announce]);

  // The drawer hand-rolls role="dialog", so it has to hand-roll Escape too — the
  // Dialog primitive's handler never runs here. Mirrors DiffPanel's expanded view.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="overlay-root overlay-root--drawer" onMouseDown={() => setOpen(false)}>
      <aside
        className="operations-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Git operations"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="operations-drawer__header">
          <h2>Git operations</h2>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </header>
        <div className="operations-drawer__body">
          {operationsError ? (
            <PanelError
              title="Could not load operations"
              message={operationsError.message}
              onRetry={() => void loadOperations()}
            />
          ) : null}

          {/* "No recent operations" used to show during the very first load, stating
              as fact something not yet known. Skeletons until the list has answered. */}
          {operationsLoading && operations.length === 0 ? (
            <div className="operations-drawer__loading">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} width="100%" height="var(--size-hub-row)" />
              ))}
            </div>
          ) : operations.length === 0 ? (
            operationsError ? null : (
              <p className="operations-drawer__empty">No recent operations.</p>
            )
          ) : (
            <ul className="operations-drawer__list">
              {operations.map((op) => (
                <li key={op.id} className="operations-drawer__item">
                  <div className="operations-drawer__summary">{op.summary}</div>
                  <div className="operations-drawer__meta mono">
                    <span>{formatState(op.state)}</span>
                    {op.progress?.message ? <span>{op.progress.message}</span> : null}
                  </div>
                  {op.error ? (
                    <p className="operations-drawer__error" role="alert">
                      {op.error.message}
                    </p>
                  ) : null}
                  {op.cancellable && op.state === 'running' ? (
                    <Button variant="ghost" onClick={() => void cancelOperation(op.id)}>
                      Cancel
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
