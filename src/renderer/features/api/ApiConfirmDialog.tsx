import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { useApiStore } from '@renderer/store/apiStore';

/**
 * The single host for every gated destructive API confirmation — discarding an unsaved draft,
 * deleting a request or a secret. Mounted once by the workspace so a context menu, a tab close and
 * a keyboard shortcut all get the same themed prompt instead of an OS-native `window.confirm`.
 */
export function ApiConfirmDialog() {
  const pending = useApiStore((s) => s.pendingConfirm);
  const cancel = useApiStore((s) => s.cancelApiConfirm);
  const accept = useApiStore((s) => s.acceptApiConfirm);

  return (
    <Dialog
      open={Boolean(pending)}
      title={pending?.title ?? ''}
      description={pending?.description ?? ''}
      onClose={cancel}
      actions={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant={pending?.danger ? 'danger' : 'primary'}
            onClick={() => void accept()}
          >
            {pending?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    />
  );
}
