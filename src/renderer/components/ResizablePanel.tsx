import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

type ResizeAxis = 'horizontal' | 'vertical';
type ResizeEdge = 'start' | 'end';

type ResizablePanelProps = {
  axis: ResizeAxis;
  edge?: ResizeEdge;
  defaultSize: number;
  size?: number;
  minSize: number;
  maxSize: number;
  minSiblingSize?: number;
  storageKey: string;
  resizeLabel: string;
  step?: number;
  className?: string;
  children: ReactNode;
  onSizeCommit?(size: number): void;
};

type DragState = {
  pointerId: number;
  startPosition: number;
  startSize: number;
};

const STORAGE_PREFIX = 'bureau:panel-size:';

function storedSize(storageKey: string): number | null {
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`);
    if (stored === null) return null;
    const value = Number(stored);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function ResizablePanel({
  axis,
  edge = 'end',
  defaultSize,
  size,
  minSize,
  maxSize,
  minSiblingSize,
  storageKey,
  resizeLabel,
  step = 12,
  className,
  children,
  onSizeCommit,
}: ResizablePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const currentSizeRef = useRef(size ?? storedSize(storageKey) ?? defaultSize);

  const getMaximum = useCallback((): number => {
    const parent = panelRef.current?.parentElement;
    if (!parent || minSiblingSize === undefined) return maxSize;
    const rect = parent.getBoundingClientRect();
    const parentSize = axis === 'horizontal' ? rect.width : rect.height;
    if (parentSize <= 0) return maxSize;
    return Math.min(maxSize, parentSize - minSiblingSize - 1);
  }, [axis, maxSize, minSiblingSize]);

  const clampSize = useCallback(
    (nextSize: number): number => {
      const effectiveMaximum = Math.max(minSize, getMaximum());
      return Math.round(Math.max(minSize, Math.min(nextSize, effectiveMaximum)));
    },
    [getMaximum, minSize]
  );

  const applySize = useCallback(
    (nextSize: number): number => {
      const clamped = clampSize(nextSize);
      currentSizeRef.current = clamped;
      panelRef.current?.style.setProperty('--resizable-panel-size', `${clamped}px`);
      handleRef.current?.setAttribute('aria-valuenow', String(clamped));
      handleRef.current?.setAttribute('aria-valuemax', String(Math.max(minSize, getMaximum())));
      handleRef.current?.setAttribute('aria-valuetext', `${clamped} pixels`);
      return clamped;
    },
    [clampSize, getMaximum, minSize]
  );

  const persistAndCommit = useCallback(
    (nextSize: number): void => {
      const clamped = applySize(nextSize);
      try {
        window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, String(clamped));
      } catch {
        // A storage failure must not make resizing itself fail.
      }
      onSizeCommit?.(clamped);
    },
    [applySize, onSizeCommit, storageKey]
  );

  const setDragging = useCallback(
    (dragging: boolean): void => {
      panelRef.current?.classList.toggle('is-resizing', dragging);
      document.body.classList.toggle('is-resizing-horizontal', dragging && axis === 'horizontal');
      document.body.classList.toggle('is-resizing-vertical', dragging && axis === 'vertical');
    },
    [axis]
  );

  const finishDrag = (commit: boolean): void => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragging(false);
    if (commit) persistAndCommit(currentSizeRef.current);
    else applySize(drag.startSize);
  };

  useLayoutEffect(() => {
    const nextSize = size ?? storedSize(storageKey) ?? defaultSize;
    applySize(nextSize);
  }, [applySize, defaultSize, size, storageKey]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => applySize(currentSizeRef.current));
    observer.observe(panel.parentElement ?? panel);
    return () => observer.disconnect();
  }, [applySize]);

  useEffect(
    () => () => {
      dragRef.current = null;
      setDragging(false);
    },
    [setDragging]
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startPosition: axis === 'horizontal' ? event.clientX : event.clientY,
      startSize: currentSizeRef.current,
    };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = axis === 'horizontal' ? event.clientX : event.clientY;
    const direction = edge === 'end' ? 1 : -1;
    applySize(drag.startSize + (position - drag.startPosition) * direction);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    finishDrag(true);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const decreaseKey = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const increaseKey = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    let nextSize: number | null = null;
    if (event.key === decreaseKey)
      nextSize = currentSizeRef.current - step * (event.shiftKey ? 4 : 1);
    if (event.key === increaseKey)
      nextSize = currentSizeRef.current + step * (event.shiftKey ? 4 : 1);
    if (event.key === 'Home') nextSize = minSize;
    if (event.key === 'End') nextSize = getMaximum();
    if (nextSize === null) return;
    event.preventDefault();
    persistAndCommit(nextSize);
  };

  const initialStyle = {
    '--resizable-panel-size': `${currentSizeRef.current}px`,
  } as CSSProperties;

  return (
    <div
      ref={panelRef}
      className={[
        'resizable-panel',
        `resizable-panel--${axis}`,
        `resizable-panel--edge-${edge}`,
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={initialStyle}
      data-resize-axis={axis}
    >
      {children}
      <div
        ref={handleRef}
        className="resizable-panel__handle"
        role="separator"
        tabIndex={0}
        aria-label={resizeLabel}
        aria-orientation={axis === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuemin={minSize}
        aria-valuemax={maxSize}
        aria-valuenow={currentSizeRef.current}
        aria-valuetext={`${currentSizeRef.current} pixels`}
        title="Drag to resize. Use arrow keys for precise adjustment. Double-click to reset."
        onDoubleClick={() => persistAndCommit(defaultSize)}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => finishDrag(false)}
      />
    </div>
  );
}
