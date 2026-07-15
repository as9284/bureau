import { useEffect, useRef, type RefObject } from 'react';

/**
 * Brings a hand-rolled `.overlay-root` / `.dialog` modal to parity with the
 * shared Dialog component: focus the first control when it opens and close on
 * Escape. Intentionally minimal — no focus trap — to match Dialog's behaviour.
 *
 * Attach the returned ref to the dialog panel and pass the modal's cancel/close
 * handler as `onDismiss`.
 */
export function useModalDismiss(
  onDismiss: () => void,
  containerRef: RefObject<HTMLElement | null>,
  open = true
): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (container && !container.contains(document.activeElement)) {
      const focusTarget = container.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'
      );
      focusTarget?.focus();
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismissRef.current();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [containerRef, open]);
}
