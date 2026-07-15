import { spawn } from 'node:child_process';
import type { GitSnapshot } from '@shared/contracts/git';

const TIMEOUT_MS = 4000;
const MAX_OUTPUT = 2_000_000;

const NOT_A_REPO: GitSnapshot = {
  isRepo: false,
  branch: null,
  detached: false,
  ahead: 0,
  behind: 0,
  changes: 0,
};

export type GitService = {
  snapshot(projectRoot: string): Promise<GitSnapshot>;
};

export function createGitService(): GitService {
  async function snapshot(projectRoot: string): Promise<GitSnapshot> {
    const output = await runGitStatus(projectRoot);
    return output === null ? NOT_A_REPO : parsePorcelain(output);
  }
  return { snapshot };
}

/** Runs `git status` in porcelain-v2 mode; resolves null if git is missing or the dir isn't a repo. */
function runGitStatus(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', ['status', '--porcelain=2', '--branch'], { cwd, shell: false });
    } catch {
      resolve(null);
      return;
    }

    let stdout = '';
    let settled = false;
    const done = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      done(null);
    }, TIMEOUT_MS);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) child.kill();
    });
    child.on('error', () => done(null));
    child.on('close', (code) => done(code === 0 ? stdout : null));
  });
}

export function parsePorcelain(text: string): GitSnapshot {
  let branch: string | null = null;
  let detached = false;
  let ahead = 0;
  let behind = 0;
  let changes = 0;

  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      if (head === '(detached)') {
        detached = true;
        branch = null;
      } else {
        branch = head;
      }
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (
      line.startsWith('1 ') || // changed tracked entry
      line.startsWith('2 ') || // renamed/copied entry
      line.startsWith('u ') || // unmerged (conflict)
      line.startsWith('? ') // untracked
    ) {
      changes += 1;
    }
  }

  return { isRepo: true, branch, detached, ahead, behind, changes };
}
