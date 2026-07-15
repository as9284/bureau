import type { GitResult } from './gitTypes';
import { toBureauError } from '../ipc/errors';

/** True when git stderr indicates the path is not a repository / worktree. */
export function isNotAGitRepository(stderr: string): boolean {
  return /not a git repository/i.test(stderr) || /not a git work.?tree/i.test(stderr);
}

export function assertGitSuccess(result: GitResult, operation: string, projectId?: string): void {
  if (result.killed === 'timeout') {
    throw toBureauError({
      code: 'COMMAND_TIMEOUT',
      message: 'Git command timed out.',
      operation,
      subjectId: projectId,
      retryable: true,
    });
  }
  if (result.killed === 'stdout_limit' || result.killed === 'stderr_limit') {
    throw toBureauError({
      code: 'OUTPUT_LIMIT_EXCEEDED',
      message: 'Git command output exceeded the allowed limit.',
      operation,
      subjectId: projectId,
      retryable: false,
      details: result.stderr,
    });
  }
  if (result.exitCode !== 0) {
    if (isNotAGitRepository(result.stderr)) {
      throw toBureauError({
        code: 'NOT_A_WORKTREE',
        message: 'This folder is not a Git repository.',
        operation,
        subjectId: projectId,
        retryable: false,
        details: result.stderr,
      });
    }
    throw toBureauError({
      code: 'COMMAND_FAILED',
      message: result.stderr.trim() || 'Git command failed.',
      operation,
      subjectId: projectId,
      retryable: true,
      details: result.stderr,
    });
  }
}
