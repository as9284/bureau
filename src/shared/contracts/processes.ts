import type { ProcessDefinition } from './projects';

export type ProcessStatus = 'idle' | 'starting' | 'running' | 'exited' | 'crashed';

export type ProcessRuntime = {
  projectId: string;
  processId: string;
  status: ProcessStatus;
  pid?: number;
  startedAt?: string;
  exitedAt?: string;
  exitCode?: number;
  restartCount: number;
  detectedUrl?: string;
  /** Set true once output matches a readiness signal (Phase 1: first detected URL). */
  ready: boolean;
  /** CPU usage percent (0–100+), sampled while running. */
  cpu?: number;
  /** Resident memory in bytes, sampled while running. */
  memoryBytes?: number;
};

/** Stored definitions joined with their live runtime state. */
export type ProjectProcesses = {
  definitions: ProcessDefinition[];
  runtimes: ProcessRuntime[];
};

export type LogStream = 'stdout' | 'stderr' | 'system';

export type LogLine = {
  seq: number;
  stream: LogStream;
  text: string;
  at: string;
};

/** Pushed to the renderer as processes emit output (batched). */
export type ProcessOutputEvent = {
  projectId: string;
  processId: string;
  lines: LogLine[];
};

/** Pushed to the renderer when a process changes lifecycle state. */
export type ProcessStatusEvent = {
  runtime: ProcessRuntime;
};

export type LogSnapshot = {
  projectId: string;
  processId: string;
  lines: LogLine[];
  /** True if older lines were dropped from the bounded buffer. */
  truncated: boolean;
};

export type ProcessTargetRequest = { projectId: string; processId: string };
