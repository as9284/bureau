import { DownloadSimpleIcon } from '@phosphor-icons/react/DownloadSimple';
import { CheckCircleIcon } from '@phosphor-icons/react/CheckCircle';
import { useAppStore } from '../store/appStore';
import { Button } from './Button';

/**
 * Persistent, non-dismissible update notice pinned to the top-right. It appears
 * only while an update is downloading (live %) or once it is downloaded and
 * ready to install — there is deliberately no close affordance.
 */
export function UpdateNotifier() {
  const updateState = useAppStore((state) => state.updateState);
  if (!updateState) return null;
  if (updateState.kind !== 'downloading' && updateState.kind !== 'downloaded') return null;

  const downloaded = updateState.kind === 'downloaded';
  const percent = updateState.kind === 'downloading' ? updateState.percent : 100;

  return (
    <div className="update-notifier" role="status" aria-live="polite">
      <span className="update-notifier__icon" aria-hidden>
        {downloaded ? <CheckCircleIcon size={18} weight="fill" /> : <DownloadSimpleIcon size={18} />}
      </span>
      <div className="update-notifier__body">
        <div className="update-notifier__title">
          {downloaded ? 'Update ready to install' : 'Downloading update'}
        </div>
        {downloaded ? (
          <div className="update-notifier__detail">
            <span className="mono">Bureau {updateState.availableVersion}</span> will apply on restart.
          </div>
        ) : (
          <>
            <div
              className="update-notifier__progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="update-notifier__progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="update-notifier__detail mono">{percent}%</div>
          </>
        )}
      </div>
      {downloaded ? (
        <Button variant="primary" onClick={() => void window.bureau.app.installUpdate()}>
          Restart
        </Button>
      ) : null}
    </div>
  );
}
