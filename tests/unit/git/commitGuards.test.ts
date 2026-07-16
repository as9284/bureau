import { describe, expect, it, vi } from 'vitest';
import { createGitExtendedMutationService } from '@main/git/GitExtendedMutationService';

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const REVISION = 'rev-1';

function makeService(changedFiles: Array<{ staged: boolean }>) {
  const snapshot = { revision: REVISION, blockedOperation: undefined, changedFiles };
  const runner = { run: vi.fn() };
  return {
    runner,
    service: createGitExtendedMutationService({
      catalogue: { get: () => ({ canonicalPath: 'C:\\repo' }) },
      snapshotCache: { get: () => snapshot, set: vi.fn() },
      resolver: { resolve: async () => ({ kind: 'available', executablePath: 'git' }) },
      runner,
      statusService: { collectSnapshot: vi.fn() },
      coordinator: { runMutation: async (_id: string, fn: () => unknown) => fn() },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  };
}

function commitInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    snapshotRevision: REVISION,
    message: 'a real message',
    ...overrides,
  };
}

// Regression: createAppServices maps `commit` -> commitEnhanced, which shadowed
// GitMutationService.commit and its guards. INVALID_COMMIT_MESSAGE and
// NO_STAGED_CHANGES were live members of the error union but unreachable.
describe('commitEnhanced guards (the live commit path)', () => {
  it('rejects an empty message with INVALID_COMMIT_MESSAGE', async () => {
    const { service, runner } = makeService([{ staged: true }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await service.commitEnhanced(commitInput({ message: '   ' }) as any);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_COMMIT_MESSAGE');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects an over-long message with INVALID_COMMIT_MESSAGE', async () => {
    const { service, runner } = makeService([{ staged: true }]);

    const result = await service.commitEnhanced(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      commitInput({ message: 'x'.repeat(10001) }) as any
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_COMMIT_MESSAGE');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('rejects a commit with nothing staged', async () => {
    const { service, runner } = makeService([{ staged: false }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await service.commitEnhanced(commitInput() as any);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_STAGED_CHANGES');
    expect(runner.run).not.toHaveBeenCalled();
  });

  // `git commit --amend` with nothing staged is legitimate: it rewrites the
  // message only. The old guard did not know about amend.
  it('allows an amend with nothing staged', async () => {
    const { service, runner } = makeService([{ staged: false }]);
    runner.run.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await service.commitEnhanced(commitInput({ amend: true }) as any);

    expect(runner.run).toHaveBeenCalled();
  });
});
