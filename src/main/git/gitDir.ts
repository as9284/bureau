import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolves a repository's real git directory.
 *
 * `<root>/.git` is a directory in an ordinary clone, but in a **linked worktree**
 * or a **submodule** it is a FILE containing `gitdir: <path>`. Probing
 * `<root>/.git/MERGE_HEAD` directly therefore fails with ENOTDIR in those repos,
 * which silently reports "no operation in progress" while a merge/rebase is
 * actually mid-conflict. Operation state (MERGE_HEAD, rebase-merge, BISECT_LOG)
 * lives in the per-worktree gitdir the pointer resolves to, so following it is
 * exactly what `git rev-parse --git-dir` would report.
 *
 * Returns null when the path is not a repository we can resolve.
 */
export async function resolveGitDir(repositoryRoot: string): Promise<string | null> {
  const dotGit = path.join(repositoryRoot, '.git');

  let stats;
  try {
    stats = await fs.stat(dotGit);
  } catch {
    return null;
  }

  if (stats.isDirectory()) return dotGit;
  if (!stats.isFile()) return null;

  let contents: string;
  try {
    contents = await fs.readFile(dotGit, 'utf8');
  } catch {
    return null;
  }

  const match = /^gitdir:\s*(.+)$/m.exec(contents);
  const target = match?.[1]?.trim();
  if (!target) return null;

  // Relative pointers (the common submodule form, e.g. `gitdir: ../.git/modules/x`)
  // resolve against the repository root.
  return path.isAbsolute(target) ? path.normalize(target) : path.resolve(repositoryRoot, target);
}
