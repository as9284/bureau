import { describe, expect, it, vi } from 'vitest';
import { createGitQueryService } from '@main/git/GitQueryService';
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
