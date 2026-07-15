import { useCallback, useRef, type ReactElement } from 'react';
import './PaneSeparator.css';

type Props = {
  orientation?: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  label?: string;
};

export function PaneSeparator({
  orientation = 'vertical',
  onResize,
  onResizeEnd,
  label = 'Resize pane',
}: Props): ReactElement {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      lastPos.current = orientation === 'vertical' ? e.clientX : e.clientY;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [orientation]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const pos = orientation === 'vertical' ? e.clientX : e.clientY;
      const delta = pos - lastPos.current;
      lastPos.current = pos;
      onResize(delta);
    },
    [orientation, onResize]
  );

  const finishResize = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      onResizeEnd?.();
    },
    [onResizeEnd]
  );

  return (
    <div
      className={`sg-pane-separator sg-pane-separator--${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 32 : 8;
        if (orientation === 'vertical') {
          if (e.key === 'ArrowLeft') {
            onResize(-step);
            onResizeEnd?.();
          }
          if (e.key === 'ArrowRight') {
            onResize(step);
            onResizeEnd?.();
          }
        } else {
          if (e.key === 'ArrowUp') {
            onResize(-step);
            onResizeEnd?.();
          }
          if (e.key === 'ArrowDown') {
            onResize(step);
            onResizeEnd?.();
          }
        }
      }}
    />
  );
}
