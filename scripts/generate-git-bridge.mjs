import fs from 'node:fs';

const block = fs.readFileSync('E:/Code/Electron Projects/stargit/src/preload/api.ts', 'utf8');
const gitMatch = block.match(/  git: \{([\s\S]*?)\n  \},\n  system:/);
const ghMatch = block.match(/  github: \{([\s\S]*?)\n  \},\n  repositories:/);
const opMatch = block.match(/  operations: \{([\s\S]*?)\n  \},\n  github:/);
if (!gitMatch || !ghMatch || !opMatch) {
  throw new Error('Failed to extract preload blocks');
}
const gitBody = gitMatch[1].replace(/repoId/g, 'projectId');
const ghBody = ghMatch[1];
const opBody = opMatch[1];

const out = `import { IPC_CHANNELS } from '@shared/contracts/channels';
import type { BureauApiV1 } from '@shared/contracts/api';

type Invoke = <T>(channel: string, arg?: unknown) => Promise<T>;

export function createGitBridge(invoke: Invoke): Pick<BureauApiV1, 'git' | 'github' | 'operations'> {
  return {
    operations: {${opBody}
    },
    github: {${ghBody}
    },
    git: {${gitBody}
      refresh: (input: { projectId: string }) => invoke(IPC_CHANNELS.GIT_REFRESH, input),
      snapshot: (input: { projectId: string }) => invoke(IPC_CHANNELS.GIT_SNAPSHOT, input),
      clone: (input: import('@shared/contracts/lifecycle').CloneRequest) =>
        invoke(IPC_CHANNELS.GIT_CLONE, input),
      initRepository: (input: import('@shared/contracts/lifecycle').InitRepositoryRequest) =>
        invoke(IPC_CHANNELS.GIT_INIT, input),
    },
  };
}
`;

fs.writeFileSync('src/preload/gitBridge.ts', out);
console.log('wrote gitBridge.ts', out.length, 'bytes');
