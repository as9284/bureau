import { useEffect, type ReactElement } from 'react';
import type { OperationStateDetails } from '@shared/contracts/recovery';
import { useGitStore } from '@renderer/store/gitStore';
import { Banner } from '@renderer/components/Banner';
import { Button } from '@renderer/components/Button';
import { WarningIcon } from '@renderer/components/icons';

type Props = {
  projectId: string;
  snapshotRevision?: string;
};

export function RecoveryBanner({ projectId, snapshotRevision }: Props): ReactElement | null {
  const operationState = useGitStore((s) => s.recoveryStateByRepo[projectId]);
  const loadRecoveryState = useGitStore((s) => s.loadRecoveryState);
  const runRecovery = useGitStore((s) => s.runRecoveryAction);
  const bisectReset = useGitStore((s) => s.bisectReset);
  const setRepoPanel = useGitStore((s) => s.setRepoPanel);
  const openInTerminal = useGitStore((s) => s.openInTerminal);

  useEffect(() => {
    void loadRecoveryState(projectId);
  }, [projectId, loadRecoveryState]);

  if (!operationState?.activeKind && !operationState?.conflictedFiles.length) {
    return null;
  }

  const state = operationState as OperationStateDetails;

  return (
    <Banner
      variant="recovery"
      icon={<WarningIcon />}
      heading={state.summary}
      supporting={state.instructions}
      actions={
        <>
          {state.conflictedFiles.length > 0 ? (
            <Button variant="secondary" onClick={() => setRepoPanel('changes')}>
              Open conflicts
            </Button>
          ) : null}
          {state.canContinue && snapshotRevision ? (
            <Button
              variant="primary"
              onClick={() => void runRecovery(projectId, snapshotRevision, 'continue')}
            >
              Continue
            </Button>
          ) : null}
          {state.canSkip && snapshotRevision ? (
            <Button
              variant="secondary"
              onClick={() => void runRecovery(projectId, snapshotRevision, 'skip')}
            >
              Skip
            </Button>
          ) : null}
          {state.canAbort && snapshotRevision ? (
            <Button
              variant="danger"
              onClick={() => void runRecovery(projectId, snapshotRevision, 'abort')}
            >
              Abort
            </Button>
          ) : null}
          {state.activeKind === 'bisect' && snapshotRevision ? (
            <Button
              variant="secondary"
              onClick={() => void bisectReset(projectId, snapshotRevision)}
            >
              Reset bisect
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => void openInTerminal(projectId)}>
            Open in terminal
          </Button>
        </>
      }
    />
  );
}
