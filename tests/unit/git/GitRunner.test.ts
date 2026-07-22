import { describe, it, expect } from 'vitest';
import { createGitRunner } from '../../../src/main/git/GitRunner';
import { createGitExecutableResolver } from '../../../src/main/git/GitExecutableResolver';

describe('GitRunner', () => {
  async function findGit(): Promise<string> {
    const resolver = createGitExecutableResolver();
    const capability = await resolver.resolve();
    if (capability.kind !== 'available') {
      throw new Error('Git is not available for runner tests');
    }
    return capability.executablePath;
  }

  it('runs git --version and returns exit code 0', async () => {
    const git = await findGit();
    const runner = createGitRunner();
    const result = await runner.run(git, { args: ['--version'] });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('git version');
  });

  it('returns non-zero exit code for unknown subcommand', async () => {
    const git = await findGit();
    const runner = createGitRunner();
    const result = await runner.run(git, { args: ['not-a-real-command'] });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('limits stdout when configured', async () => {
    const git = await findGit();
    const runner = createGitRunner();
    const result = await runner.run(git, {
      args: ['--version'],
      stdoutLimitBytes: 1,
    });
    // `git --version` prints and exits at once, so the SIGTERM often lands after the
    // process is already gone and the exit code stays 0. `killed` is what every
    // consumer reads (`assertGitSuccess` checks it before the exit code) and it is
    // set before the kill is attempted, so that is the deterministic assertion.
    expect(result.killed).toBe('stdout_limit');
  });

  it('passes stdin when provided', async () => {
    const git = await findGit();
    const runner = createGitRunner();
    const result = await runner.run(git, {
      args: ['hash-object', '--stdin'],
      stdin: 'hello\n',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^[a-f0-9]{40}$/);
  });
});
