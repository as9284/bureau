import { IPC_CHANNELS } from '@shared/contracts/channels';
import {
  cancelSearchRequestSchema,
  createEntryRequestSchema,
  duplicateEntryRequestSchema,
  exportHtmlRequestSchema,
  filePathRequestSchema,
  listDirectoryRequestSchema,
  moveEntryRequestSchema,
  printDocumentRequestSchema,
  putDraftRequestSchema,
  quickOpenRequestSchema,
  remoteImageRequestSchema,
  renameEntryRequestSchema,
  saveTextRequestSchema,
  saveWorkspaceStateRequestSchema,
  startSearchRequestSchema,
  watchProjectRequestSchema,
  workspaceStateRequestSchema,
} from '@shared/validation/files';
import type { AppServices } from './serviceContracts';

type Register = <T, R>(
  channel: string,
  operation: string,
  handler: (args: T, event: Electron.IpcMainInvokeEvent) => Promise<R>
) => void;

export function registerFileHandlers(services: AppServices, register: Register): void {
  register(IPC_CHANNELS.FILES_LIST_DIRECTORY, 'files.listDirectory', async (args: unknown) => services.files.listDirectory(listDirectoryRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_READ_TEXT, 'files.readText', async (args: unknown) => services.files.readText(filePathRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_READ_IMAGE, 'files.readImage', async (args: unknown) => services.files.readImage(filePathRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_SAVE_TEXT, 'files.saveText', async (args: unknown) => services.files.saveText(saveTextRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_CREATE_ENTRY, 'files.createEntry', async (args: unknown) => services.files.createEntry(createEntryRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_RENAME_ENTRY, 'files.renameEntry', async (args: unknown) => services.files.renameEntry(renameEntryRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_MOVE_ENTRY, 'files.moveEntry', async (args: unknown) => services.files.moveEntry(moveEntryRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_DUPLICATE_ENTRY, 'files.duplicateEntry', async (args: unknown) => services.files.duplicateEntry(duplicateEntryRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_TRASH_ENTRY, 'files.trashEntry', async (args: unknown) => services.files.trashEntry(filePathRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_QUICK_OPEN, 'files.quickOpen', async (args: unknown) => services.files.quickOpen(quickOpenRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_START_SEARCH, 'files.startSearch', async (args: unknown) => services.files.startSearch(startSearchRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_CANCEL_SEARCH, 'files.cancelSearch', async (args: unknown) => services.files.cancelSearch(cancelSearchRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_WATCH_PROJECT, 'files.watchProject', async (args: unknown) => services.files.watchProject(watchProjectRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_UNWATCH_PROJECT, 'files.unwatchProject', async (args: unknown) => services.files.unwatchProject(watchProjectRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_RESOLVE_MARKDOWN_ASSET, 'files.resolveMarkdownAsset', async (args: unknown) => services.files.resolveMarkdownAsset(filePathRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_FETCH_REMOTE_IMAGE, 'files.fetchRemoteImage', async (args: unknown) => services.files.fetchRemoteImage(remoteImageRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_OPEN_EXTERNAL, 'files.openExternal', async (args: unknown) => services.files.openExternal(filePathRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_REVEAL, 'files.reveal', async (args: unknown) => services.files.reveal(filePathRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_EXPORT_HTML, 'files.exportHtml', async (args: unknown) => services.files.exportHtml(exportHtmlRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_EXPORT_PDF, 'files.exportPdf', async (args: unknown) => services.files.exportPdf(exportHtmlRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_PRINT_DOCUMENT, 'files.printDocument', async (args: unknown) => services.files.printDocument(printDocumentRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_GET_WORKSPACE_STATE, 'files.getWorkspaceState', async (args: unknown) => services.files.getWorkspaceState(workspaceStateRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_SAVE_WORKSPACE_STATE, 'files.saveWorkspaceState', async (args: unknown) => services.files.saveWorkspaceState(saveWorkspaceStateRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_PUT_DRAFT, 'files.putDraft', async (args: unknown) => services.files.putDraft(putDraftRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_REMOVE_DRAFT, 'files.removeDraft', async (args: unknown) => services.files.removeDraft(filePathRequestSchema.parse(args)));
  register(IPC_CHANNELS.FILES_LIST_DRAFTS, 'files.listDrafts', async (args: unknown) => services.files.listDrafts(workspaceStateRequestSchema.parse(args)));
}
