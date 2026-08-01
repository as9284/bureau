import type { ReactElement } from 'react';
import type { CheckRollupState, CommitCheckSummary } from '@shared/contracts/github';
import {
  checkRollupLabel,
  checkRollupTone,
  formatCheckTooltip,
} from '@shared/git/checkRollup';
import './CheckStatusIndicator.css';

type Props = {
  summary?: CommitCheckSummary;
  /** Compact = dot only (history rows). Default shows label for SyncBar. */
  compact?: boolean;
  loading?: boolean;
  /** When set (SyncBar), the chip becomes a button that opens details. */
  onOpenDetails?: () => void;
};

/**
 * Visual for a GitHub check rollup. Reuses `.state-dot` tones; hidden when there
 * is nothing useful to show (no checks / unknown).
 */
export function CheckStatusIndicator({
  summary,
  compact = false,
  loading,
  onOpenDetails,
}: Props): ReactElement | null {
  if (loading && !summary) {
    return (
      <span
        className={`check-status ${compact ? 'check-status--compact' : ''}`}
        title="Loading checks…"
        aria-label="Loading checks"
      >
        <span className="state-spinner" role="presentation" />
        {compact ? null : <span className="check-status__label">Checks…</span>}
      </span>
    );
  }

  if (!summary || summary.state === 'none') return null;

  const state: CheckRollupState = summary.state;
  const tone = checkRollupTone(state);
  const label = checkRollupLabel(state);
  const tooltip = onOpenDetails
    ? `${formatCheckTooltip(state, summary.checks)}\nClick for details`
    : formatCheckTooltip(state, summary.checks);
  const pulse = state === 'pending' ? 'pulse' : '';
  const className = [
    'check-status',
    compact ? 'check-status--compact' : '',
    onOpenDetails ? 'check-status--button' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const body = (
    <>
      <span className={['state-dot', tone, pulse].filter(Boolean).join(' ')} role="presentation" />
      {compact ? null : <span className="check-status__label">{label}</span>}
    </>
  );

  if (onOpenDetails) {
    return (
      <button
        type="button"
        className={className}
        title={tooltip}
        aria-label={`${label}. Show check details`}
        onClick={onOpenDetails}
      >
        {body}
      </button>
    );
  }

  return (
    <span className={className} title={tooltip} aria-label={label}>
      {body}
    </span>
  );
}
