import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type TextareaHTMLAttributes,
} from 'react';
import './TextArea.css';

const DEFAULT_MIN_HEIGHT = 88;
const DEFAULT_MAX_HEIGHT = 480;
const RESIZE_STEP = 12;

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helper?: React.ReactNode;
  error?: React.ReactNode;
  /** When false, the field is a fixed-height textarea (still scrolls). Default true. */
  resizable?: boolean;
  minHeight?: number;
  maxHeight?: number;
}

type DragState = {
  pointerId: number;
  startY: number;
  startHeight: number;
};

export function TextArea({
  label,
  helper,
  error,
  id,
  className,
  resizable = true,
  minHeight = DEFAULT_MIN_HEIGHT,
  maxHeight = DEFAULT_MAX_HEIGHT,
  style,
  disabled,
  readOnly,
  ...props
}: TextAreaProps): ReactElement {
  const inputId = id ?? `sg-textarea-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const helperId = helper ? `${inputId}-helper` : undefined;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const clampHeight = useCallback(
    (next: number): number => Math.round(Math.max(minHeight, Math.min(maxHeight, next))),
    [maxHeight, minHeight]
  );

  const currentHeight = (): number => {
    if (height !== null) return height;
    return textareaRef.current?.getBoundingClientRect().height ?? minHeight;
  };

  const applyHeight = useCallback(
    (next: number): number => {
      const clamped = clampHeight(next);
      setHeight(clamped);
      return clamped;
    },
    [clampHeight]
  );

  useEffect(
    () => () => {
      dragRef.current = null;
      document.body.classList.remove('is-resizing-vertical');
    },
    []
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: currentHeight(),
    };
    setDragging(true);
    document.body.classList.add('is-resizing-vertical');
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    applyHeight(drag.startHeight + (event.clientY - drag.startY));
  };

  const finishDrag = (): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    document.body.classList.remove('is-resizing-vertical');
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    let next: number | null = null;
    if (event.key === 'ArrowUp') next = currentHeight() - RESIZE_STEP * (event.shiftKey ? 4 : 1);
    if (event.key === 'ArrowDown') next = currentHeight() + RESIZE_STEP * (event.shiftKey ? 4 : 1);
    if (event.key === 'Home') next = minHeight;
    if (event.key === 'End') next = maxHeight;
    if (next === null) return;
    event.preventDefault();
    applyHeight(next);
  };

  const inputStyle: CSSProperties = {
    ...style,
    ...(height !== null ? { height } : null),
    maxHeight,
    minHeight,
  };

  return (
    <div className="sg-text-area">
      <label htmlFor={inputId} className="sg-text-area__label">
        {label}
      </label>
      <div className={['sg-text-area__field', dragging ? 'is-resizing' : ''].filter(Boolean).join(' ')}>
        <textarea
          ref={textareaRef}
          id={inputId}
          {...props}
          className={['sg-text-area__input', className].filter(Boolean).join(' ')}
          aria-invalid={Boolean(error)}
          aria-describedby={[errorId, helperId].filter(Boolean).join(' ') || undefined}
          disabled={disabled}
          readOnly={readOnly}
          style={inputStyle}
        />
        {resizable ? (
          <div
            className="sg-text-area__resize"
            role="separator"
            tabIndex={disabled ? -1 : 0}
            aria-orientation="horizontal"
            aria-label={`Resize “${label}” height`}
            aria-controls={inputId}
            aria-disabled={disabled || undefined}
            aria-valuemin={minHeight}
            aria-valuemax={maxHeight}
            aria-valuenow={height ?? undefined}
            title="Drag to resize. Use arrow keys for precise adjustment."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onKeyDown={onKeyDown}
          />
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="sg-text-area__error">
          {error}
        </p>
      ) : null}
      {helper ? (
        <p id={helperId} className="sg-text-area__helper">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
