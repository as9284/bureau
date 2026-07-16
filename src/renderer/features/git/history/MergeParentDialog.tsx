import { useState, type ReactElement } from 'react';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { Dropdown } from '@renderer/components/Dropdown';
import './MergeParentDialog.css';

export type MergeParentAction = 'revert' | 'cherry-pick';

export type MergeParentTarget = {
  oid: string;
  abbreviatedOid: string;
  /** The commit's subject, for the row of context above the picker. */
  label: string;
  /** Full parent oids, in git's order — parent 1 first. */
  parentOids: string[];
};

type Props = {
  projectId: string;
  revision?: string;
  action: MergeParentAction;
  target: MergeParentTarget | null;
  onClose: () => void;
};

const COPY: Record<MergeParentAction, { title: string; description: string; confirm: string }> = {
  revert: {
    title: 'Revert a merge commit',
    description:
      'Reverting a merge undoes the changes brought in by one side of it. Git cannot tell which side you mean, so pick the branch to keep.',
    confirm: 'Revert merge',
  },
  'cherry-pick': {
    title: 'Cherry-pick a merge commit',
    description:
      'Cherry-picking a merge replays the changes from one side of it. Git cannot tell which side you mean, so pick the branch to keep.',
    confirm: 'Cherry-pick merge',
  },
};

/**
 * Picks the mainline parent (`-m <n>`) before handing off to the store.
 *
 * This exists because git *requires* `-m` for a merge commit and there is no safe
 * default: `-m 1` and `-m 2` produce opposite results, and picking one silently would
 * give the user a successful-looking commit with the wrong content. Only opened when
 * the target has more than one parent; ordinary commits skip straight to the action.
 */
export function MergeParentDialog({
  projectId,
  revision,
  action,
  target,
  onClose,
}: Props): ReactElement {
  const revertCommit = useGitStore((s) => s.revertCommit);
  const cherryPick = useGitStore((s) => s.cherryPick);
  // The parents are usually already on screen in the history list, so their subjects
  // are free context — and they are what actually tells the two sides apart.
  const historyCommits = useGitStore((s) => s.historyCommits);
  const [mainline, setMainline] = useState('1');

  const close = () => {
    setMainline('1');
    onClose();
  };

  const copy = COPY[action];
  const options = (target?.parentOids ?? []).map((parentOid, index) => {
    const subject = historyCommits.find((c) => c.oid === parentOid)?.subject;
    const short = parentOid.slice(0, 7);
    const role = index === 0 ? 'the branch merged into' : 'the branch merged in';
    return {
      value: String(index + 1),
      label: subject
        ? `Parent ${index + 1} (${role}) — ${short} ${subject}`
        : `Parent ${index + 1} (${role}) — ${short}`,
    };
  });

  return (
    <Dialog
      open={Boolean(target)}
      title={copy.title}
      description={copy.description}
      onClose={close}
      actions={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!revision}
            onClick={() => {
              if (!target || !revision) return;
              const parent = Number(mainline);
              if (action === 'revert') {
                void revertCommit(projectId, revision, target.oid, parent);
              } else {
                void cherryPick(projectId, revision, target.oid, parent);
              }
              close();
            }}
          >
            {copy.confirm}
          </Button>
        </>
      }
    >
      <p className="merge-parent-dialog__target">
        <code className="merge-parent-dialog__oid">{target?.abbreviatedOid}</code>
        <span className="merge-parent-dialog__label">{target?.label}</span>
      </p>
      <Dropdown
        label="Keep the changes from"
        value={mainline}
        options={options}
        onChange={(next) => setMainline(next)}
      />
      <p className="merge-parent-dialog__help">
        {action === 'revert'
          ? 'The commit history is kept as-is; a new commit undoes the changes the other side introduced.'
          : 'A new commit replays the difference between the chosen parent and the merge.'}
      </p>
    </Dialog>
  );
}
