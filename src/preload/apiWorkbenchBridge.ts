import { IPC_CHANNELS } from '@shared/contracts/channels';
import type { ApiWorkbenchApi, Unsubscribe } from '@shared/contracts/api';
import type {
  ApiOAuthStateEvent,
  ApiRunEvent,
  ApiSessionEvent,
} from '@shared/contracts/apiWorkbench';

type Invoke = <T>(channel: string, arg?: unknown) => Promise<T>;
type Subscribe = <T>(channel: string, listener: (payload: T) => void) => Unsubscribe;

export function createApiWorkbenchBridge(invoke: Invoke, subscribe: Subscribe): ApiWorkbenchApi {
  const bridge: ApiWorkbenchApi = {
    listWorkspaces: () => invoke(IPC_CHANNELS.API_LIST_WORKSPACES, {}),
    getStatus: () => invoke(IPC_CHANNELS.API_GET_STATUS, {}),
    getWorkspace: (input) => invoke(IPC_CHANNELS.API_GET_WORKSPACE, input),
    createWorkspace: (input) => invoke(IPC_CHANNELS.API_CREATE_WORKSPACE, input),
    updateWorkspace: (input) => invoke(IPC_CHANNELS.API_UPDATE_WORKSPACE, input),
    deleteWorkspace: (input) => invoke(IPC_CHANNELS.API_DELETE_WORKSPACE, input),
    createCollection: (input) => invoke(IPC_CHANNELS.API_CREATE_COLLECTION, input),
    updateCollection: (input) => invoke(IPC_CHANNELS.API_UPDATE_COLLECTION, input),
    deleteCollection: (input) => invoke(IPC_CHANNELS.API_DELETE_COLLECTION, input),
    saveRequest: (input) => invoke(IPC_CHANNELS.API_SAVE_REQUEST, input),
    deleteRequest: (input) => invoke(IPC_CHANNELS.API_DELETE_REQUEST, input),
    createEnvironment: (input) => invoke(IPC_CHANNELS.API_CREATE_ENVIRONMENT, input),
    updateEnvironment: (input) => invoke(IPC_CHANNELS.API_UPDATE_ENVIRONMENT, input),
    deleteEnvironment: (input) => invoke(IPC_CHANNELS.API_DELETE_ENVIRONMENT, input),
    listSecrets: () => invoke(IPC_CHANNELS.API_LIST_SECRETS, {}),
    saveSecret: (input) => invoke(IPC_CHANNELS.API_SAVE_SECRET, input),
    deleteSecret: (input) => invoke(IPC_CHANNELS.API_DELETE_SECRET, input),
    listHistory: (input) => invoke(IPC_CHANNELS.API_LIST_HISTORY, input),
    getHistoryEntry: (input) => invoke(IPC_CHANNELS.API_GET_HISTORY_ENTRY, input),
    sendRequest: (input) => invoke(IPC_CHANNELS.API_SEND_REQUEST, input),
    cancelRequest: (input) => invoke(IPC_CHANNELS.API_CANCEL_REQUEST, input),
    openStream: (input) => invoke(IPC_CHANNELS.API_OPEN_STREAM, input),
    sendStreamMessage: (input) => invoke(IPC_CHANNELS.API_SEND_STREAM_MESSAGE, input),
    closeStream: (input) => invoke(IPC_CHANNELS.API_CLOSE_STREAM, input),
    setStreamPaused: (input) => invoke(IPC_CHANNELS.API_SET_STREAM_PAUSED, input),
    getStreamSnapshot: (input) => invoke(IPC_CHANNELS.API_GET_STREAM_SNAPSHOT, input),
    introspectGraphql: (input) => invoke(IPC_CHANNELS.API_INTROSPECT_GRAPHQL, input),
    saveTlsProfile: (input) => invoke(IPC_CHANNELS.API_SAVE_TLS_PROFILE, input),
    deleteTlsProfile: (input) => invoke(IPC_CHANNELS.API_DELETE_TLS_PROFILE, input),
    saveOAuthProfile: (input) => invoke(IPC_CHANNELS.API_SAVE_OAUTH_PROFILE, input),
    deleteOAuthProfile: (input) => invoke(IPC_CHANNELS.API_DELETE_OAUTH_PROFILE, input),
    authorizeOAuth: (input) => invoke(IPC_CHANNELS.API_AUTHORIZE_OAUTH, input),
    cancelOAuth: (input) => invoke(IPC_CHANNELS.API_CANCEL_OAUTH, input),
    clearOAuthToken: (input) => invoke(IPC_CHANNELS.API_CLEAR_OAUTH_TOKEN, input),

    inspectImport: (input) => invoke(IPC_CHANNELS.API_INSPECT_IMPORT, input),
    commitImport: (input) => invoke(IPC_CHANNELS.API_COMMIT_IMPORT, input),
    discardImport: (input) => invoke(IPC_CHANNELS.API_DISCARD_IMPORT, input),
    planExport: (input) => invoke(IPC_CHANNELS.API_PLAN_EXPORT, input),
    commitExport: (input) => invoke(IPC_CHANNELS.API_COMMIT_EXPORT, input),

    validateScript: (input) => invoke(IPC_CHANNELS.API_VALIDATE_SCRIPT, input),
    listScriptLocations: (input) => invoke(IPC_CHANNELS.API_LIST_SCRIPT_LOCATIONS, input),
    approveScripts: (input) => invoke(IPC_CHANNELS.API_APPROVE_SCRIPTS, input),
    loadRunData: (input) => invoke(IPC_CHANNELS.API_LOAD_RUN_DATA, input),
    clearRunData: (input) => invoke(IPC_CHANNELS.API_CLEAR_RUN_DATA, input),
    startRun: (input) => invoke(IPC_CHANNELS.API_START_RUN, input),
    cancelRun: (input) => invoke(IPC_CHANNELS.API_CANCEL_RUN, input),
    getRunReport: (input) => invoke(IPC_CHANNELS.API_GET_RUN_REPORT, input),
    exportRunReport: (input) => invoke(IPC_CHANNELS.API_EXPORT_RUN_REPORT, input),

    saveProxyProfile: (input) => invoke(IPC_CHANNELS.API_SAVE_PROXY_PROFILE, input),
    deleteProxyProfile: (input) => invoke(IPC_CHANNELS.API_DELETE_PROXY_PROFILE, input),
    listCookieJars: (input) => invoke(IPC_CHANNELS.API_LIST_COOKIE_JARS, input),
    listCookies: (input) => invoke(IPC_CHANNELS.API_LIST_COOKIES, input),
    deleteCookie: (input) => invoke(IPC_CHANNELS.API_DELETE_COOKIE, input),
    clearCookies: (input) => invoke(IPC_CHANNELS.API_CLEAR_COOKIES, input),
    saveCookie: (input) => invoke(IPC_CHANNELS.API_SAVE_COOKIE, input),
    backupWorkspaces: () => invoke(IPC_CHANNELS.API_BACKUP_WORKSPACES, {}),
    planRestore: () => invoke(IPC_CHANNELS.API_PLAN_RESTORE, {}),
    commitRestore: (input) => invoke(IPC_CHANNELS.API_COMMIT_RESTORE, input),

    onSessionEvent: (listener) =>
      subscribe<ApiSessionEvent>(IPC_CHANNELS.API_SESSION_EVENT, listener),
    onOAuthEvent: (listener) =>
      subscribe<ApiOAuthStateEvent>(IPC_CHANNELS.API_OAUTH_EVENT, listener),
    onRunEvent: (listener) => subscribe<ApiRunEvent>(IPC_CHANNELS.API_RUN_EVENT, listener),
    setDirtyDraftCount: (input) => invoke(IPC_CHANNELS.API_SET_DIRTY_DRAFT_COUNT, input),
  };
  return Object.freeze(bridge);
}
