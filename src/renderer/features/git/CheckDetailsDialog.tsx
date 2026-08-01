import type { ReactElement } from 'react';
import type { CommitCheckSummary } from '@shared/contracts/github';
import { Dialog } from '@renderer/components/Dialog';
import { Button } from '@renderer/components/Button';
import {
  checkItemTone,
  checkRollupLabel,
  formatCheckItemDetail,
} from '@shared/git/checkRollup';
import './CheckDetailsDialog.css';

type Props = {
  open: boolean;
  summary?: CommitCheckSummary;
  repository?: string;
  onClose: () => void;
};

function abbreviateOid(oid: string): string {
  return oid.length > 7 ? oid.slice(0, 7) : oid;
}

function openExternal(url: string): void {
  void window.bureau.github.openUrl({ url });
}

export function CheckDetailsDialog({
  open,
  summary,
  repository,
  onClose,
}: Props): ReactElement {
  const title = summary ? checkRollupLabel(summary.state) : 'Checks';
  const commitChecksUrl =
    summary && repository
      ? `https://github.com/${repository}/commit/${summary.oid}/checks`
      : undefined;

  return (
    <Dialog
      open={open}
      title={title}
      size="wide"
      description={
        summary ? (
          <>
            Status for commit{' '}
            <span className="mono">{abbreviateOid(summary.oid)}</span>
            {repository ? (
              <>
                {' '}
                on <span className="mono">{repository}</span>
              </>
            ) : null}
            .
          </>
        ) : (
          'No check details available.'
        )
      }
      onClose={onClose}
      actions={
        <>
          {commitChecksUrl ? (
            <Button variant="secondary" onClick={() => openExternal(commitChecksUrl)}>
              View on GitHub
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {!summary || summary.checks.length === 0 ? (
        <p className="check-details__empty">No individual checks were reported for this commit.</p>
      ) : (
        <ul className="check-details__list">
          {summary.checks.map((check, index) => {
            const detail = formatCheckItemDetail(check);
            const tone = checkItemTone(check);
            const key = `${check.name}:${check.state}:${check.conclusion ?? ''}:${index}`;
            return (
              <li key={key} className="check-details__row">
                <span className={['state-dot', tone].join(' ')} role="presentation" />
                <span className="check-details__name">{check.name}</span>
                <span className="check-details__detail mono">{detail}</span>
                {check.detailsUrl ? (
                  <Button
                    variant="ghost"
                    className="check-details__open"
                    onClick={() => openExternal(check.detailsUrl!)}
                  >
                    Open
                  </Button>
                ) : (
                  <span className="check-details__open-spacer" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
