export type GitVersion = {
  raw: string;
  major: number;
  minor: number;
  patch: number;
};

export type GitCommand = {
  args: string[];
  cwd?: string;
  stdin?: Buffer | string;
  timeoutMs?: number;
  stdoutLimitBytes?: number;
  stderrLimitBytes?: number;
  env?: Record<string, string | undefined>;
  operationId?: string;
};

export type GitKillReason = 'timeout' | 'stdout_limit' | 'stderr_limit' | 'cancelled';

export type GitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  killed?: GitKillReason;
};

export type GitCapability =
  | { kind: 'available'; executablePath: string; version: GitVersion }
  | { kind: 'notFound' }
  | { kind: 'unsupportedVersion'; executablePath: string; version: GitVersion };
