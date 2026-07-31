import type { MouseEvent as ReactMouseEvent } from 'react';
import { useAppStore } from '@renderer/store/appStore';
import {
  selectActiveApiSnapshot,
  useApiStore,
  type ApiRequestDocument,
  type ApiSessionState,
} from '@renderer/store/apiStore';
import { buildDocumentTabMenuItems, copyRequestAsCurl } from './apiContextMenu';

/** A non-request tab: environments, secrets and cookies open beside requests, not over them. */
export type AuxTab = { id: string; title: string };

type Props = {
  openDocumentIds: string[];
  documents: Record<string, ApiRequestDocument>;
  activeRequestId: string | null;
  auxTabs: AuxTab[];
  activeAuxId: string | null;
  sessions: Record<string, ApiSessionState>;
  onSelect(requestId: string): void;
  onClose(requestId: string): void;
  onSelectAux(id: string): void;
  onCloseAux(id: string): void;
};

/** Status word shown beside a tab. Text, not colour alone — the dot is decorative. */
function tabStatus(
  requestId: string,
  sessions: Record<string, ApiSessionState>
): { label: string; modifier: string } | null {
  const session = Object.values(sessions).find((entry) => entry.requestId === requestId);
  if (!session) return null;
  if (session.streamStatus === 'open') return { label: 'live', modifier: 'streaming' };
  if (session.streamStatus === 'connecting') return { label: 'connecting', modifier: 'loading' };
  if (session.inFlight) return { label: 'sending', modifier: 'loading' };
  if (session.error) return { label: 'error', modifier: 'error' };
  return null;
}

export function ApiDocumentTabs({
  openDocumentIds,
  documents,
  activeRequestId,
  auxTabs,
  activeAuxId,
  sessions,
  onSelect,
  onClose,
  onSelectAux,
  onCloseAux,
}: Props) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const closeRequest = useApiStore((s) => s.closeRequest);
  const openRequest = useApiStore((s) => s.openRequest);
  const saveRequest = useApiStore((s) => s.saveRequest);
  const deleteCollection = useApiStore((s) => s.deleteCollection);
  const gateApiConfirm = useApiStore((s) => s.gateApiConfirm);

  /** Closing a clean tab is instant; only unsaved work is worth interrupting for. */
  const closeWithGuard = (requestId: string): void => {
    const document = documents[requestId];
    if (!document?.dirty) {
      onClose(requestId);
      return;
    }
    gateApiConfirm({
      title: 'Discard unsaved changes?',
      description: `“${document.draft.name || 'Untitled request'}” has edits that have not been saved.`,
      confirmLabel: 'Discard and close',
      danger: true,
      run: () => onClose(requestId),
    });
  };

  const closeManyWithGuard = (ids: string[]): void => {
    const dirty = ids.filter((id) => documents[id]?.dirty);
    const closeAll = (): void => {
      for (const id of ids) closeRequest(id);
    };
    if (dirty.length === 0) {
      closeAll();
      return;
    }
    gateApiConfirm({
      title: `Discard unsaved changes in ${dirty.length} request${dirty.length === 1 ? '' : 's'}?`,
      description: dirty
        .map((id) => documents[id]?.draft.name || 'Untitled request')
        .join(', '),
      confirmLabel: 'Discard and close',
      danger: true,
      run: closeAll,
    });
  };

  if (!openDocumentIds.length && !auxTabs.length) {
    return (
      <div className="api-document-tabs api-document-tabs--empty">
        <span className="api-pane-empty">Open a request from the collection tree.</span>
      </div>
    );
  }

  const openTabMenu = (event: ReactMouseEvent, requestId: string, document: ApiRequestDocument): void => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildDocumentTabMenuItems(
        {
          dirty: document.dirty,
          canCloseOthers: openDocumentIds.length > 1,
          canSave: document.dirty && !document.saving,
        },
        {
          close: () => closeWithGuard(requestId),
          // Bulk closes confirm once for however many drafts are dirty rather than once per tab —
          // a prompt per document is how people click "yes" without reading.
          closeOthers: () => closeManyWithGuard(openDocumentIds.filter((id) => id !== requestId)),
          closeAll: () => closeManyWithGuard([...openDocumentIds]),
          save: () => void saveRequest(requestId),
          discard: () => {
            // openRequest re-clones the saved definition and clears dirty.
            openRequest(requestId);
          },
          copyAsCurl: () => {
            void copyRequestAsCurl(document.workspaceId, requestId);
          },
          remove: () => {
            const snapshot = selectActiveApiSnapshot(useApiStore.getState());
            const request = snapshot?.requests.find((item) => item.requestId === requestId);
            const node = snapshot?.collections.find(
              (item) => item.requestId === requestId || item.collectionId === request?.collectionId
            );
            if (!node) return;
            const name = document.draft.name || 'Untitled request';
            gateApiConfirm({
              title: `Delete “${name}”?`,
              description: 'The request and its saved definition are removed from this workspace.',
              confirmLabel: 'Delete request',
              danger: true,
              run: () => deleteCollection(node.collectionId),
            });
          },
        }
      ),
    });
  };

  return (
    <div className="api-document-tabs" role="tablist" aria-label="Open requests">
      {openDocumentIds.map((requestId) => {
        const document = documents[requestId];
        if (!document) return null;
        const active = activeRequestId === requestId && !activeAuxId;
        const status = tabStatus(requestId, sessions);
        return (
          <div
            key={requestId}
            className={`api-document-tabs__tab${active ? ' is-active' : ''}`}
            onContextMenu={(event) => openTabMenu(event, requestId, document)}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="api-document-tabs__label"
              onClick={() => onSelect(requestId)}
            >
              {document.dirty ? <span className="api-document-tabs__dirty" aria-hidden="true">●</span> : null}
              <span>{document.draft.name || 'Untitled request'}</span>
              {status ? (
                <span className={`api-document-tabs__status api-document-tabs__status--${status.modifier}`}>
                  {status.label}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="api-document-tabs__close"
              aria-label={`Close ${document.draft.name || 'request'}`}
              onClick={() => closeWithGuard(requestId)}
            >
              ×
            </button>
          </div>
        );
      })}

      {auxTabs.map((tab) => {
        const active = activeAuxId === tab.id;
        return (
          <div
            key={tab.id}
            className={`api-document-tabs__tab api-document-tabs__tab--aux${active ? ' is-active' : ''}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="api-document-tabs__label"
              onClick={() => onSelectAux(tab.id)}
            >
              <span>{tab.title}</span>
            </button>
            <button
              type="button"
              className="api-document-tabs__close"
              aria-label={`Close ${tab.title}`}
              onClick={() => onCloseAux(tab.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
