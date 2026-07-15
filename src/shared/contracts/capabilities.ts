import type { EditorConfig, EditorPreset, TerminalConfig, TerminalPreset } from './settings';
import type { AndroidSdkStatus } from './android';
import type { RuntimeProbe } from './toolchains';

// A single, apiVersion-stamped snapshot of external-tool availability, probed at
// startup and re-verified per operation.
export type AppCapabilities = {
  apiVersion: number;
  platform: string;
  appVersion: string;
  gitAvailable: boolean;
  gitVersion?: string;
  terminalAvailable: boolean;
  availableEditors: EditorPreset[];
  availableTerminals: TerminalPreset[];
  editor: EditorConfig;
  terminal: TerminalConfig;
  android: AndroidSdkStatus;
  runtimes: RuntimeProbe[];
  packageManagers: Array<'npm' | 'pnpm' | 'yarn' | 'bun'>;
};
