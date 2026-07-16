import { useState, type ReactElement } from 'react';
import type { ResetMode } from '@shared/contracts/history';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import './ResetCommitDialog.css';

export type ResetTarget = {
  oid: string;
  abbreviatedOid: string;
  /** One line of context for the row the user right-clicked (subject or reflog action). */
  label: string;
};

type Props = {
  projectId: string;
  revision?: string;
  target: ResetTarget | null;
  onClose: () => void;
};

const MODE_OPTIONS: ReadonlyArray<{ value: ResetMode; label: string }> = [
  { value: 'mixed', label: 'Mixed — keep changes, unstaged' },
  { value: 'soft', label: 'Soft — keep changes, staged' },
  { value: 'hard', label: 'Hard — discard all changes' },
];

const MODE_HELP: Record<ResetMode, string> = {
  mixed:
    'Moves the branch and leaves every change in your working tree, unstaged. Nothing is lost.',
  soft: 'Moves the branch and leaves every change staged, ready to recommit. Nothing is lost.',
  hard: 'Moves the branch and restores every tracked file to match the commit. Staged and unstaged changes are destroyed and the reflog cannot bring them back. Untracked files are left in place.',
};

/**
 * Picks the reset mode before handing off to the store's gated action. Shared by the
 * History and Reflog panels — the mode must be chosen here so the confirmation that
 * follows can name exactly what the chosen mode destroys.
 */
export function ResetCommitDialog({ projectId, revision, target, onClose }: Props): ReactElement {
  const resetToCommit = useGitStore((s) => s.resetToCommit);
  const [mode, setMode] = useState<ResetMode>('mixed');

  const close = () => {
    setMode('mixed');
    onClose();
  };

  return (
    <Dialog
      open={Boolean(target)}
      title="Reset to this commit"
      description="Move the current branch to the selected commit."
      onClose={close}
      actions={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={mode === 'hard' ? 'danger' : 'primary'}
            disabled={!revision}
            onClick={() => {
              if (target && revision) {
                void resetToCommit(projectId, revision, target.oid, mode);
                close();
              }
            }}
          >
            {mode === 'hard' ? 'Reset and discard' : 'Reset'}
          </Button>
        </>
      }
    >
      <p className="reset-dialog__target">
        <code className="reset-dialog__oid">{target?.abbreviatedOid}</code>
        <span className="reset-dialog__label">{target?.label}</span>
      </p>
      <Dropdown
        label="Reset mode"
        value={mode}
        options={MODE_OPTIONS}
        onChange={(next) => setMode(next)}
      />
      <p
        className={`reset-dialog__help ${mode === 'hard' ? 'reset-dialog__help--danger' : ''}`}
        role={mode === 'hard' ? 'alert' : undefined}
      >
        {MODE_HELP[mode]}
      </p>
    </Dialog>
  );
}
