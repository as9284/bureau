import fs from 'node:fs/promises';
import type { GitRunner } from '../git/GitRunner';

export type WorktreeValidation =
  | { kind: 'valid'; root: string }
  | { kind: 'notFound' }
  | { kind: 'notAWorktree' }
  | { kind: 'bare' };

export type RepositoryValidator = {
  validate(executablePath: string, selectedPath: string): Promise<WorktreeValidation>;
};

export function createRepositoryValidator(runner: GitRunner): RepositoryValidator {
  async function validate(
    executablePath: string,
    selectedPath: string
  ): Promise<WorktreeValidation> {
    try {
      await fs.access(selectedPath);
    } catch {
      return { kind: 'notFound' };
    }

    const result = await runner.run(executablePath, {
      args: [
        '-C',
        selectedPath,
        'rev-parse',
        '--show-toplevel',
        '--is-inside-work-tree',
        '--is-bare-repository',
      ],
      timeoutMs: 5000,
      stdoutLimitBytes: 64 * 1024,
      stderrLimitBytes: 64 * 1024,
    });

    if (result.exitCode !== 0) {
      return { kind: 'notAWorktree' };
    }

    const lines = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
    if (lines.length < 3) {
      return { kind: 'notAWorktree' };
    }

    const [toplevel, isInsideWorkTree, isBare] = lines;
    if (isBare === 'true') {
      return { kind: 'bare' };
    }
    if (isInsideWorkTree !== 'true' || !toplevel) {
      return { kind: 'notAWorktree' };
    }

    const realPath = await fs.realpath(toplevel);
    return { kind: 'valid', root: realPath };
  }

  return { validate };
}
