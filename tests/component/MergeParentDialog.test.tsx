import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useGitStore } from '@renderer/store/gitStore';
import { MergeParentDialog } from '@renderer/features/git/history/MergeParentDialog';
import type { HistoryCommit } from '@shared/contracts/history';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const MERGE_OID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PARENT_1 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PARENT_2 = 'cccccccccccccccccccccccccccccccccccccccc';

const TARGET = {
  oid: MERGE_OID,
  abbreviatedOid: 'aaaaaaa',
  label: "Merge branch 'feature/x'",
  parentOids: [PARENT_1, PARENT_2],
};

function commit(oid: string, subject: string): HistoryCommit {
  return {
    oid,
    abbreviatedOid: oid.slice(0, 7),
    subject,
    authorName: 'Dev',
    committedAt: '2026-07-16T00:00:00Z',
    parentOids: [],
    decorations: [],
  };
}

beforeEach(() => {
  useGitStore.setState({
    historyCommits: [commit(PARENT_1, 'Release 2.0'), commit(PARENT_2, 'Add the widget')],
  });
});

afterEach(cleanup);

/**
 * Regression: `revert --no-edit <merge-oid>` with no `-m` is rejected by git with
 * "commit … is a merge but no -m option was given", and the app offered no way to
 * supply one. The picker is what makes the mainline an explicit user choice rather
 * than a guess — `-m 1` and `-m 2` undo opposite sides of the merge.
 */
describe('MergeParentDialog', () => {
  it('lists every parent, named by its role and subject', async () => {
    render(
      <MergeParentDialog
        projectId={PROJECT_ID}
        revision="rev-1"
        action="revert"
        target={TARGET}
        onClose={vi.fn()}
      />
    );

    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Keep the changes from' }));

    expect(screen.getByRole('option', { name: /Parent 1 .*Release 2\.0/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /Parent 2 .*Add the widget/ })).toBeTruthy();
  });

  it('sends the chosen parent as the mainline when reverting', async () => {
    const revertCommit = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({
      revertCommit: revertCommit as unknown as ReturnType<typeof useGitStore.getState>['revertCommit'],
    });
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <MergeParentDialog
        projectId={PROJECT_ID}
        revision="rev-1"
        action="revert"
        target={TARGET}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole('combobox', { name: 'Keep the changes from' }));
    await user.click(screen.getByRole('option', { name: /Parent 2/ }));
    await user.click(screen.getByRole('button', { name: 'Revert merge' }));

    expect(revertCommit).toHaveBeenCalledWith(PROJECT_ID, 'rev-1', MERGE_OID, 2);
    expect(onClose).toHaveBeenCalled();
  });

  it('cherry-picks through the same picker', async () => {
    const cherryPick = vi.fn().mockResolvedValue(undefined);
    useGitStore.setState({
      cherryPick: cherryPick as unknown as ReturnType<typeof useGitStore.getState>['cherryPick'],
    });
    const user = userEvent.setup();

    render(
      <MergeParentDialog
        projectId={PROJECT_ID}
        revision="rev-1"
        action="cherry-pick"
        target={TARGET}
        onClose={vi.fn()}
      />
    );

    // Parent 1 is the default, so this also pins that the default is *sent*, not left
    // undefined — git would reject a merge cherry-pick with no -m at all.
    await user.click(screen.getByRole('button', { name: 'Cherry-pick merge' }));

    expect(cherryPick).toHaveBeenCalledWith(PROJECT_ID, 'rev-1', MERGE_OID, 1);
  });

  it('renders nothing until a target is set', () => {
    render(
      <MergeParentDialog
        projectId={PROJECT_ID}
        revision="rev-1"
        action="revert"
        target={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
