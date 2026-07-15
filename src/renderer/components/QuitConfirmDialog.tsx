import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { Button } from './Button';

export function QuitConfirmDialog() {
  const closePrompt = useAppStore((s) => s.closePrompt);
  const saveAllAndQuit = useAppStore((s) => s.saveAllAndQuit);
  const discardAllAndQuit = useAppStore((s) => s.discardAllAndQuit);
  const cancelQuit = useAppStore((s) => s.cancelQuit);

  useEffect(() => {
    if (!closePrompt) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelQuit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closePrompt, cancelQuit]);

  if (!closePrompt) return null;

  const { processes } = closePrompt;
  const dirtyFiles = closePrompt.dirtyFiles ?? 0;
  const count = processes.length;

  return (
    <div className="overlay-root" onMouseDown={cancelQuit}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="Quit Bureau"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog__header">
          <h2>Quit Bureau?</h2>
        </div>
        <div className="dialog__body">
          <p className="dialog__text">
            {dirtyFiles > 0 ? `${dirtyFiles} ${dirtyFiles === 1 ? 'file has' : 'files have'} unsaved changes.` : 'No files have unsaved changes.'}{' '}
            {count > 0 ? `${count} ${count === 1 ? 'process is' : 'processes are'} still running and will be stopped before quitting.` : 'No project processes are running.'}
          </p>
          {count > 0 ? <ul className="dialog__list">
            {processes.map((p) => (
              <li key={`${p.projectId}:${p.processId}`} className="mono">
                {p.label}
              </li>
            ))}
          </ul> : null}
        </div>
        <div className="dialog__footer">
          <Button variant="ghost" onClick={cancelQuit}>
            Cancel
          </Button>
          {dirtyFiles > 0 ? <Button variant="danger" onClick={discardAllAndQuit}>Discard and Quit</Button> : null}
          <Button variant="primary" onClick={() => void saveAllAndQuit()}>{dirtyFiles > 0 ? 'Save All and Quit' : count > 0 ? 'End all and quit' : 'Quit'}</Button>
        </div>
      </div>
    </div>
  );
}
