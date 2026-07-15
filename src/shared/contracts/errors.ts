// The closed set of error codes Bureau can surface across the IPC boundary.
// Domain services return `{ ok: false, error: BureauError }`; only bugs throw.
// The renderer maps each code to a heading + recovery message (see renderer/lib/error.ts).

export type BureauErrorCode =
  // Boundary / generic
  | 'INVALID_REQUEST'
  | 'INVALID_SENDER'
  | 'OPERATION_BUSY'
  | 'STALE_STATE'
  | 'CAPABILITY_MISSING'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_FAILED'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'INTERNAL'
  // Projects
  | 'PROJECT_NOT_FOUND'
  | 'DUPLICATE_PROJECT'
  | 'INVALID_PROJECT_PATH'
  | 'CONFIG_CORRUPT'
  | 'CONFIG_INCOMPATIBLE'
  | 'DETECTION_FAILED'
  | 'PERMISSION_DENIED'
  // Processes
  | 'PROCESS_NOT_FOUND'
  | 'EXECUTABLE_NOT_FOUND'
  | 'PROCESS_ALREADY_RUNNING'
  | 'PROCESS_NOT_RUNNING'
  | 'SPAWN_FAILED'
  | 'PROCESS_CRASHED'
  | 'KILL_FAILED'
  | 'CWD_NOT_FOUND'
  | 'PORT_IN_USE'
  // Preview
  | 'PREVIEW_UNREACHABLE'
  | 'PREVIEW_NAV_BLOCKED'
  // Android
  | 'SDK_NOT_FOUND'
  | 'ADB_UNAVAILABLE'
  | 'NO_DEVICES'
  | 'AMBIGUOUS_DEVICE'
  | 'DEVICE_UNAUTHORIZED'
  | 'DEVICE_OFFLINE'
  | 'AVD_NOT_FOUND'
  | 'EMULATOR_LAUNCH_FAILED'
  | 'SCRCPY_NOT_FOUND'
  | 'APK_INSTALL_FAILED'
  | 'APK_UNINSTALL_FAILED'
  // Toolchain
  | 'RUNTIME_NOT_FOUND'
  | 'VERSION_NOT_INSTALLED'
  | 'MANAGER_NOT_FOUND'
  | 'VERSION_MISMATCH'
  // Git (Phase 3)
  | 'GIT_NOT_FOUND'
  | 'GIT_UNSUPPORTED_VERSION'
  | 'NOT_A_WORKTREE'
  | 'BARE_REPOSITORY_UNSUPPORTED'
  | 'DUPLICATE_REPOSITORY'
  | 'SNAPSHOT_STALE'
  | 'PATH_NOT_IN_SNAPSHOT'
  | 'REPOSITORY_BLOCKED'
  | 'NO_UPSTREAM'
  | 'DETACHED_HEAD'
  | 'NO_COMMITS_YET'
  | 'NO_STAGED_CHANGES'
  | 'INVALID_COMMIT_MESSAGE'
  | 'FILE_OUTSIDE_PROJECT'
  | 'FILE_NOT_FOUND'
  | 'FILE_ALREADY_EXISTS'
  | 'FILE_UNSUPPORTED_TYPE'
  | 'FILE_UNSUPPORTED_ENCODING'
  | 'FILE_TOO_LARGE'
  | 'FILE_CONFLICT'
  | 'FILE_MUTATION_FAILED'
  | 'FILE_SEARCH_CANCELLED';

export type BureauError = {
  code: BureauErrorCode;
  message: string;
  operation: string;
  retryable: boolean;
  /** Optional id of the subject the error concerns (project/process/device). */
  subjectId?: string;
  /** Sanitized, length-bounded detail (e.g. subprocess stderr). */
  details?: string;
};

/** Discriminated-union envelope returned by domain services. */
export type Result<T> = ({ ok: true } & T) | { ok: false; error: BureauError };

/** Envelope for operations that either succeed with no payload or fail. */
export type OkResult = { ok: true } | { ok: false; error: BureauError };
