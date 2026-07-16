import type { ReactElement } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';

/**
 * The single host for every store-gated destructive git confirmation. Mounted
 * app-wide so any entry point (panel button, context menu, palette) is covered
 * by the same prompt.
 */
export function GitConfirmDialog(): ReactElement {
  const pending = useGitStore((s) => s.pendingConfirm);
  const cancel = useGitStore((s) => s.cancelGitConfirm);
  const accept = useGitStore((s) => s.acceptGitConfirm);

  return (
    <Dialog
      open={Boolean(pending)}
      title={pending?.title ?? ''}
      description={pending?.description ?? ''}
      onClose={cancel}
      actions={
        <>
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void accept()}>
            {pending?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    />
  );
}
