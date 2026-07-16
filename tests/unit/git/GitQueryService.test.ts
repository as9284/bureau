import { describe, expect, it, vi } from 'vitest';
import { createGitQueryService, parseRemoteVerbose } from '@main/git/GitQueryService';
import type { GitRunner } from '@main/git/GitRunner';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';
const UNTRACKED_DIFF = `diff --git a/notes.txt b/notes.txt
new file mode 100644
index 0000000..9daeafb
--- /dev/null
+++ b/notes.txt
@@ -0,0 +1 @@
+Untracked work\n`;

describe('GitQueryService.getDiff', () => {
  it('returns the generated no-index diff for an untracked file', async () => {
    const runner = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', durationMs: 1 })
        .mockResolvedValueOnce({ exitCode: 1, stdout: UNTRACKED_DIFF, stderr: '', durationMs: 1 }),
    } as unknown as GitRunner;
    const service = createGitQueryService({
      catalogue: {
        get: () => ({ canonicalPath: 'C:/repo' }),
      } as never,
      resolver: {
        resolve: async () => ({
          kind: 'available' as const,
          executablePath: 'git',
          version: { raw: 'git version 2.45.0', major: 2, minor: 45, patch: 0 },
        }),
      },
      runner,
      coordinator: {
        runProjectRead: async <T>(_projectId: string, task: () => Promise<T>): Promise<T> => task(),
      } as never,
    });

    await expect(
      service.getDiff({ projectId: PROJECT_ID, path: 'notes.txt', area: 'unstaged' })
    ).resolves.toEqual({ ok: true, diff: UNTRACKED_DIFF });
    expect(runner.run).toHaveBeenCalledTimes(2);
  });
});

describe('parseRemoteVerbose', () => {
  it('collapses the fetch/push line pair into one entry per remote', () => {
    const stdout = [
      'origin\thttps://github.com/owner/repo.git (fetch)',
      'origin\thttps://github.com/owner/repo.git (push)',
      'upstream\tgit@github.com:upstream/repo.git (fetch)',
      'upstream\tgit@github.com:upstream/repo.git (push)',
      '',
    ].join('\n');

    expect(parseRemoteVerbose(stdout)).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://github.com/owner/repo.git',
        pushUrl: 'https://github.com/owner/repo.git',
      },
      {
        name: 'upstream',
        fetchUrl: 'git@github.com:upstream/repo.git',
        pushUrl: 'git@github.com:upstream/repo.git',
      },
    ]);
  });

  // `remote.<name>.pushurl` makes the two URLs genuinely differ; collapsing them onto
  // the fetch URL would misreport where a push actually goes.
  it('keeps a separately configured push URL', () => {
    const stdout =
      'origin\thttps://github.com/owner/repo.git (fetch)\n' +
      'origin\tgit@github.com:owner/repo.git (push)\n';

    expect(parseRemoteVerbose(stdout)).toEqual([
      {
        name: 'origin',
        fetchUrl: 'https://github.com/owner/repo.git',
        pushUrl: 'git@github.com:owner/repo.git',
      },
    ]);
  });

  // The reason the split is on the tab and not on whitespace: a local path remote on
  // Windows routinely contains spaces, and splitting on /\s+/ would truncate it.
  it('keeps a local path remote containing spaces intact', () => {
    const stdout =
      'backup\tC:\\Users\\Me\\My Repos\\mirror.git (fetch)\n' +
      'backup\tC:\\Users\\Me\\My Repos\\mirror.git (push)\n';

    expect(parseRemoteVerbose(stdout)).toEqual([
      {
        name: 'backup',
        fetchUrl: 'C:\\Users\\Me\\My Repos\\mirror.git',
        pushUrl: 'C:\\Users\\Me\\My Repos\\mirror.git',
      },
    ]);
  });

  it('handles CRLF, no remotes, and a remote missing one of its two lines', () => {
    expect(parseRemoteVerbose('')).toEqual([]);
    expect(parseRemoteVerbose('\n\n')).toEqual([]);
    expect(
      parseRemoteVerbose('origin\thttps://example.com/r.git (fetch)\r\norigin\thttps://example.com/r.git (push)\r\n')
    ).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/r.git', pushUrl: 'https://example.com/r.git' },
    ]);
    // Falls back rather than rendering a blank URL cell.
    expect(parseRemoteVerbose('origin\thttps://example.com/r.git (fetch)\n')).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/r.git', pushUrl: 'https://example.com/r.git' },
    ]);
  });
});
