import type { CheckRollupState } from '@shared/contracts/github';

/** Map GitHub GraphQL `StatusState` (or REST combined status) onto our closed rollup. */
export function mapGitHubStatusState(state: string | null | undefined): CheckRollupState {
  switch ((state ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
      return 'failure';
    case 'ERROR':
      return 'error';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'none';
  }
}

export function checkRollupLabel(state: CheckRollupState): string {
  switch (state) {
    case 'success':
      return 'Checks passing';
    case 'failure':
      return 'Checks failing';
    case 'error':
      return 'Checks errored';
    case 'pending':
      return 'Checks pending';
    case 'none':
      return 'No checks';
  }
}

/** CSS tone class paired with `.state-dot` (see phase1.css). */
export function checkRollupTone(
  state: CheckRollupState
): 'success' | 'danger' | 'info' | 'warning' | 'idle' {
  switch (state) {
    case 'success':
      return 'success';
    case 'failure':
    case 'error':
      return 'danger';
    case 'pending':
      return 'info';
    case 'none':
      return 'idle';
  }
}

export function formatCheckItemDetail(check: {
  state: string;
  conclusion?: string | null;
}): string {
  if (check.state === 'COMPLETED' && check.conclusion) {
    return check.conclusion.toLowerCase().replace(/_/g, ' ');
  }
  return check.state.toLowerCase().replace(/_/g, ' ');
}

/** Map a single check/status context onto a StateDot tone. */
export function checkItemTone(
  check: { state: string; conclusion?: string | null }
): 'success' | 'danger' | 'info' | 'warning' | 'idle' {
  const detail = formatCheckItemDetail(check);
  if (detail === 'success' || detail === 'neutral' || detail === 'skipped') return 'success';
  if (
    detail === 'failure' ||
    detail === 'error' ||
    detail === 'cancelled' ||
    detail === 'timed out' ||
    detail === 'action required'
  ) {
    return 'danger';
  }
  if (
    detail === 'pending' ||
    detail === 'queued' ||
    detail === 'in progress' ||
    detail === 'waiting' ||
    detail === 'requested' ||
    detail === 'expected'
  ) {
    return 'info';
  }
  return 'idle';
}

export function formatCheckTooltip(
  state: CheckRollupState,
  checks: Array<{ name: string; state: string; conclusion?: string | null }>
): string {
  const heading = checkRollupLabel(state);
  if (checks.length === 0) return heading;
  const lines = checks
    .slice(0, 12)
    .map((check) => `${check.name}: ${formatCheckItemDetail(check)}`);
  const more = checks.length > 12 ? `\n…and ${checks.length - 12} more` : '';
  return `${heading}\n${lines.join('\n')}${more}`;
}
