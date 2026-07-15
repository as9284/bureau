// Project registry + per-project config types.

import type { ToolchainConfig } from './toolchains';

// Single source of truth for the recognised stack tags. Zod enums and the ProjectStack
// type both derive from this so a new tag is added in exactly one place.
export const STACK_TAGS = [
  'node',
  'react-native',
  'flutter',
  'android',
  'python',
  'rust',
  'go',
  'cpp',
  'dotnet',
  'java',
  'ruby',
  'php',
  'elixir',
  'deno',
  'docker',
  'static',
  'git',
] as const;

export type ProjectStack = (typeof STACK_TAGS)[number];

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type TrackedProject = {
  projectId: string;
  name: string;
  path: string;
  canonicalPath: string;
  stack: ProjectStack[];
  addedAt: string;
  lastOpenedAt?: string;
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
  groupIds?: string[];
  /** Whether a committable .bureau/config.json was found in the project. */
  configPresent: boolean;
  /** Set when the folder no longer exists on disk. */
  missing?: boolean;
  /** Nested package roots relative to the project (monorepo). */
  nestedRoots?: string[];
};

export type ProcessRunMode = 'log' | 'terminal';

/** A managed command, stored in the project's committable .bureau/config.json. */
export type ProcessDefinition = {
  id: string;
  label: string;
  command: string;
  args: string[];
  /** Relative to the project root; '.' means the root. */
  cwd: string;
  env: Record<string, string>;
  runMode: ProcessRunMode;
  autoRestart: boolean;
  runOnOpen: boolean;
  /** Optional explicit URL; otherwise Bureau auto-parses one from output. */
  urlPattern?: string;
  /** Optional per-process runtime pin (Phase 2). */
  toolchain?: {
    node?: string;
    python?: string;
    flutter?: string;
  };
};

export type BureauProjectConfig = {
  schemaVersion: 1;
  name: string;
  stack: ProjectStack[];
  packageManager?: PackageManager;
  processes: ProcessDefinition[];
  toolchains?: ToolchainConfig;
};

/** Result of scanning a folder for its stack + suggested runnable commands. */
export type StackDetectionResult = {
  stack: ProjectStack[];
  packageManager?: PackageManager;
  suggestedProcesses: ProcessDefinition[];
  /** Non-fatal issues (e.g. malformed package.json). */
  warnings: string[];
  /** Nested package roots relative to the scanned folder (monorepo). */
  nestedRoots: string[];
};

export type AddProjectRequest = { path: string };
export type ProjectIdRequest = { projectId: string };
export type SaveProcessRequest = { projectId: string; definition: ProcessDefinition };
export type RemoveProcessRequest = { projectId: string; processId: string };
