import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Button } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { IconButton } from '../../components/IconButton';
import { StopIcon } from '../../components/icons';
import type { ListeningPort, PortOwner } from '@shared/contracts/ports';

type SortKey = 'status' | 'port' | 'owner';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'port', label: 'Port' },
  { value: 'owner', label: 'Owner' },
];

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

function ownerRank(owner: PortOwner): number {
  if (owner === 'bureau') return 0;
  if (owner === 'system') return 1;
  return 2;
}

/** Conflict first, then owner (Bureau → System → Unknown), then port. */
function statusRank(row: ListeningPort): number {
  return (row.conflict ? 0 : 10) + ownerRank(row.owner);
}

function comparePorts(a: ListeningPort, b: ListeningPort, sort: SortKey): number {
  if (sort === 'port') {
    return a.port - b.port || a.protocol.localeCompare(b.protocol);
  }
  if (sort === 'owner') {
    return (
      ownerRank(a.owner) - ownerRank(b.owner) ||
      Number(b.conflict) - Number(a.conflict) ||
      a.port - b.port
    );
  }
  return statusRank(a) - statusRank(b) || a.port - b.port;
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
        {row.processName && (
          <span className="port-row__process mono" title={row.processName}>
            {row.processName}
          </span>
        )}
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

export function PortsTab({ projectId }: { projectId: string }) {
  const ports = useAppStore((s) => s.portsByProject[projectId]);
  const loadPorts = useAppStore((s) => s.loadPorts);
  const killPort = useAppStore((s) => s.killPort);
  const [confirm, setConfirm] = useState<{ pid: number; port: number } | null>(null);
  const [sort, setSort] = useState<SortKey>('status');

  if (!ports) {
    return <div className="tab-loading">Loading…</div>;
  }

  const sorted = [...ports.ports].sort((a, b) => comparePorts(a, b, sort));

  const onKill = (row: ListeningPort): void => {
    if (row.pid == null) return;
    // Any non-Bureau process (system or unknown owner) requires explicit confirmation.
    if (row.owner !== 'bureau') {
      setConfirm({ pid: row.pid, port: row.port });
      return;
    }
    void killPort(row.pid, row.port);
  };

  const onSortChange = (next: SortKey): void => {
    setSort(next);
    void loadPorts(projectId);
  };

  return (
    <div className="ports-tab">
      <div className="ports-tab__header">
        <span className="ports-tab__title">Ports</span>
        <div className="ports-tab__actions">
          {ports.ports.length > 0 && (
            <>
              <span className="ports-tab__count mono">{ports.ports.length} listening</span>
              <Dropdown
                className="ports-tab__sort"
                label="Sort ports"
                value={sort}
                options={SORT_OPTIONS}
                onChange={onSortChange}
              />
            </>
          )}
          <Button variant="ghost" onClick={() => void loadPorts(projectId)}>
            Refresh
          </Button>
        </div>
      </div>

      {ports.ports.length === 0 ? (
        <div className="empty-state">
          <h1>No listening ports</h1>
          <p>No TCP listeners were detected on this machine.</p>
          <Button variant="ghost" onClick={() => void loadPorts(projectId)}>
            Scan again
          </Button>
        </div>
      ) : (
        <div
          className="port-list"
          role="table"
          aria-label="Listening ports"
          key={`ports-${sort}-${ports.scannedAt}`}
        >
          {sorted.map((row) => (
            <PortRow
              key={`${row.protocol}-${row.port}-${row.pid ?? 'none'}`}
              row={row}
              onKill={onKill}
            />
          ))}
        </div>
      )}

      {confirm && (
        <div className="overlay-root" onMouseDown={() => setConfirm(null)}>
          <div
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
    </div>
  );
}
