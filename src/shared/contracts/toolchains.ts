// The three runtimes Bureau can switch (version managers + PATH injection). Only these
// are pinnable in a project's stored config and accepted by the set-active IPC.
export type SwitchableRuntimeKind = 'node' | 'python' | 'flutter';

// Every runtime Bureau surfaces a row for. The switchable three plus a set of
// detect-and-display-only runtimes (system version + expected-version match, no switching).
export type RuntimeKind =
  | SwitchableRuntimeKind
  | 'go'
  | 'rust'
  | 'java'
  | 'ruby'
  | 'php'
  | 'dotnet'
  | 'bun'
  | 'deno'
  | 'elixir'
  | 'erlang'
  | 'kotlin'
  | 'swift'
  | 'zig'
  | 'dart';

export type NodeManager = 'fnm' | 'volta' | 'nvm' | 'system';
export type PythonManager = 'pyenv' | 'venv' | 'system';
export type FlutterManager = 'fvm' | 'flutter';

export type ToolchainConfig = {
  node?: { version: string; manager?: NodeManager };
  python?: { version: string; manager?: PythonManager; venv?: string };
  flutter?: { version: string; manager?: FlutterManager };
};

export type RuntimeProbe = {
  kind: RuntimeKind;
  installed: boolean;
  versions: string[];
  manager: string | null;
};

export type RuntimeRow = {
  kind: RuntimeKind;
  label: string;
  activeVersion: string | null;
  expectedVersion: string | null;
  installedVersions: string[];
  manager: string | null;
  mismatch: boolean;
  missing: boolean;
  installHint: string | null;
  /** Whether Bureau can switch this runtime's version (managers + PATH injection). */
  switchable: boolean;
};

export type ProjectToolchains = {
  projectId: string;
  rows: RuntimeRow[];
};

export type SetActiveVersionRequest = {
  projectId: string;
  kind: SwitchableRuntimeKind;
  version: string;
};

export type ToolchainSettings = {
  preferredNodeManager?: import('./settings').ToolchainsSettings['preferredNodeManager'];
  preferredPythonManager?: import('./settings').ToolchainsSettings['preferredPythonManager'];
  preferredFlutterManager?: import('./settings').ToolchainsSettings['preferredFlutterManager'];
};
