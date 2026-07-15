import { describe, expect, it } from 'vitest';
import { assertGitSuccess, isNotAGitRepository } from '@main/git/gitResult';
import { createUnavailableSnapshot } from '@main/git/GitStatusService';

describe('isNotAGitRepository', () => {
  it('detects the standard fatal stderr from git status', () => {
    expect(
      isNotAGitRepository('fatal: not a git repository (or any of the parent directories): .git')
    ).toBe(true);
    expect(isNotAGitRepository('fatal: not a git repository: /tmp/foo')).toBe(true);
    expect(isNotAGitRepository('fatal: this operation must be run in a work tree')).toBe(false);
    expect(isNotAGitRepository('error: pathspec did not match')).toBe(false);
  });
});

describe('assertGitSuccess', () => {
  it('maps not-a-repo stderr to NOT_A_WORKTREE', () => {
    try {
      assertGitSuccess(
        {
          exitCode: 128,
          stdout: '',
          stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
          durationMs: 1,
        },
        'status.collectSnapshot',
        'proj-1'
      );
      expect.fail('expected NOT_A_WORKTREE');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'NOT_A_WORKTREE',
        subjectId: 'proj-1',
        retryable: false,
        message: 'This folder is not a Git repository.',
      });
    }
  });
});

describe('createUnavailableSnapshot', () => {
  it('builds a compact non-repo snapshot', () => {
    const snap = createUnavailableSnapshot('proj-1', 12);
    expect(snap.availability).toBe('unavailable');
    expect(snap.projectId).toBe('proj-1');
    expect(snap.changedFileCount).toBe(0);
    expect(snap.dirty).toBe(false);
  });
});
