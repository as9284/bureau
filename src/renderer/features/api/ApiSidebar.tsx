import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextField } from '@renderer/components/TextField';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  SearchIcon,
} from '@renderer/components/icons';
import { copyText } from '@renderer/lib/contextMenu';
import { useAppStore } from '@renderer/store/appStore';
import type { ContextMenuItem } from '@renderer/store/appStore';
import {
  auxId,
  selectActiveApiSnapshot,
  selectCollectionTree,
  useApiStore,
  type ApiSidebarMode,
  type HistoryState,
} from '@renderer/store/apiStore';
import type {
  ApiCollectionNode,
  ApiCookie,
  ApiCookieJarSummary,
  ApiRequestDefinition,
  ApiWorkspaceSnapshot,
} from '@shared/contracts/apiWorkbench';
import type { ApiSecretSummary } from '@shared/contracts/apiWorkbench';
import type { TrackedProject } from '@shared/contracts/projects';
import {
  buildCollectionBackgroundMenuItems,
  buildCollectionMenuItems,
  buildCookieMenuItems,
  buildEnvironmentMenuItems,
  buildHistoryMenuItems,
  buildSecretMenuItems,
  copyRequestAsCurl,
} from './apiContextMenu';
import { ApiRail } from './ApiRail';
import { API_RAIL_SECTIONS } from './apiSections';
import { methodTone, requestBadge } from './apiFormat';

type Props = {
  mode: ApiSidebarMode;
  snapshot: ApiWorkspaceSnapshot | null;
  snapshotLoadState: 'idle' | 'loading' | 'ready' | 'error';
  history: HistoryState;
  projects: TrackedProject[];
  secrets: ApiSecretSummary[];
  cookieJars: ApiCookieJarSummary[];
  activeCookieJarId: string;
  cookies: ApiCookie[];
  cookiesLoading: boolean;
  relinkPickerOpen: boolean;
  onModeChange(mode: ApiSidebarMode): void;
  onOpenRequest(requestId: string): void;
  onCreateFolder(): void;
  onCreateRequest(): void;
  onCreateEnvironment(): void;
  onDeleteEnvironment(environmentId: string): void;
  onOpenEnvironment(environmentId: string): void;
  onOpenSecrets(): void;
  onOpenCookies(): void;
  onDeleteSecret(secretId: string): void;
  onSelectCookieJar(jarId: string): void;
  onRefreshCookies(): void;
  onEditCookie(cookie: ApiCookie | null): void;
  onDeleteCookie(cookie: ApiCookie): void;
  onRelink(projectId: string): void;
  onRemoveLink(): void;
  onSetRelinkPickerOpen(open: boolean): void;
  onRetrySnapshot(): void;
  onRetryHistory(): void;
};

