import type { BranchDetail } from '@shared/contracts/branches';

/**
 * Whether this worktree already has somewhere to push — a configured remote,
 * remote-tracking refs, or a previously published local branch. Used to prefer
 * "publish branch" over "create repository on a forge".
 */
export function hasConfiguredRemote(input: {
  remotes: readonly { name: string }[];
  branchDetails: readonly Pick<
    BranchDetail,
    'kind' | 'published' | 'remoteName' | 'upstreamRef'
  >[];
}): boolean {
  if (input.remotes.length > 0) return true;
  return input.branchDetails.some(
    (branch) =>
      branch.kind === 'remote' ||
      Boolean(branch.remoteName) ||
      Boolean(branch.upstreamRef) ||
      (branch.kind === 'local' && branch.published)
  );
}
