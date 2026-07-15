import { IPC_CHANNELS } from '@shared/contracts/channels';
import type { FilesApi } from '@shared/contracts/files';

type Invoke = <T>(channel: string, arg?: unknown) => Promise<T>;
type Subscribe = <T>(channel: string, listener: (payload: T) => void) => () => void;

export function createFilesBridge(invoke: Invoke, subscribe: Subscribe): FilesApi {
  return Object.freeze({
    listDirectory: (input) => invoke(IPC_CHANNELS.FILES_LIST_DIRECTORY, input),
    readText: (input) => invoke(IPC_CHANNELS.FILES_READ_TEXT, input),
    readImage: (input) => invoke(IPC_CHANNELS.FILES_READ_IMAGE, input),
    saveText: (input) => invoke(IPC_CHANNELS.FILES_SAVE_TEXT, input),
    createEntry: (input) => invoke(IPC_CHANNELS.FILES_CREATE_ENTRY, input),
    renameEntry: (input) => invoke(IPC_CHANNELS.FILES_RENAME_ENTRY, input),
    moveEntry: (input) => invoke(IPC_CHANNELS.FILES_MOVE_ENTRY, input),
    duplicateEntry: (input) => invoke(IPC_CHANNELS.FILES_DUPLICATE_ENTRY, input),
    trashEntry: (input) => invoke(IPC_CHANNELS.FILES_TRASH_ENTRY, input),
    quickOpen: (input) => invoke(IPC_CHANNELS.FILES_QUICK_OPEN, input),
    startSearch: (input) => invoke(IPC_CHANNELS.FILES_START_SEARCH, input),
    cancelSearch: (input) => invoke(IPC_CHANNELS.FILES_CANCEL_SEARCH, input),
    watchProject: (input) => invoke(IPC_CHANNELS.FILES_WATCH_PROJECT, input),
    unwatchProject: (input) => invoke(IPC_CHANNELS.FILES_UNWATCH_PROJECT, input),
    resolveMarkdownAsset: (input) => invoke(IPC_CHANNELS.FILES_RESOLVE_MARKDOWN_ASSET, input),
    fetchRemoteImage: (input) => invoke(IPC_CHANNELS.FILES_FETCH_REMOTE_IMAGE, input),
    openExternal: (input) => invoke(IPC_CHANNELS.FILES_OPEN_EXTERNAL, input),
    reveal: (input) => invoke(IPC_CHANNELS.FILES_REVEAL, input),
    exportHtml: (input) => invoke(IPC_CHANNELS.FILES_EXPORT_HTML, input),
    exportPdf: (input) => invoke(IPC_CHANNELS.FILES_EXPORT_PDF, input),
    printDocument: (input) => invoke(IPC_CHANNELS.FILES_PRINT_DOCUMENT, input),
    getWorkspaceState: (input) => invoke(IPC_CHANNELS.FILES_GET_WORKSPACE_STATE, input),
    saveWorkspaceState: (input) => invoke(IPC_CHANNELS.FILES_SAVE_WORKSPACE_STATE, input),
    putDraft: (input) => invoke(IPC_CHANNELS.FILES_PUT_DRAFT, input),
    removeDraft: (input) => invoke(IPC_CHANNELS.FILES_REMOVE_DRAFT, input),
    listDrafts: (input) => invoke(IPC_CHANNELS.FILES_LIST_DRAFTS, input),
    onFileEvents: (listener) => subscribe(IPC_CHANNELS.FILES_EVENT, listener),
    onSearchEvents: (listener) => subscribe(IPC_CHANNELS.FILES_SEARCH_EVENT, listener),
  });
}
