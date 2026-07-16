// Embedded shell sessions: a free interactive shell per project, run in main via node-pty
// and rendered in the Terminal tab. Distinct from `processes` run in terminal mode, which
// are bound to a stored ProcessDefinition.

/**
 * Shells Bureau knows how to launch. The renderer picks an id from this closed set and main
 * maps it to a concrete executable — an executable path never travels over IPC from the
 * renderer, so a session cannot be pointed at an arbitrary binary.
 */
export const SHELL_IDS = [
  'powershell',
  'pwsh',
  'cmd',
  'git-bash',
  'bash',
  'zsh',
  'fish',
  'sh',
] as const;
export type ShellId = (typeof SHELL_IDS)[number];

/** A shell that was found on this machine. */
export type DetectedShell = {
  id: ShellId;
  label: string;
  /** Shown as supporting text; machine text, so the UI renders it mono. */
  executable: string;
};

export type TerminalSessionStatus = 'running' | 'exited';

export type TerminalSession = {
  sessionId: string;
  projectId: string;
  shellId: ShellId;
  /** Defaults to the shell label; user-renamable. */
  title: string;
  /** Project-relative cwd ('.' = the project root); display + mono. */
  cwdLabel: string;
  status: TerminalSessionStatus;
  pid?: number;
  exitCode?: number;
  startedAt: string;
};

export type TerminalSnapshot = {
  projectId: string;
  sessions: TerminalSession[];
  /** Shells detected on this machine, in preference order. Empty = nothing launchable. */
  shells: DetectedShell[];
  /**
   * False when node-pty's native binding could not be loaded for this Electron build.
   * The tab degrades to an error state offering the external terminal instead of
   * breaking the app.
   */
  ptyAvailable: boolean;
};

/**
 * Replay buffer for a session, so leaving and returning to the tab does not blank the
 * terminal. `seq` is the sequence number of the last chunk included; the renderer
 * subscribes first, then drops any live chunk whose seq is <= this one, which closes
 * the gap between subscribing and fetching without relying on timing.
 */
export type TerminalBuffer = {
  sessionId: string;
  data: string;
  seq: number;
  /** True once the oldest output has been dropped past the buffer cap. */
  truncated: boolean;
};

export type TerminalDataEvent = {
  projectId: string;
  sessionId: string;
  data: string;
  seq: number;
};

export type TerminalExitEvent = {
  projectId: string;
  sessionId: string;
  exitCode: number;
};

export type CreateTerminalSessionRequest = {
  projectId: string;
  /** Omitted = the configured default shell, else the first detected one. */
  shellId?: ShellId;
  /**
   * A project-relative nested root to start in. Validated in main against the project's
   * detected `nestedRoots`, so it is an allow-list choice rather than a free path.
   */
  rootRelative?: string;
};

export type TerminalSessionRequest = { projectId: string; sessionId: string };
export type RenameTerminalSessionRequest = TerminalSessionRequest & { title: string };
export type WriteTerminalRequest = TerminalSessionRequest & { data: string };
export type ResizeTerminalRequest = TerminalSessionRequest & { cols: number; rows: number };
