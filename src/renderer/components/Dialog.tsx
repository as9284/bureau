import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import './Dialog.css';

interface DialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  onClose?: () => void;
  /** Extra classes appended to the dialog panel (e.g. feature layout hooks). */
  className?: string;
  /** `wide` raises max-width to 680px for denser forms (import / export / runner). */
  size?: 'default' | 'wide';
}

export function Dialog({
  open,
  title,
  description,
  children,
  actions,
  initialFocusRef,
  onClose,
  className,
  size = 'default',
}: DialogProps): ReactElement | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus only when the dialog opens — not when parent re-renders with a fresh
  // onClose identity (inline handlers), which would steal focus from text inputs.
  useEffect(() => {
    if (!open) return;
    const focusTarget =
      initialFocusRef?.current ??
      dialogRef.current?.querySelector<HTMLElement>('input, textarea, select, button');
    focusTarget?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, initialFocusRef]);

  if (!open) return null;

  const panelClass = [
    'sg-dialog',
    size === 'wide' ? 'sg-dialog--wide' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="sg-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className={panelClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sg-dialog-title"
        aria-describedby={description ? 'sg-dialog-description' : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="sg-dialog-title" className="sg-dialog__title">
          {title}
        </h2>
        {description ? (
          <p id="sg-dialog-description" className="sg-dialog__description">
            {description}
          </p>
        ) : null}
        {children}
        <div className="sg-dialog__actions">{actions}</div>
      </div>
    </div>
  );
}
