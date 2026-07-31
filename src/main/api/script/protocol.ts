import type { ApiScriptPhase } from '@shared/contracts/apiWorkbench';
import type { ScriptLimits } from './limits';

/**
 * The host↔worker wire format. Kept deliberately small and JSON-only: everything the guest can
 * influence crosses this boundary as plain data, never as a function or a shared buffer.
 */

/** What a script can see. Assembled in main; the guest gets a JSON copy, never live objects. */
export type ScriptContext = {
  request: {
    name: string;
    protocol: string;
    method: string;
    /** Post-resolution URL for post-response, still-templated URL for pre-request. */
    url: string;
    headers: Array<{ name: string; value: string }>;
    body?: string;
  };
  response?: {
    ok: boolean;
    status: number;
    statusText: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    body?: string;
    totalMs: number;
  };
  /** Resolved variable bag, including secret values (see §13.2). */
  variables: Record<string, string>;
  /** Names whose values are secret. The host redacts them on the way out. */
  secretNames: string[];
  environmentName?: string;
};

export type ScriptJobMessage = {
  type: 'run';
  jobId: string;
  phase: ApiScriptPhase;
  source: string;
  limits: ScriptLimits;
  context: ScriptContext;
};

export type ScriptWorkerResult = {
  type: 'result';
  jobId: string;
  ok: boolean;
  console: Array<{ level: 'log' | 'warn' | 'error'; text: string; truncated?: boolean }>;
  consoleDropped: number;
  tests: Array<{ name: string; passed: boolean; message?: string }>;
  /** Variable writes to apply as the highest-precedence runtime layer. */
  writes: Array<{ name: string; value: string | null }>;
  error?: {
    /** 'limit' means a deadline or heap bound stopped the script; 'script' is the guest throwing. */
    kind: 'limit' | 'script' | 'protocol';
    message: string;
    line?: number;
  };
};

export type ScriptWorkerFatal = {
  type: 'fatal';
  jobId?: string;
  message: string;
};

export type ScriptWorkerMessage = ScriptWorkerResult | ScriptWorkerFatal;
