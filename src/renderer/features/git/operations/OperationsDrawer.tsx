import { useEffect, type ReactElement } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
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
  const loadOperations = useGitStore((s) => s.loadOperations);
  const cancelOperation = useGitStore((s) => s.cancelOperation);

  useEffect(() => {
    if (!open) return;
    void loadOperations();
    const interval = window.setInterval(() => {
      void loadOperations();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [open, loadOperations]);

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
          {operations.length === 0 ? (
            <p className="operations-drawer__empty">No recent operations.</p>
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
