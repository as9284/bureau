import type { ReactElement, ReactNode } from 'react';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { Select } from '@renderer/components/Select';
import './BranchActionConfirmation.css';

type Props = {
  open: boolean;
  title: string;
  description: ReactNode;
  currentBranch: string;
  targetBranch: string;
  branches: string[];
  confirmLabel: string;
  confirming: boolean;
  confirmDisabled?: boolean;
  error?: string;
  children?: ReactNode;
  onTargetBranchChange: (branch: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

function branchLabel(branch: string): string {
  return branch || 'Detached HEAD';
}

export function BranchActionConfirmation({
  open,
  title,
  description,
  currentBranch,
  targetBranch,
  branches,
  confirmLabel,
  confirming,
  confirmDisabled = false,
  error,
  children,
  onTargetBranchChange,
  onConfirm,
  onClose,
}: Props): ReactElement {
  const branchOptions = Array.from(new Set([currentBranch, ...branches])).map((branch) => ({
    value: branch,
    label: branchLabel(branch),
  }));
  const switchesBranch = Boolean(targetBranch && targetBranch !== currentBranch);

  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" disabled={confirming} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={confirmDisabled || confirming}
            loading={confirming}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="git-branch-confirmation">
        <div className="git-branch-confirmation__current">
          <span>Current branch</span>
          <code>{branchLabel(currentBranch)}</code>
        </div>
        {branchOptions.length > 1 ? (
          <div className="git-branch-confirmation__target">
            <span>Target branch</span>
            <Select
              label="Target branch"
              value={targetBranch}
              options={branchOptions}
              size="compact"
              disabled={confirming}
              onChange={onTargetBranchChange}
            />
          </div>
        ) : null}
        {switchesBranch ? (
          <p className="git-branch-confirmation__switch-note">
            Bureau will switch the working tree to <code>{targetBranch}</code> before continuing.
          </p>
        ) : null}
        {children}
        {error ? (
          <p className="git-branch-confirmation__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
