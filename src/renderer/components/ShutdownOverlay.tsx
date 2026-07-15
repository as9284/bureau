import logoUrl from '../../../assets/icons/icon-64.png';
import { useAppStore } from '../store/appStore';

export function ShutdownOverlay() {
  const shutdown = useAppStore((s) => s.shutdown);
  if (!shutdown) return null;

  const { items } = shutdown;
  const stopped = items.filter((i) => i.done).length;
  const allDone = stopped === items.length;

  return (
    <div className="shutdown-overlay" role="alertdialog" aria-label="Shutting down Bureau">
      <div className="shutdown-card">
        <img className="shutdown-mark" src={logoUrl} alt="" width={40} height={40} />
        <h1 className="shutdown-title">{allDone ? 'Closing Bureau' : 'Shutting down'}</h1>
        <p className="shutdown-subtitle">
          {allDone
            ? 'All processes stopped.'
            : `Stopping ${items.length} running ${items.length === 1 ? 'process' : 'processes'}…`}
        </p>

        <ul className="shutdown-list">
          {items.map((item) => (
            <li key={`${item.projectId}:${item.processId}`} className="shutdown-row">
              <span
                className={['shutdown-status', item.done ? 'done' : 'pending'].join(' ')}
                aria-hidden
              >
                {item.done ? (
                  <svg
                    width={14}
                    height={14}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="shutdown-spinner" />
                )}
              </span>
              <span className="shutdown-label">{item.label}</span>
              <span className="shutdown-state mono">{item.done ? 'stopped' : 'stopping…'}</span>
            </li>
          ))}
        </ul>

        <div className="shutdown-progress" aria-hidden>
          <div
            className="shutdown-progress__bar"
            style={{ width: `${items.length ? (stopped / items.length) * 100 : 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