export function ApiSidebar({
  mode,
  snapshot,
  snapshotLoadState,
  history,
  projects,
  secrets,
  cookieJars,
  activeCookieJarId,
  cookies,
  cookiesLoading,
  relinkPickerOpen,
  onModeChange,
  onOpenRequest,
  onCreateFolder,
  onCreateRequest,
  onCreateEnvironment,
  onDeleteEnvironment,
  onOpenEnvironment,
  onOpenSecrets,
  onOpenCookies,
  onDeleteSecret,
  onSelectCookieJar,
  onRefreshCookies,
  onEditCookie,
  onDeleteCookie,
  onRelink,
  onRemoveLink,
  onSetRelinkPickerOpen,
  onRetrySnapshot,
  onRetryHistory,
}: Props) {
  const section = API_RAIL_SECTIONS.find((entry) => entry.id === mode) ?? API_RAIL_SECTIONS[0];

  const counts: Record<ApiSidebarMode, number | null> = {
    collections: snapshot?.requests.length ?? null,
    history: history.loadState === 'ready' ? history.items.length : null,
    environments: snapshot?.environments.length ?? null,
    secrets: secrets.length,
    cookies: cookies.length,
  };

  return (
    <div className="api-sidebar">
      <ApiRail mode={mode} counts={counts} onSelect={onModeChange} />

      <div className="api-sidebar__panel" id="api-sidebar-panel" aria-label={section.label} role="group">
        <header className="api-sidebar__panel-header">
          <div className="api-sidebar__panel-heading">
            <h2 className="api-sidebar__panel-title">{section.label}</h2>
            <p className="api-sidebar__panel-hint">{section.hint}</p>
          </div>
          <div className="api-sidebar__panel-actions">
            {mode === 'collections' ? (
              <>
                <Button size="compact" variant="quiet" onClick={onCreateFolder}>
                  New folder
                </Button>
                <Button size="compact" variant="secondary" onClick={onCreateRequest}>
                  New request
                </Button>
              </>
            ) : null}
            {mode === 'history' ? (
              <Button size="compact" variant="quiet" onClick={onRetryHistory}>
                Refresh
              </Button>
            ) : null}
            {mode === 'environments' ? (
              <Button size="compact" variant="secondary" onClick={onCreateEnvironment}>
                New environment
              </Button>
            ) : null}
            {mode === 'secrets' ? (
              <Button size="compact" variant="secondary" onClick={onOpenSecrets}>
                Manage
              </Button>
            ) : null}
            {mode === 'cookies' ? (
              <>
                <Button size="compact" variant="quiet" onClick={onRefreshCookies}>
                  Refresh
                </Button>
                <Button size="compact" variant="secondary" onClick={onOpenCookies}>
                  Manage
                </Button>
              </>
            ) : null}
          </div>
        </header>

        {snapshot?.linkedProjectStale ? (
          <div className="api-sidebar__banner" role="alert">
            <strong>Linked project missing</strong>
            <p>The linked Bureau project was removed or cannot be found.</p>
            <div className="api-sidebar__banner-actions">
              <Button size="compact" variant="secondary" onClick={() => onSetRelinkPickerOpen(true)}>
                Relink
              </Button>
              <Button size="compact" variant="ghost" onClick={onRemoveLink}>
                Remove link
              </Button>
            </div>
            {relinkPickerOpen ? (
              <div className="api-sidebar__relink">
                <Dropdown
                  label="Choose project"
                  value=""
                  placeholder="Select a project"
                  options={projects.map((project) => ({
                    value: project.projectId,
                    label: project.name,
                  }))}
                  onChange={onRelink}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="api-sidebar__panel-body">
          {mode === 'collections' ? (
            <CollectionsPane
              snapshot={snapshot}
              loadState={snapshotLoadState}
              onOpenRequest={onOpenRequest}
              onCreateFolder={onCreateFolder}
              onCreateRequest={onCreateRequest}
              onRetry={onRetrySnapshot}
            />
          ) : null}
          {mode === 'history' ? (
            <HistoryPane history={history} onOpenRequest={onOpenRequest} onRetry={onRetryHistory} />
          ) : null}
          {mode === 'environments' ? (
            <EnvironmentsPane
              snapshot={snapshot}
              loadState={snapshotLoadState}
              onOpenEnvironment={onOpenEnvironment}
              onDeleteEnvironment={onDeleteEnvironment}
              onCreateEnvironment={onCreateEnvironment}
              onRetry={onRetrySnapshot}
            />
          ) : null}
          {mode === 'secrets' ? (
            <SecretsListPane
              secrets={secrets}
              onOpen={onOpenSecrets}
              onDeleteSecret={onDeleteSecret}
            />
          ) : null}
          {mode === 'cookies' ? (
            <CookiesListPane
              jars={cookieJars}
              activeJarId={activeCookieJarId}
              cookies={cookies}
              loading={cookiesLoading}
              onSelectJar={onSelectCookieJar}
              onOpen={onOpenCookies}
              onRefresh={onRefreshCookies}
              onEditCookie={onEditCookie}
              onDeleteCookie={onDeleteCookie}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The filter field shared by the Collections and History panes. */
function FilterField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange(next: string): void;
}) {
  return (
    <div className="api-sidebar__filter">
      <span className="api-sidebar__filter-icon" aria-hidden="true">
        <SearchIcon size={14} />
      </span>
      <TextField
        id={id}
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Stable identity so the tree memos do not recompute on every render before a snapshot lands. */
const EMPTY_COLLECTIONS: ApiCollectionNode[] = [];

function isInteractiveContextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, button, [role="checkbox"]'));
}

/**
 * Right-clicking the empty space of a pane offers that pane's create actions. Rows stop the event
 * themselves, so this only fires on the background.
 */
function openPaneBackgroundMenu(
  event: ReactMouseEvent,
  openContextMenu: (menu: { x: number; y: number; items: ContextMenuItem[] }) => void,
  items: ContextMenuItem[]
): void {
  if (isInteractiveContextTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  openContextMenu({ x: event.clientX, y: event.clientY, items });
}

/** `GET /v1/users` and `users` both find a request named "List users". */
function requestMatches(
  filter: string,
  name: string,
  request: ApiRequestDefinition | undefined
): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [name, request?.method ?? '', request?.urlTemplate ?? '', request?.protocol ?? '']
    .join(' ')
    .toLowerCase();
  return needle.split(/\s+/).every((term) => haystack.includes(term));
}

function CollectionsPane({
  snapshot,
  loadState,
  onOpenRequest,
  onCreateFolder,
  onCreateRequest,
  onRetry,
}: {
  snapshot: ApiWorkspaceSnapshot | null;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  onOpenRequest(requestId: string): void;
  onCreateFolder(): void;
  onCreateRequest(): void;
  onRetry(): void;
}) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const activeWorkspaceId = useApiStore((s) => s.activeWorkspaceId);
  const storedExpandedCollectionIds = useApiStore((s) =>
    activeWorkspaceId ? s.expandedCollectionIdsByWorkspace[activeWorkspaceId] : undefined
  );
  const documents = useApiStore((s) => s.documents);
  const activeRequestId = useApiStore((s) => s.activeRequestId);
  const createCollection = useApiStore((s) => s.createCollection);
  const updateCollection = useApiStore((s) => s.updateCollection);
  const duplicateCollection = useApiStore((s) => s.duplicateCollection);
  const deleteCollection = useApiStore((s) => s.deleteCollection);
  const setCollectionExpanded = useApiStore((s) => s.setCollectionExpanded);
  const gateApiConfirm = useApiStore((s) => s.gateApiConfirm);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [renameTarget, setRenameTarget] = useState<(ApiCollectionNode & { depth?: number }) | null>(null);
  const [filter, setFilter] = useState('');

  const collections = snapshot?.collections ?? EMPTY_COLLECTIONS;
  const requestsById = useMemo(() => {
    const map = new Map<string, ApiRequestDefinition>();
    for (const request of snapshot?.requests ?? []) map.set(request.requestId, request);
    return map;
  }, [snapshot?.requests]);

  const tree = useMemo(
    () => selectCollectionTree(collections, storedExpandedCollectionIds),
    [collections, storedExpandedCollectionIds]
  );

  /** While filtering the tree flattens to matching requests; a folder path replaces the URL line. */
  const filtered = useMemo(() => {
    if (!filter.trim()) return null;
    const byId = new Map(collections.map((node) => [node.collectionId, node]));
    const folderPath = (node: ApiCollectionNode): string => {
      const parts: string[] = [];
      let parent = node.parentId ? byId.get(node.parentId) : undefined;
      while (parent) {
        parts.unshift(parent.name);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return parts.join(' / ');
    };
    return collections
      .filter((node) => node.kind === 'request')
      .filter((node) => requestMatches(filter, node.name, node.requestId ? requestsById.get(node.requestId) : undefined))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((node) => ({ node, path: folderPath(node) }));
  }, [collections, filter, requestsById]);

  if (loadState === 'loading' || loadState === 'idle') {
    return <div className="tab-loading" role="status">Loading collections…</div>;
  }
  if (loadState === 'error') {
    return (
      <div className="api-pane-error" role="alert">
        <p>Could not load collections.</p>
        <Button size="compact" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  const openRowMenu = (event: ReactMouseEvent, node: ApiCollectionNode & { depth?: number }): void => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildCollectionMenuItems(node, {
        open: () => {
          if (node.kind === 'request' && node.requestId) onOpenRequest(node.requestId);
        },
        createFolder: () =>
          void createCollection({
            parentId: node.collectionId,
            kind: 'folder',
            name: 'New folder',
          }),
        createRequest: () =>
          void createCollection({
            parentId: node.collectionId,
            kind: 'request',
            name: 'New request',
          }),
        rename: () => setRenameTarget(node),
        duplicate: () => void duplicateCollection(node.collectionId),
        copyAsCurl: () => {
          if (!activeWorkspaceId || !node.requestId) return;
          void copyRequestAsCurl(activeWorkspaceId, node.requestId);
        },
        copyId: () => copyText(node.kind === 'request' ? (node.requestId ?? node.collectionId) : node.collectionId),
        remove: () => {
          const isFolder = node.kind === 'folder';
          gateApiConfirm({
            title: `Delete “${node.name}”?`,
            description: isFolder
              ? 'The folder and everything inside it are removed from this workspace.'
              : 'The request and its saved definition are removed from this workspace.',
            confirmLabel: isFolder ? 'Delete folder' : 'Delete request',
            danger: true,
            run: () => deleteCollection(node.collectionId),
          });
        },
      }),
    });
  };

  const requestRowContent = (node: ApiCollectionNode, secondary: string): ReactNode => {
    const request = node.requestId ? requestsById.get(node.requestId) : undefined;
    const badge = request ? requestBadge(request) : 'REQ';
    const document = node.requestId ? documents[node.requestId] : undefined;
    return (
      <>
        <span className={`api-method-badge api-method-badge--${methodTone(request?.method ?? '')} mono`}>
          {badge}
        </span>
        <span className="api-tree__copy">
          <span className="api-tree__name">{node.name}</span>
          {secondary ? <span className="api-tree__secondary mono">{secondary}</span> : null}
        </span>
        {document?.dirty ? (
          <span className="api-tree__dirty" title="Unsaved changes">
            <span aria-hidden="true">●</span>
            <span className="bureau-visually-hidden">Unsaved changes</span>
          </span>
        ) : null}
      </>
    );
  };

  const backgroundMenu = (event: ReactMouseEvent): void => {
    if ((event.target as HTMLElement).closest('.api-tree__row')) return;
    event.preventDefault();
    event.stopPropagation();
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildCollectionBackgroundMenuItems({
        createFolder: onCreateFolder,
        createRequest: onCreateRequest,
      }),
    });
  };

  return (
    <>
      <FilterField
        id="api-collections-filter"
        label="Filter requests"
        value={filter}
        onChange={setFilter}
      />

      <div className="api-tree" role="tree" aria-label="API collections" onContextMenu={backgroundMenu}>
        {filtered ? (
          filtered.length === 0 ? (
            <div className="api-pane-empty">No request matches “{filter.trim()}”.</div>
          ) : (
            filtered.map(({ node, path }) => (
              <div
                key={node.collectionId}
                role="treeitem"
                aria-level={1}
                aria-selected={activeRequestId === node.requestId}
                className={`api-tree__row api-tree__row--request${activeRequestId === node.requestId ? ' is-active' : ''}`}
                tabIndex={0}
                onClick={() => {
                  if (node.requestId) onOpenRequest(node.requestId);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  // Ctrl+Enter is the workspace's send shortcut; swallowing it here would make the
                  // shortcut dead whenever the tree happens to hold focus.
                  if (event.ctrlKey || event.metaKey) return;
                  event.preventDefault();
                  if (node.requestId) onOpenRequest(node.requestId);
                }}
                onContextMenu={(event) => openRowMenu(event, node)}
              >
                {requestRowContent(node, path)}
              </div>
            ))
          )
        ) : tree.length === 0 ? (
          <div className="api-pane-empty">
            <p>Nothing here yet. A request is the smallest useful thing to start with.</p>
            <div className="api-pane-empty__actions">
              <Button size="compact" variant="secondary" onClick={onCreateRequest}>
                New request
              </Button>
              <Button size="compact" variant="quiet" onClick={onCreateFolder}>
                New folder
              </Button>
            </div>
          </div>
        ) : (
          tree.map((node, index) => {
            const request = node.requestId ? requestsById.get(node.requestId) : undefined;
            const isActive = node.kind === 'request' && activeRequestId === node.requestId;
            return (
              <div
                key={node.collectionId}
                role="treeitem"
                className={`api-tree__row api-tree__row--${node.kind}${isActive ? ' is-active' : ''}`}
                style={{ paddingLeft: `calc(var(--space-1) + ${node.depth} * var(--space-4))` }}
                aria-level={node.depth + 1}
                aria-expanded={node.kind === 'folder' && node.hasChildren ? node.expanded : undefined}
                aria-selected={node.kind === 'request' ? isActive : undefined}
                tabIndex={0}
                ref={(element) => {
                  rowRefs.current[node.collectionId] = element;
                }}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('button')) return;
                  if (node.kind === 'folder') {
                    setCollectionExpanded(node.collectionId, !node.expanded);
                  } else if (node.requestId) {
                    onOpenRequest(node.requestId);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const nextIndex = index + (event.key === 'ArrowDown' ? 1 : -1);
                    const nextRow = tree[nextIndex];
                    if (nextRow) rowRefs.current[nextRow.collectionId]?.focus();
                    return;
                  }
                  if (event.key === 'ArrowRight' && node.kind === 'folder' && node.hasChildren) {
                    event.preventDefault();
                    if (!node.expanded) setCollectionExpanded(node.collectionId, true);
                    else {
                      const firstChild = tree[index + 1];
                      if (firstChild) rowRefs.current[firstChild.collectionId]?.focus();
                    }
                    return;
                  }
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    if (node.kind === 'folder' && node.hasChildren && node.expanded) {
                      setCollectionExpanded(node.collectionId, false);
                    } else if (node.parentId) {
                      rowRefs.current[node.parentId]?.focus();
                    }
                    return;
                  }
                  if (event.key === 'Enter' || event.key === ' ') {
                    // See the filtered rows above: Ctrl+Enter belongs to the composer, not the tree.
                    if (event.ctrlKey || event.metaKey) return;
                    event.preventDefault();
                    if (node.kind === 'folder') setCollectionExpanded(node.collectionId, !node.expanded);
                    else if (node.requestId) onOpenRequest(node.requestId);
                  }
                }}
                onContextMenu={(event) => openRowMenu(event, node)}
              >
                {node.kind === 'folder' ? (
                  <>
                    <button
                      type="button"
                      className="api-tree__disclosure"
                      aria-label={`${node.expanded ? 'Collapse' : 'Expand'} ${node.name}`}
                      tabIndex={-1}
                      disabled={!node.hasChildren}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (node.hasChildren) setCollectionExpanded(node.collectionId, !node.expanded);
                      }}
                    >
                      {node.hasChildren ? (
                        node.expanded ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />
                      ) : null}
                    </button>
                    <span className="api-tree__icon" aria-hidden="true">
                      <FolderIcon size={15} />
                    </span>
                    <span className="api-tree__copy">
                      <span className="api-tree__name">{node.name}</span>
                    </span>
                  </>
                ) : (
                  requestRowContent(node, request?.urlTemplate ?? '')
                )}
              </div>
            );
          })
        )}
      </div>

      {renameTarget ? (
        <RenameCollectionDialog
          key={renameTarget.collectionId}
          node={renameTarget}
          onCancel={() => setRenameTarget(null)}
          onSave={(name) => {
            setRenameTarget(null);
            void updateCollection(renameTarget.collectionId, { name });
          }}
        />
      ) : null}
    </>
  );
}

