import type { ProcessStatus } from '@shared/contracts/processes';

export const STATUS_TONE: Record<ProcessStatus, string> = {
  running: 'success',
  starting: 'info',
  crashed: 'danger',
  exited: 'idle',
  idle: 'idle',
};

export const STATUS_LABEL: Record<ProcessStatus, string> = {
  running: 'Running',
  starting: 'Starting',
  crashed: 'Crashed',
  exited: 'Stopped',
  idle: 'Idle',
};

export function statusLabel(status: ProcessStatus): string {
  return STATUS_LABEL[status];
}

export function pendingLabel(action: 'starting' | 'stopping' | 'restarting'): string {
  if (action === 'stopping') return 'Stopping…';
  if (action === 'restarting') return 'Restarting…';
  return 'Starting…';
}
