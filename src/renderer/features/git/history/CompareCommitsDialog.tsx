import type { ReactElement } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { EmptyState } from '@renderer/components/EmptyState';

function statusLabel(status: string): string {
  switch (status) {
    case 'added':
      return 'Added';
    case 'modified':
      return 'Modified';
    case 'deleted':
      return 'Deleted';
    case 'renamed':
      return 'Renamed';
    default:
      return 'Changed';
  }
}

export function CompareCommitsDialog(): ReactElement {
  const open = useGitStore((s) => s.compareDialogOpen);
  const setOpen = useGitStore((s) => s.setCompareDialogOpen);
  const compareResult = useGitStore((s) => s.compareResult);
  const compareBaseOid = useGitStore((s) => s.compareBaseOid);
  const compareTargetOid = useGitStore((s) => s.compareTargetOid);

  const baseShort = compareBaseOid?.slice(0, 7) ?? '—';
  const targetShort = compareTargetOid?.slice(0, 7) ?? '—';

  return (
    <Dialog
      open={open}
      title="Compare commits"
      description={
        <span className="mono">
          {baseShort} → {targetShort}
        </span>
      }
      onClose={() => setOpen(false)}
      actions={
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      }
    >
      {!compareResult ? (
        <p className="history-panel__compare-status">Loading comparison…</p>
      ) : !compareResult.ok ? (
        <EmptyState title="Compare failed" description={compareResult.error.message} />
      ) : compareResult.files.length === 0 ? (
        <EmptyState title="No differences" description="These commits have identical trees." />
      ) : (
        <ul className="history-panel__compare-list">
          {compareResult.files.map((file) => (
            <li key={`${file.status}:${file.path}`} className="history-panel__compare-item">
              <span
                className={`history-panel__compare-code history-panel__compare-code--${file.status}`}
              >
                {file.status.charAt(0).toUpperCase()}
              </span>
              <span className="history-panel__compare-path mono" title={file.path}>
                {file.originalPath ? `${file.originalPath} → ${file.path}` : file.path}
              </span>
              <span className="history-panel__compare-kind">{statusLabel(file.status)}</span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
