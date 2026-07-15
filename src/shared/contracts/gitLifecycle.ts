// Git clone / init request & result types (ported from StarGit).

import type { BureauError } from './errors';

export type CloneRequest = {
  url: string;
  parentDirectory: string;
  folderName: string;
  depth?: number;
  branch?: string;
};

export type CloneProgress = {
  phase: 'counting' | 'compressing' | 'receiving' | 'resolving' | 'checkingOut' | 'done';
  percent?: number;
  message?: string;
};

export type CloneResult =
  | { ok: true; projectId: string; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: BureauError };

export type InitRepositoryRequest = {
  directory: string;
  defaultBranch?: string;
  createReadme?: boolean;
  createGitignore?: boolean;
  gitignoreTemplate?: string;
};

export type InitRepositoryResult =
  | { ok: true; projectId: string; path: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: BureauError };
