import type { BureauError, BureauErrorCode } from '@shared/contracts/errors';

/** Reconstruct a BureauError from either IPC channel (rejected promise or envelope). */
export function toError(err: unknown, operation: string): BureauError {
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'message' in err &&
    typeof (err as BureauError).code === 'string'
  ) {
    return err as BureauError;
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'COMMAND_FAILED', message, operation, retryable: true };
}

const HEADINGS: Partial<Record<BureauErrorCode, string>> = {
  INVALID_SENDER: 'Blocked untrusted request',
  CAPABILITY_MISSING: 'A required tool is missing',
  PROJECT_NOT_FOUND: 'Project not found',
  CONFIG_CORRUPT: 'Project config could not be read',
  CONFIG_INCOMPATIBLE: 'Project config is from a newer Bureau',
  EXECUTABLE_NOT_FOUND: 'Executable not found',
  COMMAND_FAILED: 'Something went wrong',
  API_WORKSPACE_NOT_FOUND: 'API workspace not found',
  API_SECRET_STORAGE_UNAVAILABLE: 'Secret storage unavailable',
  API_IMPORT_INVALID: 'Import could not be read',
  API_SCRIPT_FAILED: 'Script failed',
  API_SCRIPT_LIMIT_EXCEEDED: 'Script exceeded its limits',
  API_SCRIPT_DISABLED: 'Scripts are disabled',
  API_RUN_ACTIVE: 'A run is already in progress',
  API_RUN_NOT_FOUND: 'Run report not found',
  API_RUN_EMPTY: 'Nothing to run',
};

export function errorHeading(error: BureauError): string {
  return HEADINGS[error.code] ?? 'Something went wrong';
}
