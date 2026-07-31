import type { ApiScriptPhase } from '@shared/contracts/apiWorkbench';

/**
 * The §13.1 resource table. These are the sandbox's contract with the rest of Bureau: a script
 * cannot run longer, allocate more, log more, or return more than this.
 *
 * `hardDeadlineMs` is the host's own patience. The guest deadline is enforced inside the worker by
 * a QuickJS interrupt handler; the host waits a little longer and then terminates the worker
 * outright, so a wedged worker (or one whose interrupt handler never runs) still cannot hang
 * Bureau. It is deliberately not user-configurable.
 */
export type ScriptLimits = {
  deadlineMs: number;
  hardDeadlineMs: number;
  heapBytes: number;
  consoleEntries: number;
  consoleEntryBytes: number;
  returnBytes: number;
};

const MIB = 1024 * 1024;

const PRE_REQUEST_LIMITS: ScriptLimits = {
  deadlineMs: 500,
  hardDeadlineMs: 2_000,
  heapBytes: 16 * MIB,
  consoleEntries: 100,
  consoleEntryBytes: 8 * 1024,
  returnBytes: 256 * 1024,
};

const POST_RESPONSE_LIMITS: ScriptLimits = {
  deadlineMs: 2_000,
  hardDeadlineMs: 5_000,
  heapBytes: 32 * MIB,
  consoleEntries: 200,
  consoleEntryBytes: 8 * 1024,
  returnBytes: 1 * MIB,
};

export function limitsForPhase(phase: ApiScriptPhase): ScriptLimits {
  return phase === 'pre-request' ? PRE_REQUEST_LIMITS : POST_RESPONSE_LIMITS;
}

/** Largest script source the sandbox accepts, matching the shared Zod bound. */
export const MAX_SCRIPT_SOURCE_BYTES = 100_000;

/**
 * How much of the request/response the guest may see. A 25 MiB response body must not be copied
 * into a 32 MiB heap, so the body handed to a script is a bounded head.
 */
export const MAX_GUEST_BODY_BYTES = 512 * 1024;

/** Per-variable value bound for the guest bag, so one huge variable cannot fill the heap. */
export const MAX_GUEST_VARIABLE_BYTES = 64 * 1024;
