import { useState, type ReactElement } from 'react';
import type { ReflogEntry } from '@shared/contracts/history';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { EmptyState } from '@renderer/components/EmptyState';
import { Skeleton } from '@renderer/components/Skeleton';
import { PanelError } from '@renderer/features/git/PanelState';
import { Badge } from '@renderer/components/Badge';
import { ResetCommitDialog, type ResetTarget } from '@renderer/features/git/history/ResetCommitDialog';
import './ReflogPanel.css';

type Props = {
  projectId: string;
  snapshot?: RepositorySnapshot;
  readOnly: boolean;
};

function formatMovedAt(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ReflogRow({
  entry,
  readOnly,
  busy,
  onReset,
}: {
  entry: ReflogEntry;
  readOnly: boolean;
  busy: boolean;
  onReset: () => void;
}): ReactElement {
  return (
    <li className="reflog-panel__item">
      <div className="reflog-panel__copy">
        <span className="reflog-panel__line">
          <code className="reflog-panel__selector">{entry.selector}</code>
          <code className="reflog-panel__oid" title={entry.oid}>
            {entry.abbreviatedOid}
          </code>
          <Badge type="neutral">{entry.action}</Badge>
        </span>
        {entry.subject ? (
          <span className="reflog-panel__subject" title={entry.subject}>
            {entry.subject}
          </span>
        ) : null}
        <span className="reflog-panel__meta">{formatMovedAt(entry.movedAt)}</span>
      </div>
      {!readOnly ? (
        <div className="reflog-panel__item-actions">
          <Button variant="ghost" disabled={busy} onClick={onReset}>
            Reset here…
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The reflog of HEAD — the undo trail for a bad reset, rebase, or merge. Read-only
 * apart from "Reset here…", which routes through the same gated store action as the
 * History panel's context menu.
 */
export function ReflogPanel({ projectId, snapshot, readOnly }: Props): ReactElement {
  const reflog = useGitStore((s) => s.reflog);
  const reflogLoading = useGitStore((s) => s.reflogLoading);
  const reflogError = useGitStore((s) => s.reflogError);
  const reflogHasMore = useGitStore((s) => s.reflogHasMore);
  const loadReflog = useGitStore((s) => s.loadReflog);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);

  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);

  const revision = snapshot?.revision;
  const busy = Boolean(operation);

  return (
    <section className="reflog-panel" aria-label="Reflog">
      <header className="reflog-panel__header">
        <div>
          <h2>Reflog</h2>
          <p className="reflog-panel__hint">
            Every move of HEAD, newest first. Reset back to any entry to undo a reset,
            rebase, or merge.
          </p>
        </div>
        <div className="reflog-panel__actions">
          <Button variant="ghost" onClick={() => void loadReflog(projectId)}>
            Refresh
          </Button>
        </div>
      </header>

      {reflogError ? (
        <PanelError
          title="Could not load the reflog"
          message={reflogError.message}
          onRetry={() => void loadReflog(projectId)}
        />
      ) : null}

      {reflogLoading && reflog.length === 0 ? (
        <div className="reflog-panel__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width="100%" height="var(--size-hub-row)" />
          ))}
        </div>
      ) : reflog.length === 0 ? (
        reflogError ? null : (
          <EmptyState
            title="No reflog entries"
            description="HEAD has not moved yet in this repository, so there is nothing to undo."
          />
        )
      ) : (
        <>
          <ul
            className={`reflog-panel__list ${reflogLoading ? 'git-stale' : ''}`}
            aria-busy={reflogLoading}
          >
            {reflog.map((entry) => (
              <ReflogRow
                key={entry.selector}
                entry={entry}
                readOnly={readOnly}
                busy={busy}
                onReset={() =>
                  setResetTarget({
                    oid: entry.oid,
                    abbreviatedOid: entry.abbreviatedOid,
                    label: entry.subject || entry.action,
                  })
                }
              />
            ))}
          </ul>
          {reflogHasMore ? (
            <div className="reflog-panel__more">
              <Button
                variant="secondary"
                loading={reflogLoading}
                onClick={() => void loadReflog(projectId, true)}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}

      <ResetCommitDialog
        projectId={projectId}
        revision={revision}
        target={resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </section>
  );
}
