import { useAppStore } from '../../store/appStore';
import { Button } from '../../components/Button';
import { StackBadge } from '../../components/StackBadge';

export function AddProjectDialog() {
  const open = useAppStore((s) => s.addDialogOpen);
  const detection = useAppStore((s) => s.addDetection);
  const busy = useAppStore((s) => s.addBusy);
  const confirm = useAppStore((s) => s.confirmAddProject);
  const cancel = useAppStore((s) => s.cancelAddDialog);

  if (!open || !detection) return null;

  const { path, detection: result } = detection;

  return (
    <div className="overlay-root" onMouseDown={cancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog__header">
          <h2>Add project</h2>
        </div>
        <div className="dialog__body">
          <div className="dialog__path mono">{path}</div>

          <div className="dialog__field">
            <span className="dialog__label">Detected stack</span>
            <div className="overview-badges">
              {result.stack.length === 0 ? (
                <span className="page-subtitle">Nothing recognized — you can still add it.</span>
              ) : (
                result.stack.map((s) => <StackBadge key={s} stack={s} />)
              )}
            </div>
          </div>

          <div className="dialog__field">
            <span className="dialog__label">Suggested processes</span>
            {result.suggestedProcesses.length === 0 ? (
              <span className="page-subtitle">None — add commands later in the Processes tab.</span>
            ) : (
              <ul className="dialog__list">
                {result.suggestedProcesses.map((p) => (
                  <li key={p.id} className="mono">
                    {p.command} {p.args.join(' ')}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {result.warnings.map((w) => (
            <div key={w} className="inline-banner warning">
              {w}
            </div>
          ))}
        </div>
        <div className="dialog__footer">
          <Button variant="ghost" onClick={cancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Adding…' : 'Add project'}
          </Button>
        </div>
      </div>
    </div>
  );
}
