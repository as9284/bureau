import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ApiWorkspaceSnapshot } from '@shared/contracts/apiWorkbench';
import { methodTone, requestBadge } from './apiFormat';

type Entry = {
  requestId: string;
  name: string;
  path: string;
  badge: string;
  method: string;
  url: string;
};

/**
 * Ctrl+P over the workspace's requests. The sidebar filter only reaches what the tree shows; this
 * reaches every request regardless of which section the rail is on, which is the point of a
 * quick-open. It reuses the app's palette chrome so it reads as the same mechanism as Ctrl+K.
 */
export function ApiQuickOpen({
  snapshot,
  onOpen,
  onClose,
}: {
  snapshot: ApiWorkspaceSnapshot | null;
  onOpen(requestId: string): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const entries = useMemo<Entry[]>(() => {
    if (!snapshot) return [];
    const byId = new Map(snapshot.collections.map((node) => [node.collectionId, node]));
    return snapshot.requests.map((request) => {
      const node = snapshot.collections.find((entry) => entry.requestId === request.requestId);
      const segments: string[] = [];
      let parent = node?.parentId ? byId.get(node.parentId) : undefined;
      while (parent) {
        segments.unshift(parent.name);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return {
        requestId: request.requestId,
        name: request.name || 'Untitled request',
        path: segments.join(' / '),
        badge: requestBadge(request),
        method: request.method,
        url: request.urlTemplate,
      };
    });
  }, [snapshot]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries.slice(0, 50);
    const terms = needle.split(/\s+/);
    return entries
      .filter((entry) => {
        const haystack = `${entry.name} ${entry.path} ${entry.badge} ${entry.url}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, 50);
  }, [entries, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const choose = (index: number): void => {
    const entry = results[index];
    if (!entry) return;
    onOpen(entry.requestId);
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + delta + results.length) % results.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="overlay-root overlay-root--palette" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Open request"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          placeholder="Open a request by name, method or URL…"
          aria-label="Open a request"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="palette__results">
          {results.length === 0 ? (
            <div className="palette__empty">No matching request</div>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.requestId}
                type="button"
                className={['palette__item', index === activeIndex ? 'active' : ''].join(' ')}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                <span className={`api-method-badge api-method-badge--${methodTone(entry.method)} mono`}>
                  {entry.badge}
                </span>
                <span>{entry.name}</span>
                <span className="meta mono">{entry.path || entry.url}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
