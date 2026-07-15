import type { ReactElement } from 'react';
import type { SubmoduleEntry } from '@shared/contracts/advanced';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { EmptyState } from '@renderer/components/EmptyState';
import { Skeleton } from '@renderer/components/Skeleton';
import './SubmodulesPanel.css';

type Props = {
  projectId: string;
  snapshot?: RepositorySnapshot;
  readOnly: boolean;
};

function SubmoduleRow({
  entry,
  readOnly,
  busy,
  onInit,
  onUpdate,
}: {
  entry: SubmoduleEntry;
  projectId: string;
  revision: string;
  readOnly: boolean;
  busy: boolean;
  onInit: () => void;
  onUpdate: () => void;
}): ReactElement {
  const canAct = !readOnly && Boolean(entry.expectedOid);

  return (
    <li className="submodules-panel__item">
      <div className="submodules-panel__copy">
        <span className="submodules-panel__path" title={entry.path}>
          {entry.path}
        </span>
        <span className="submodules-panel__meta">
          {entry.initialized ? 'initialized' : 'not initialized'}
          {entry.dirty ? ' · dirty' : ''}
          {entry.url ? ` · ${entry.url}` : ''}
        </span>
        <span className="submodules-panel__oids">
          {entry.expectedOid ? `expected ${entry.expectedOid.slice(0, 7)}` : 'no expected oid'}
          {entry.checkedOutOid ? ` · checked out ${entry.checkedOutOid.slice(0, 7)}` : ''}
        </span>
      </div>
      {canAct ? (
        <div className="submodules-panel__item-actions">
          {!entry.initialized ? (
            <Button variant="ghost" disabled={busy} onClick={onInit}>
              Init
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy} onClick={onUpdate}>
            Update
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function SubmodulesPanel({ projectId, snapshot, readOnly }: Props): ReactElement {
  const submodules = useGitStore((s) => s.submodules);
  const submodulesLoading = useGitStore((s) => s.submodulesLoading);
  const loadSubmodules = useGitStore((s) => s.loadSubmodules);
  const submoduleInit = useGitStore((s) => s.submoduleInit);
  const submoduleUpdate = useGitStore((s) => s.submoduleUpdate);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);

  const revision = snapshot?.revision;
  const busy = Boolean(operation);

  return (
    <section className="submodules-panel" aria-label="Submodules">
      <header className="submodules-panel__header">
        <h2>Submodules</h2>
        <Button variant="ghost" onClick={() => loadSubmodules(projectId)}>
          Refresh
        </Button>
      </header>

      {submodulesLoading ? (
        <div className="submodules-panel__loading">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width="100%" height="40px" />
          ))}
        </div>
      ) : submodules.length === 0 ? (
        <EmptyState
          title="No submodules"
          description="This repository does not declare any Git submodules."
        />
      ) : (
        <ul className="submodules-panel__list">
          {submodules.map((entry) =>
            revision ? (
              <SubmoduleRow
                key={entry.path}
                entry={entry}
                projectId={projectId}
                revision={revision}
                readOnly={readOnly}
                busy={busy}
                onInit={() => submoduleInit(projectId, revision, entry.path)}
                onUpdate={() => submoduleUpdate(projectId, revision, entry.path)}
              />
            ) : null
          )}
        </ul>
      )}
    </section>
  );
}
