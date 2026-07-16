import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveGitDir } from './gitDir';

export type BlockedOperationKind =
  'unmerged' | 'merge' | 'rebase' | 'cherryPick' | 'revert' | 'bisect';

export type OperationDetectionResult = {
  blocked: boolean;
  kinds: BlockedOperationKind[];
};

export async function detectBlockedOperations(
  repositoryRoot: string
): Promise<OperationDetectionResult> {
  // Not path.join(root, '.git') — that breaks in linked worktrees/submodules
  // where .git is a file pointing at the real gitdir.
  const gitDir = await resolveGitDir(repositoryRoot);
  if (!gitDir) return { blocked: false, kinds: [] };
  const kinds: BlockedOperationKind[] = [];

  const checks: Array<{ file: string; kind: BlockedOperationKind }> = [
    { file: 'MERGE_HEAD', kind: 'merge' },
    { file: 'REBASE_HEAD', kind: 'rebase' },
    { file: 'CHERRY_PICK_HEAD', kind: 'cherryPick' },
    { file: 'REVERT_HEAD', kind: 'revert' },
  ];

  for (const { file, kind } of checks) {
    if (await fileExists(path.join(gitDir, file))) {
      kinds.push(kind);
    }
  }

  if (await fileExists(path.join(gitDir, 'rebase-apply'))) {
    kinds.push('rebase');
  }
  if (await fileExists(path.join(gitDir, 'rebase-merge'))) {
    kinds.push('rebase');
  }
  if (await fileExists(path.join(gitDir, 'BISECT_LOG'))) {
    kinds.push('bisect');
  }

  return {
    blocked: kinds.length > 0,
    kinds: [...new Set(kinds)],
  };
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