function RenameCollectionDialog({
  node,
  onCancel,
  onSave,
}: {
  node: ApiCollectionNode;
  onCancel(): void;
  onSave(name: string): void;
}) {
  const [name, setName] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const canSave = Boolean(trimmed) && trimmed !== node.name;
  const save = (): void => {
    if (canSave) onSave(trimmed);
  };

  return (
    <Dialog
      open
      title={`Rename ${node.kind === 'folder' ? 'folder' : 'request'}`}
      initialFocusRef={inputRef}
      onClose={onCancel}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={save}>
            Rename
          </Button>
        </>
      }
    >
      <div className="api-dialog__field">
        <label className="api-field-label" htmlFor="api-collection-rename">
          Name
        </label>
        <TextField
          ref={inputRef}
          id="api-collection-rename"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            save();
          }}
        />
      </div>
    </Dialog>
  );
}

function HistoryPane({
  history,
  onOpenRequest,
  onRetry,
}: {
  history: HistoryState;
  onOpenRequest(requestId: string): void;
  onRetry(): void;
}) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const workspaceId = useApiStore((s) => s.activeWorkspaceId);
  const [filter, setFilter] = useState('');

  const items = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return history.items;
    return history.items.filter((entry) =>
      `${entry.method} ${entry.url} ${entry.status ?? ''}`.toLowerCase().includes(needle)
    );
  }, [filter, history.items]);

  if (history.loadState === 'loading' || history.loadState === 'idle') {
    return <div className="tab-loading" role="status">Loading history…</div>;
  }
  if (history.loadState === 'error') {
    return (
      <div className="api-pane-error" role="alert">
        <p>Could not load history.</p>
        <Button size="compact" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  return (
    <>
      <FilterField id="api-history-filter" label="Filter history" value={filter} onChange={setFilter} />
      <div
        className="api-history-list"
        onContextMenu={(event) =>
          openPaneBackgroundMenu(event, openContextMenu, [
            { type: 'item', label: 'Refresh', onSelect: onRetry },
          ])
        }
      >
        {history.items.length === 0 ? (
          <div className="api-pane-empty">
            <p>No requests sent yet. Every send lands here with its status and timing.</p>
          </div>
        ) : items.length === 0 ? (
          <div className="api-pane-empty">No entry matches “{filter.trim()}”.</div>
        ) : (
          items.map((entry) => (
            <button
              key={entry.historyId}
              type="button"
              className="api-history-list__row"
              onClick={() => {
                if (entry.requestId) onOpenRequest(entry.requestId);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  items: buildHistoryMenuItems(entry, {
                    open: () => {
                      if (entry.requestId) onOpenRequest(entry.requestId);
                    },
                    copyUrl: () => copyText(entry.url),
                    copyAsCurl: () => {
                      if (!workspaceId || !entry.requestId) return;
                      void copyRequestAsCurl(workspaceId, entry.requestId);
                    },
                    refresh: onRetry,
                  }),
                });
              }}
            >
              <span className={`api-method-badge api-method-badge--${methodTone(entry.method)} mono`}>
                {entry.method}
              </span>
              <span className="api-tree__copy">
                <span className="api-history-list__url mono">{entry.url}</span>
                <span className="api-history-list__meta mono">
                  {entry.status ?? '—'}
                  {entry.totalMs != null ? ` · ${entry.totalMs} ms` : ''}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

function EnvironmentsPane({
  snapshot,
  loadState,
  onOpenEnvironment,
  onDeleteEnvironment,
  onCreateEnvironment,
  onRetry,
}: {
  snapshot: ApiWorkspaceSnapshot | null;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  onOpenEnvironment(environmentId: string): void;
  onDeleteEnvironment(environmentId: string): void;
  onCreateEnvironment(): void;
  onRetry(): void;
}) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const activeEnvironmentId = useApiStore((s) => s.activeEnvironmentId);
  const activeAuxId = useApiStore((s) => s.activeAuxId);
  const setActiveEnvironment = useApiStore((s) => s.setActiveEnvironment);
  const createEnvironment = useApiStore((s) => s.createEnvironment);
  const updateEnvironment = useApiStore((s) => s.updateEnvironment);

  if (loadState === 'loading' || loadState === 'idle') {
    return <div className="tab-loading" role="status">Loading environments…</div>;
  }
  if (loadState === 'error') {
    return (
      <div className="api-pane-error" role="alert">
        <p>Could not load environments.</p>
        <Button size="compact" onClick={onRetry}>Retry</Button>
      </div>
    );
  }

  const environments = snapshot?.environments ?? [];

  if (environments.length === 0) {
    return (
      <div className="api-pane-empty">
        <p>No environments yet.</p>
        <Button size="compact" variant="secondary" onClick={onCreateEnvironment}>
          New environment
        </Button>
      </div>
    );
  }

  return (
    <div
      className="api-entity-list"
      onContextMenu={(event) =>
        openPaneBackgroundMenu(event, openContextMenu, [
          { type: 'item', label: 'New environment', onSelect: onCreateEnvironment },
        ])
      }
    >
      {environments.map((environment) => {
        const isActive = activeEnvironmentId === environment.environmentId;
        const isOpen = activeAuxId === auxId({ kind: 'environment', environmentId: environment.environmentId });
        return (
          <div
            key={environment.environmentId}
            className={`api-entity-row${isOpen ? ' is-selected' : ''}`}
            aria-current={isOpen ? 'true' : undefined}
            onContextMenu={(event) => {
              // The row is a button end to end, so it cannot skip interactive targets the way the
              // collection tree does — that would swallow every right-click on the row.
              event.preventDefault();
              event.stopPropagation();
              openContextMenu({
                x: event.clientX,
                y: event.clientY,
                items: buildEnvironmentMenuItems(
                  environment,
                  { isActive },
                  {
                    setActive: () => setActiveEnvironment(environment.environmentId),
                    duplicate: () => {
                      void (async () => {
                        const copyName = `${environment.name} copy`;
                        await createEnvironment(copyName);
                        const nextSnapshot = selectActiveApiSnapshot(useApiStore.getState());
                        const created = nextSnapshot?.environments
                          .filter((item) => item.name === copyName)
                          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
                        if (!created || environment.variables.length === 0) return;
                        await updateEnvironment(created.environmentId, {
                          variables: environment.variables.map((variable) => ({
                            ...structuredClone(variable),
                            variableId: crypto.randomUUID(),
                          })),
                        });
                      })();
                    },
                    remove: () => onDeleteEnvironment(environment.environmentId),
                  }
                ),
              });
            }}
          >
            <button
              type="button"
              className="api-entity-row__open"
              onClick={() => onOpenEnvironment(environment.environmentId)}
            >
              <span className="api-entity-row__name">{environment.name}</span>
              <span className="api-entity-row__meta mono">
                {environment.variables.length}{' '}
                {environment.variables.length === 1 ? 'variable' : 'variables'}
                {isActive ? ' · active' : ''}
              </span>
            </button>
            <Button
              size="compact"
              variant={isActive ? 'secondary' : 'quiet'}
              aria-pressed={isActive}
              onClick={() => setActiveEnvironment(isActive ? null : environment.environmentId)}
            >
              {isActive ? 'Active' : 'Use'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function SecretsListPane({
  secrets,
  onOpen,
  onDeleteSecret,
}: {
  secrets: ApiSecretSummary[];
  onOpen(): void;
  onDeleteSecret(secretId: string): void;
}) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  const gateApiConfirm = useApiStore((s) => s.gateApiConfirm);

  if (secrets.length === 0) {
    return (
      <div className="api-pane-empty">
        <p>No secrets yet. Values are write-only — Bureau never shows one again after it is saved.</p>
        <Button size="compact" variant="secondary" onClick={onOpen}>
          Add a secret
        </Button>
      </div>
    );
  }
  return (
    <div
      className="api-entity-list"
      onContextMenu={(event) =>
        openPaneBackgroundMenu(event, openContextMenu, [
          { type: 'item', label: 'Manage secrets', onSelect: onOpen },
        ])
      }
    >
      {secrets.map((secret) => (
        <div
          key={secret.secretId}
          className="api-entity-row"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            openContextMenu({
              x: event.clientX,
              y: event.clientY,
              items: buildSecretMenuItems(secret, {
                copyLabel: () => copyText(secret.label),
                // Deleting a secret breaks every request bound to it, so it is confirmed the same
                // way the editor's inline confirm does.
                remove: () =>
                  gateApiConfirm({
                    title: `Delete secret “${secret.label}”?`,
                    description:
                      'Any request or variable bound to this secret stops resolving. The value cannot be recovered.',
                    confirmLabel: 'Delete secret',
                    danger: true,
                    run: () => onDeleteSecret(secret.secretId),
                  }),
              }),
            });
          }}
        >
          <button type="button" className="api-entity-row__open" onClick={onOpen}>
            <span className="api-entity-row__name">{secret.label}</span>
            <span className="api-entity-row__meta mono">
              {secret.persisted ? 'encrypted on disk' : 'session only'}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

function CookiesListPane({
  jars,
  activeJarId,
  cookies,
  loading,
  onSelectJar,
  onOpen,
  onRefresh,
  onEditCookie,
  onDeleteCookie,
}: {
  jars: ApiCookieJarSummary[];
  activeJarId: string;
  cookies: ApiCookie[];
  loading: boolean;
  onSelectJar(jarId: string): void;
  onOpen(): void;
  onRefresh(): void;
  onEditCookie(cookie: ApiCookie | null): void;
  onDeleteCookie(cookie: ApiCookie): void;
}) {
  const openContextMenu = useAppStore((s) => s.openContextMenu);
  return (
    <>
      <div className="api-sidebar__filter api-sidebar__filter--control">
        <Dropdown
          label="Jar"
          value={activeJarId}
          options={
            jars.length > 0
              ? jars.map((jar) => ({ value: jar.jarId, label: `${jar.name} (${jar.cookieCount})` }))
              : [{ value: '', label: 'Default (0)' }]
          }
          onChange={onSelectJar}
        />
      </div>
      {loading ? (
        <div className="tab-loading" role="status">Reading cookies…</div>
      ) : cookies.length === 0 ? (
        <div className="api-pane-empty">
          <p>No cookies in this jar. Responses that set cookies will appear here.</p>
        </div>
      ) : (
        <div
          className="api-entity-list"
          onContextMenu={(event) =>
            openPaneBackgroundMenu(event, openContextMenu, [
              { type: 'item', label: 'Add cookie', onSelect: () => onEditCookie(null) },
              { type: 'item', label: 'Refresh', onSelect: onRefresh },
              { type: 'item', label: 'Manage cookies', onSelect: onOpen },
            ])
          }
        >
          {cookies.map((cookie) => (
            <div
              key={`${cookie.name}:${cookie.domain}:${cookie.path}`}
              className="api-entity-row"
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  items: buildCookieMenuItems(cookie, {
                    edit: () => onEditCookie(cookie),
                    copyName: () => copyText(cookie.name),
                    copyValue: () => copyText(cookie.value),
                    remove: () => onDeleteCookie(cookie),
                  }),
                });
              }}
            >
              <button type="button" className="api-entity-row__open" onClick={onOpen}>
                <span className="api-entity-row__name mono">{cookie.name}</span>
                <span className="api-entity-row__meta mono">
                  {cookie.hostOnly ? '' : '.'}
                  {cookie.domain}
                  {cookie.path}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
