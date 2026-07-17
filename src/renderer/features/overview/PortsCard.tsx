import { useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { StopIcon } from '../../components/icons';
import { useModalDismiss } from '../../lib/useModalDismiss';
import type { ListeningPort, PortOwner } from '@shared/contracts/ports';

function ownerTone(owner: PortOwner): 'info' | 'warning' | 'muted' {
  if (owner === 'bureau') return 'info';
  if (owner === 'system') return 'warning';
  return 'muted';
}

function ownerLabel(owner: PortOwner): string {
  if (owner === 'bureau') return 'Bureau';
  if (owner === 'system') return 'System';
  return 'Unknown';
}

/** Conflicts first, then Bureau-owned listeners — the rest are summarized. */
function portsForOverview(ports: ListeningPort[]): {
  rows: ListeningPort[];
  hiddenCount: number;
} {
  const conflicts = ports.filter((p) => p.conflict);
  const bureau = ports.filter((p) => !p.conflict && p.owner === 'bureau');
  const rows = [...conflicts, ...bureau].sort((a, b) => a.port - b.port);
  return { rows, hiddenCount: Math.max(0, ports.length - rows.length) };
}

function PortRow({
  row,
  onKill,
}: {
  row: ListeningPort;
  onKill: (row: ListeningPort) => void;
}) {
  return (
    <div className={['port-row', row.conflict ? 'conflict' : ''].join(' ')} role="row">
      <span
        className={['port-row__dot', row.conflict ? 'conflict' : row.owner].join(' ')}
        aria-hidden
      />
      <span className="port-row__port mono" role="cell">
        {row.port}
      </span>
      <span className="port-row__proto mono" role="cell">
        {row.protocol}
      </span>
      <span className="port-row__pid mono" role="cell">
        {row.pid ?? '—'}
      </span>
      <div className="port-row__owner" role="cell">
        <span className={`stack-badge ${ownerTone(row.owner)}`}>{ownerLabel(row.owner)}</span>
        {row.conflict && <span className="port-row__conflict">Conflict</span>}
      </div>
      <div className="port-row__controls" role="cell">
        {row.pid != null && (
          <IconButton label={`Kill process on port ${row.port}`} onClick={() => onKill(row)}>
            <StopIcon size={14} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

export function PortsCard({ projectId }: { projectId: string }) {
  const ports = useAppStore((s) => s.portsByProject[projectId]);
  const loadPorts = useAppStore((s) => s.loadPorts);
  const killPort = useAppStore((s) => s.killPort);
  const [confirm, setConfirm] = useState<{ pid: number; port: number } | null>(null);
  const killDialogRef = useRef<HTMLDivElement>(null);
  useModalDismiss(() => setConfirm(null), killDialogRef, Boolean(confirm));

  const conflictCount = ports?.ports.filter((p) => p.conflict).length ?? 0;
  const { rows, hiddenCount } = ports
    ? portsForOverview(ports.ports)
    : { rows: [] as ListeningPort[], hiddenCount: 0 };

  const onKill = (row: ListeningPort): void => {
    if (row.pid == null) return;
    if (row.owner !== 'bureau') {
      setConfirm({ pid: row.pid, port: row.port });
      return;
    }
    void killPort(row.pid, row.port);
  };

  return (
    <section className="overview-card overview-card--ports">
      <div className="overview-card__head">
        <h2 className="overview-card__title">Ports</h2>
        {ports ? (
          <span className="overview-count">
            {conflictCount > 0
              ? `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`
              : `${ports.ports.length} listening`}
          </span>
        ) : (
          <span className="overview-count">Loading…</span>
        )}
      </div>

      {!ports ? (
        <p className="overview-card__empty">Scanning listeners…</p>
      ) : rows.length === 0 ? (
        <p className="overview-card__empty">
          {ports.ports.length === 0
            ? 'No listeners detected on this machine.'
            : 'No Bureau-owned ports or conflicts for this project.'}
        </p>
      ) : (
        <div className="port-list overview-port-list" role="table" aria-label="Project ports">
          {rows.map((row) => (
            <PortRow
              key={`${row.protocol}-${row.port}-${row.pid ?? 'none'}`}
              row={row}
              onKill={onKill}
            />
          ))}
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="overview-card__empty overview-ports__more mono">
          +{hiddenCount} other listener{hiddenCount === 1 ? '' : 's'} on this machine
        </p>
      )}

      <div className="overview-card__foot">
        <Button variant="ghost" onClick={() => void loadPorts(projectId)}>
          Refresh
        </Button>
      </div>

      {confirm && (
        <div className="overlay-root" onMouseDown={() => setConfirm(null)}>
          <div
            ref={killDialogRef}
            className="dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>Kill process {confirm.pid}?</h2>
            <p>
              This will stop a non-Bureau process listening on port {confirm.port}. This cannot be
              undone.
            </p>
            <div className="dialog__actions">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  void killPort(confirm.pid, confirm.port);
                  setConfirm(null);
                }}
              >
                Kill process
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
