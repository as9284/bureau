import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stopProcessTree } from '@main/processes/treeKill';

describe('stopProcessTree', () => {
  it('returns immediately when the child already exited during graceful shutdown', async () => {
    const child = { pid: 1234, exitCode: 0, signalCode: null } as ChildProcess;

    await expect(stopProcessTree(child)).resolves.toBeUndefined();
  });
});
