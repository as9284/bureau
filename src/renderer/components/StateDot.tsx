import type { ProcessStatus } from '@shared/contracts/processes';
import { STATUS_LABEL, STATUS_TONE } from '../lib/processStatus';

export function StateDot({ status, busy }: { status: ProcessStatus; busy?: boolean }) {
  if (busy) {
    return <span className="state-spinner" role="img" aria-label="Working…" title="Working…" />;
  }
  return (
    <span
      className={['state-dot', STATUS_TONE[status], status === 'starting' ? 'pulse' : ''].join(' ')}
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
    />
  );
}
