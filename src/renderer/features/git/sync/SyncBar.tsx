import { useEffect, useState, type ReactElement } from 'react';
import type { RepositorySnapshot } from '@shared/contracts/gitSnapshot';
import { useGitStore } from '@renderer/store/gitStore';
import { Button } from '@renderer/components/Button';
import { Select } from '@renderer/components/Select';
import { ArrowDownIcon, ArrowUpIcon, RefreshIcon } from '@renderer/components/icons';
import { BranchActionConfirmation } from '@renderer/features/git/BranchActionConfirmation';
import './SyncBar.css';

type Props = {
  projectId: string;
  snapshot: RepositorySnapshot;
  readOnly: boolean;
};

export function SyncBar({ projectId, snapshot, readOnly }: Props): ReactElement {
  const fetch = useGitStore((s) => s.fetch);
  const pull = useGitStore((s) => s.pull);
  const push = useGitStore((s) => s.push);
  const refreshRepo = useGitStore((s) => s.refreshRepo);
  const listBranches = useGitStore((s) => s.loadBranches);
  const switchBranch = useGitStore((s) => s.switchBranch);
  const branches = useGitStore((s) => s.branches);
  const branchDetails = useGitStore((s) => s.branchDetails);
  const operation = useGitStore((s) => s.operationByRepo[projectId]);
  const setGitHubPublishRepoId = useGitStore((s) => s.setGitHubPublishRepoId);
  const [pushConfirmOpen, setPushConfirmOpen] = useState(false);
  const [pushBranch, setPushBranch] = useState('');
  const [pushConfirming, setPushConfirming] = useState(false);
  const [pushConfirmError, setPushConfirmError] = useState<string>();

  useEffect(() => {
    listBranches(projectId).catch(() => undefined);
  }, [projectId, listBranches]);

  const currentBranch = snapshot.branch.kind === 'named' ? snapshot.branch.name : '';
  const canSync =
    !readOnly && snapshot.branch.kind === 'named' && snapshot.upstream.kind === 'tracking';

  const ahead = snapshot.upstream.kind === 'tracking' ? snapshot.upstream.ahead : 0;
  const behind = snapshot.upstream.kind === 'tracking' ? snapshot.upstream.behind : 0;
  const pushBranches = Array.from(new Set([currentBranch, ...branches]));
  const selectedBranch = branchDetails.find(
    (branch) => branch.kind === 'local' && branch.shortName === pushBranch
  );
  const selectedBranchHasUpstream =
    pushBranch === currentBranch ? canSync : Boolean(selectedBranch?.upstreamRef);
  const pushConfirmLabel =
    pushBranch && pushBranch !== currentBranch
      ? `Switch to ${pushBranch} and push`
      : `Push ${pushBranch || 'branch'}`;

  const openPushConfirmation = () => {
    setPushBranch(currentBranch);
    setPushConfirmError(undefined);
    setPushConfirmOpen(true);
  };

  const confirmPush = async () => {
    let activeSnapshot = useGitStore.getState().repos[projectId]?.snapshot;
    if (!activeSnapshot) return;

    setPushConfirming(true);
    setPushConfirmError(undefined);
    try {
      const activeBranch = activeSnapshot.branch.kind === 'named' ? activeSnapshot.branch.name : '';
      if (pushBranch && pushBranch !== activeBranch) {
        await switchBranch(projectId, activeSnapshot.revision, pushBranch);
        activeSnapshot = useGitStore.getState().repos[projectId]?.snapshot;
        const switchedBranch =
          activeSnapshot?.branch.kind === 'named' ? activeSnapshot.branch.name : '';
        if (!activeSnapshot || switchedBranch !== pushBranch) {
          setPushConfirmError('The branch could not be changed. Resolve the Git operation and try again.');
          return;
        }
      }

      if (activeSnapshot.upstream.kind !== 'tracking') {
        setPushConfirmError('The selected branch has no configured upstream to push to.');
        return;
      }

      setPushConfirmOpen(false);
      void push(projectId, activeSnapshot.revision);
    } finally {
      setPushConfirming(false);
    }
  };

  return (
    <div className="sync-bar">
      <Select
        label="Current branch"
        value={currentBranch}
        onChange={(value) => switchBranch(projectId, snapshot.revision, value)}
        options={(branches.length ? branches : currentBranch ? [currentBranch] : []).map((b) => ({
          value: b,
          label: b,
        }))}
        disabled={readOnly || snapshot.branch.kind === 'unborn'}
      />
      {ahead > 0 || behind > 0 ? (
        <div className="sync-bar__counts">
          {ahead > 0 ? (
            <span className="sync-bar__ahead">
              <ArrowUpIcon /> {ahead}
            </span>
          ) : null}
          {behind > 0 ? (
            <span className="sync-bar__behind">
              <ArrowDownIcon /> {behind}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="sync-bar__actions">
        <Button
          variant="ghost"
          leadingIcon={<RefreshIcon />}
          onClick={() => refreshRepo(projectId)}
        >
          Refresh
        </Button>
        <Button
          variant="secondary"
          disabled={readOnly || Boolean(operation)}
          onClick={() => fetch(projectId, snapshot.revision)}
        >
          Fetch
        </Button>
        {canSync ? (
          <>
            <Button
              variant="secondary"
              disabled={Boolean(operation)}
              onClick={() => pull(projectId, snapshot.revision)}
            >
              Pull
            </Button>
            <Button
              variant="primary"
              disabled={Boolean(operation)}
              onClick={openPushConfirmation}
            >
              Push
            </Button>
          </>
        ) : snapshot.branch.kind === 'named' ? (
          <Button
            variant="primary"
            disabled={readOnly || Boolean(operation)}
            onClick={() => setGitHubPublishRepoId(projectId)}
          >
            Publish to GitHub
          </Button>
        ) : null}
      </div>
      <BranchActionConfirmation
        open={pushConfirmOpen}
        title="Push branch?"
        description={`This will push ${pushBranch || 'the selected branch'} to its configured upstream.`}
        currentBranch={currentBranch}
        targetBranch={pushBranch}
        branches={pushBranches}
        confirmLabel={pushConfirmLabel}
        confirming={pushConfirming}
        confirmDisabled={!selectedBranchHasUpstream}
        error={
          pushConfirmError ??
          (pushBranch && !selectedBranchHasUpstream
            ? `${pushBranch} has no configured upstream.`
            : undefined)
        }
        onTargetBranchChange={(branch) => {
          setPushBranch(branch);
          setPushConfirmError(undefined);
        }}
        onConfirm={() => void confirmPush()}
        onClose={() => setPushConfirmOpen(false)}
      />
    </div>
  );
}
