import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Checkbox } from '@renderer/components/Checkbox';
import { TextArea } from '@renderer/components/TextArea';
import { BranchActionConfirmation } from '@renderer/features/git/BranchActionConfirmation';
import './CommitPanel.css';

type Props = {
  projectId: string;
  snapshot?: RepositorySnapshot;
  readOnly: boolean;
};

export function CommitPanel({ projectId, snapshot, readOnly }: Props): ReactElement {
  const draft = useGitStore((s) => s.commitDrafts[projectId] ?? '');
  const setCommitDraft = useGitStore((s) => s.setCommitDraft);
  const commit = useGitStore((s) => s.commit);
  const stashPush = useGitStore((s) => s.stashPush);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);
  const settings = useGitStore((s) => s.settings);
  const commitOptions = useGitStore((s) => s.commitOptionsByRepo[projectId]);
  const setCommitAmend = useGitStore((s) => s.setCommitAmend);
  const setCommitSignOff = useGitStore((s) => s.setCommitSignOff);
  const switchBranch = useGitStore((s) => s.switchBranch);
  const branches = useGitStore((s) => s.branches);
  const loadBranches = useGitStore((s) => s.loadBranches);

  const [commitConfirmOpen, setCommitConfirmOpen] = useState(false);
  const [commitBranch, setCommitBranch] = useState('');
  const [commitConfirming, setCommitConfirming] = useState(false);
  const [commitConfirmError, setCommitConfirmError] = useState<string>();
  const templateAppliedRef = useRef(false);

  useEffect(() => {
    templateAppliedRef.current = false;
  }, [projectId]);

  useEffect(() => {
    const template = settings?.commit.commitTemplate?.trim();
    if (!template || draft.trim() || templateAppliedRef.current) return;
    setCommitDraft(projectId, template);
    templateAppliedRef.current = true;
  }, [projectId, draft, settings?.commit.commitTemplate, setCommitDraft]);

  useEffect(() => {
    loadBranches(projectId).catch(() => undefined);
  }, [projectId, loadBranches]);

  const revision = snapshot?.revision;
  const stagedCount = snapshot?.changedFiles.filter((f) => f.staged).length ?? 0;
  const hasLatestCommit = Boolean(snapshot?.latestCommit);
  const amend = commitOptions?.amend ?? false;
  const signOff = commitOptions?.signOff ?? settings?.commit.defaultSignOff ?? false;
  const currentBranch = snapshot?.branch.kind === 'named' ? snapshot.branch.name : '';
  const branchOptions = Array.from(new Set([currentBranch, ...branches]));
  const canCommit =
    !readOnly && revision && (amend || stagedCount > 0) && (amend || draft.trim().length > 0);

  const openCommitConfirmation = () => {
    setCommitBranch(currentBranch);
    setCommitConfirmError(undefined);
    setCommitConfirmOpen(true);
  };

  const confirmCommit = async () => {
    let activeSnapshot = useGitStore.getState().repos[projectId]?.snapshot;
    if (!activeSnapshot) return;

    setCommitConfirming(true);
    setCommitConfirmError(undefined);
    try {
      const activeBranch = activeSnapshot.branch.kind === 'named' ? activeSnapshot.branch.name : '';
      if (commitBranch && commitBranch !== activeBranch) {
        await switchBranch(projectId, activeSnapshot.revision, commitBranch);
        activeSnapshot = useGitStore.getState().repos[projectId]?.snapshot;
        const switchedBranch =
          activeSnapshot?.branch.kind === 'named' ? activeSnapshot.branch.name : '';
        if (!activeSnapshot || switchedBranch !== commitBranch) {
          setCommitConfirmError('The branch could not be changed. Resolve the Git operation and try again.');
          return;
        }
      }

      const currentDraft = useGitStore.getState().commitDrafts[projectId] ?? '';
      const currentOptions = useGitStore.getState().commitOptionsByRepo[projectId];
      const currentAmend = currentOptions?.amend ?? amend;
      if (!currentAmend && !activeSnapshot.changedFiles.some((file) => file.staged)) {
        setCommitConfirmError('No staged changes remain on the selected branch.');
        return;
      }
      if (!currentAmend && !currentDraft.trim()) {
        setCommitConfirmError('Enter a commit message before committing.');
        return;
      }

      setCommitConfirmOpen(false);
      void commit(projectId, activeSnapshot.revision, currentDraft, {
        amend: currentAmend,
        signOff: currentOptions?.signOff ?? signOff,
        signing: settings?.commit.signingPreference,
      });
    } finally {
      setCommitConfirming(false);
    }
  };

  const commitVerb = amend ? 'Amend commit' : 'Commit';
  const commitConfirmLabel =
    commitBranch && commitBranch !== currentBranch
      ? `Switch to ${commitBranch} and ${amend ? 'amend' : 'commit'}`
      : `${commitVerb} to ${commitBranch || 'detached HEAD'}`;
  const showAmendWarning = amend && (settings?.confirmations.amendCommit ?? true);

  return (
    <aside className="commit-panel" aria-label="Commit">
      <header className="commit-panel__header">
        <h2>Commit</h2>
        <span className="commit-panel__count">{stagedCount} staged</span>
      </header>
      <TextArea
        label="Commit message"
        value={draft}
        onChange={(e) => setCommitDraft(projectId, e.target.value)}
        placeholder="Commit message"
        rows={8}
        disabled={readOnly}
      />
      <div className="commit-panel__options">
        <Checkbox
          checked={amend}
          onCheckedChange={(checked) => setCommitAmend(projectId, checked)}
          disabled={readOnly || !hasLatestCommit}
          label="Amend last commit"
        />
        <Checkbox
          checked={signOff}
          onCheckedChange={(checked) => setCommitSignOff(projectId, checked)}
          disabled={readOnly}
          label="Sign-off"
        />
      </div>
      <div className="commit-panel__actions">
        <Button
          variant="primary"
          disabled={!canCommit || Boolean(operation)}
          loading={operation?.name === 'Commit'}
          onClick={openCommitConfirmation}
        >
          {amend ? 'Amend commit' : 'Commit'}
        </Button>
        <Button
          variant="secondary"
          disabled={readOnly || !revision || Boolean(operation)}
          onClick={() => revision && stashPush(projectId, revision, draft || undefined)}
        >
          Stash
        </Button>
      </div>
      {snapshot?.latestCommit ? (
        <div className="commit-panel__latest">
          <span className="commit-panel__label">Latest</span>
          <code>{snapshot.latestCommit.abbreviatedOid}</code>
          <span>{snapshot.latestCommit.subject}</span>
        </div>
      ) : null}

      <BranchActionConfirmation
        open={commitConfirmOpen}
        title={amend ? 'Amend commit?' : 'Commit changes?'}
        description={
          amend
            ? 'This will rewrite the latest commit on the selected branch.'
            : `This will commit ${stagedCount} staged ${stagedCount === 1 ? 'file' : 'files'} on the selected branch.`
        }
        currentBranch={currentBranch}
        targetBranch={commitBranch}
        branches={branchOptions}
        confirmLabel={commitConfirmLabel}
        confirming={commitConfirming}
        error={commitConfirmError}
        onTargetBranchChange={(branch) => {
          setCommitBranch(branch);
          setCommitConfirmError(undefined);
        }}
        onConfirm={() => void confirmCommit()}
        onClose={() => setCommitConfirmOpen(false)}
      >
        {showAmendWarning ? (
          <p className="git-branch-confirmation__switch-note">
            Amending rewrites the latest commit and may require a force push if it was already published.
          </p>
        ) : null}
      </BranchActionConfirmation>
    </aside>
  );
}
