import type { ReactElement } from 'react';
import { Dialog } from '@renderer/components/Dialog';
import { Button } from '@renderer/components/Button';
import { TextInput } from '@renderer/components/TextInput';

type Props = {
  open: boolean;
  branchName: string | null | undefined;
  remoteName: string;
  remoteUrl: string;
  busy?: boolean;
  onRemoteNameChange(value: string): void;
  onRemoteUrlChange(value: string): void;
  onClose(): void;
  onConfirm(): void;
};

/** Push a local branch to an existing remote and set upstream — not forge repo creation. */
export function PublishBranchDialog({
  open,
  branchName,
  remoteName,
  remoteUrl,
  busy = false,
  onRemoteNameChange,
  onRemoteUrlChange,
  onClose,
  onConfirm,
}: Props): ReactElement {
  const label = branchName ?? 'this branch';
  return (
    <Dialog
      open={open}
      title="Publish branch"
      description={
        <>
          Push <span className="mono">{label}</span> to a remote that already hosts this repository,
          and set its upstream. This does not create a new GitHub or Gitea repository.
        </>
      }
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!remoteName.trim() || busy}
            onClick={onConfirm}
          >
            Publish branch
          </Button>
        </>
      }
    >
      <div className="branches-panel__publish-fields">
        <TextInput
          label="Remote name"
          value={remoteName}
          onChange={(e) => onRemoteNameChange(e.target.value)}
          placeholder="origin"
        />
        <TextInput
          label="Remote URL"
          value={remoteUrl}
          onChange={(e) => onRemoteUrlChange(e.target.value)}
          placeholder="Optional when the remote already exists"
        />
      </div>
    </Dialog>
  );
}
