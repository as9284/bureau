import { useMemo, useState } from 'react';

/**
 * A tail window over a long append-only list.
 *
 * The API workbench has three lists that grow without a natural bound — a stream transcript
 * (capped at 5,000 entries), a collection run's results, and request history — and rendering all of
 * them puts thousands of elements in the DOM for rows nobody has scrolled to.
 *
 * This is a deliberately small alternative to a virtualiser: these lists are append-only and read
 * newest-first, so showing the tail and letting the user ask for more covers the real use without a
 * measured-height scroller, which would have to fight the variable row heights a transcript has.
 *
 * Nothing is hidden silently — `hidden` is returned so the caller can say how much is above.
 */
export function useTailWindow<T>(
  items: readonly T[],
  pageSize = 200
): { visible: T[]; hidden: number; showMore(): void; showAll(): void } {
  const [limit, setLimit] = useState(pageSize);

  const visible = useMemo(
    () => (items.length <= limit ? [...items] : items.slice(items.length - limit)),
    [items, limit]
  );

  return {
    visible,
    hidden: Math.max(0, items.length - visible.length),
    showMore: () => setLimit((current) => current + pageSize),
    showAll: () => setLimit(Number.MAX_SAFE_INTEGER),
  };
}
