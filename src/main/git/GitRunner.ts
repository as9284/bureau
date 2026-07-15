import { spawn, type ChildProcess } from 'node:child_process';
import type { GitCommand, GitKillReason, GitResult } from './gitTypes';

export type GitRunner = {
  run(executablePath: string, command: GitCommand): Promise<GitResult>;
  cancel(operationId: string): boolean;
};

const DEFAULT_STDOUT_LIMIT = 16 * 1024 * 1024;
const DEFAULT_STDERR_LIMIT = 1024 * 1024;

export function createGitRunner(): GitRunner {
  const activeByOperationId = new Map<string, ChildProcess>();
  const cancelledOperationIds = new Set<string>();

  function cancel(operationId: string): boolean {
    const child = activeByOperationId.get(operationId);
    if (!child) return false;
    cancelledOperationIds.add(operationId);
    child.kill('SIGTERM');
    return true;
  }

  async function run(executablePath: string, command: GitCommand): Promise<GitResult> {
    const stdoutLimit = command.stdoutLimitBytes ?? DEFAULT_STDOUT_LIMIT;
    const stderrLimit = command.stderrLimitBytes ?? DEFAULT_STDERR_LIMIT;
    const timeoutMs = command.timeoutMs ?? 15000;
    const operationId = command.operationId;

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(executablePath, command.args, {
        cwd: command.cwd,
        shell: false,
        // GIT_TERMINAL_PROMPT=0 stops git from blocking on a credential prompt for an
        // auth-required remote (stdin is otherwise `ignore`), so fetch/push/clone fail fast
        // instead of hanging until the timeout or popping an OS credential dialog.
        env: { ...(command.env ?? process.env), GIT_TERMINAL_PROMPT: '0' },
        stdio: command.stdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      });

      if (operationId) {
        activeByOperationId.set(operationId, child);
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let killReason: GitResult['killed'];

      const timeout = setTimeout(() => {
        killReason = 'timeout';
        child.kill('SIGTERM');
      }, timeoutMs);

      if (command.stdin && child.stdin) {
        // If git exits before consuming stdin, writing emits EPIPE on the stream; without a
        // listener that becomes an unhandled 'error' that can crash the main process.
        child.stdin.on('error', () => undefined);
        child.stdin.end(command.stdin);
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > stdoutLimit) {
          killReason = 'stdout_limit';
          child.kill('SIGTERM');
          return;
        }
        stdoutChunks.push(chunk);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > stderrLimit) {
          killReason = 'stderr_limit';
          child.kill('SIGTERM');
          return;
        }
        stderrChunks.push(chunk);
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        if (operationId) {
          activeByOperationId.delete(operationId);
          cancelledOperationIds.delete(operationId);
        }
        reject(error);
      });

      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        if (operationId) {
          activeByOperationId.delete(operationId);
          if (cancelledOperationIds.has(operationId)) {
            killReason = 'cancelled';
            cancelledOperationIds.delete(operationId);
          }
        }
        const durationMs = Date.now() - startedAt;
        resolve({
          exitCode: exitCode ?? (killReason ? -1 : 0),
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          durationMs,
          killed: killReason as GitKillReason | undefined,
        });
      });
    });
  }

  return { run, cancel };
}
