import { useEffect } from 'react';
import { useAppStore, type Toast } from '../store/appStore';

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useAppStore((s) => s.dismissToast);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), 6000);
    return () => clearTimeout(timer);
  }, [toast.id, dismiss]);

  return (
    <div className={['toast', toast.tone].join(' ')} role="status">
      <span className="toast__dot" aria-hidden="true" />
      <span className="toast__message">{toast.message}</span>
      <button
        type="button"
        className="toast__close"
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

export function ToastStack() {
  const toasts = useAppStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
