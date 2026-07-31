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
  | 'EMULATOR_GRPC_UNAVAILABLE'
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
  | 'FILE_SEARCH_CANCELLED'
  // API workbench
  | 'API_WORKSPACE_NOT_FOUND'
  | 'API_REQUEST_NOT_FOUND'
  | 'API_ENVIRONMENT_NOT_FOUND'
  | 'API_VARIABLE_UNRESOLVED'
  | 'API_VARIABLE_CYCLE'
  | 'API_DESTINATION_BLOCKED'
  | 'API_DNS_FAILED'
  | 'API_CONNECT_FAILED'
  | 'API_TLS_FAILED'
  | 'API_TIMEOUT'
  | 'API_CANCELLED'
  | 'API_REDIRECT_BLOCKED'
  | 'API_RESPONSE_TOO_LARGE'
  | 'API_PROTOCOL_ERROR'
  | 'API_WEBSOCKET_CLOSED'
  | 'API_SSE_DISCONNECTED'
  | 'API_OAUTH_FAILED'
  | 'API_OAUTH_STATE_MISMATCH'
  | 'API_SECRET_STORAGE_UNAVAILABLE'
  | 'API_SCRIPT_FAILED'
  | 'API_SCRIPT_LIMIT_EXCEEDED'
  | 'API_SCRIPT_DISABLED'
  | 'API_RUN_ACTIVE'
  | 'API_RUN_NOT_FOUND'
  | 'API_RUN_EMPTY'
  | 'API_IMPORT_INVALID'
  | 'API_IMPORT_LIMIT_EXCEEDED'
  | 'API_EXPORT_FAILED';

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
