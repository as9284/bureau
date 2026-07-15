import type { OkResult, Result } from './errors';

export type ProjectFileKind =
  | 'directory'
  | 'text'
  | 'image'
  | 'binary'
  | 'unsupported'
  | 'symlink';

export type FileEntry = {
  name: string;
  relativePath: string;
  kind: ProjectFileKind;
  size: number;
  modifiedAt: string;
  ignored: boolean;
};

export type FileRevision = {
  hash: string;
  size: number;
  modifiedAtMs: number;
};

export type TextEncoding = 'utf-8' | 'utf-8-bom';
export type LineEnding = 'lf' | 'crlf' | 'cr' | 'mixed' | 'none';

export type TextDocument = {
  relativePath: string;
  content: string;
  encoding: TextEncoding;
  lineEnding: LineEnding;
  revision: FileRevision;
  languageId: string;
  readOnly: boolean;
};

export type ImageDocument = {
  relativePath: string;
  mimeType: string;
  bytes: Uint8Array;
  size: number;
  modifiedAt: string;
};

export type FileSystemEvent = {
  projectId: string;
  type: 'created' | 'changed' | 'deleted' | 'watcher-ready' | 'watcher-error';
  relativePath: string;
  isDirectory: boolean;
  occurredAt: string;
};

export type SearchMatch = {
  relativePath: string;
  line: number;
  column: number;
  preview: string;
};

export type SearchBatch = {
  projectId: string;
  searchId: string;
  matches: SearchMatch[];
  done: boolean;
  truncated: boolean;
  cancelled: boolean;
  visitedFiles: number;
};

export type FileWorkspaceState = {
  projectId: string;
  openPaths: string[];
  activePath: string | null;
  expandedPaths: string[];
  recentPaths: string[];
  pinnedPaths: string[];
  modeByPath: Record<string, 'edit' | 'preview' | 'split'>;
  cursorByPath: Record<string, { line: number; column: number; scrollTop: number }>;
  explorerWidth: number;
  updatedAt: string;
};

export type FileDraft = {
  projectId: string;
  relativePath: string;
  content: string;
  baseRevision: FileRevision | null;
  encoding: TextEncoding;
  lineEnding: Exclude<LineEnding, 'mixed'>;
  updatedAt: string;
};

export type ListDirectoryRequest = {
  projectId: string;
  relativePath: string;
  showIgnored?: boolean;
};
export type FilePathRequest = { projectId: string; relativePath: string };
export type SaveTextRequest = FilePathRequest & {
  content: string;
  expectedRevision: FileRevision | null;
  encoding: TextEncoding;
  lineEnding: Exclude<LineEnding, 'mixed'>;
  force?: boolean;
};
export type CreateEntryRequest = FilePathRequest & { kind: 'file' | 'directory' };
export type RenameEntryRequest = FilePathRequest & { newName: string };
export type MoveEntryRequest = FilePathRequest & { destinationPath: string };
export type DuplicateEntryRequest = FilePathRequest & { destinationPath: string };
export type QuickOpenRequest = { projectId: string; query: string; showIgnored?: boolean };
export type StartSearchRequest = {
  projectId: string;
  searchId: string;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  showIgnored?: boolean;
};
export type CancelSearchRequest = { projectId: string; searchId: string };
export type ExportHtmlRequest = FilePathRequest & { html: string; suggestedName: string };

export type FilesApi = {
  listDirectory(input: ListDirectoryRequest): Promise<Result<{ entries: FileEntry[] }>>;
  readText(input: FilePathRequest): Promise<Result<{ document: TextDocument }>>;
  readImage(input: FilePathRequest): Promise<Result<{ document: ImageDocument }>>;
  saveText(input: SaveTextRequest): Promise<Result<{ revision: FileRevision }>>;
  createEntry(input: CreateEntryRequest): Promise<OkResult>;
  renameEntry(input: RenameEntryRequest): Promise<Result<{ relativePath: string }>>;
  moveEntry(input: MoveEntryRequest): Promise<Result<{ relativePath: string }>>;
  duplicateEntry(input: DuplicateEntryRequest): Promise<Result<{ relativePath: string }>>;
  trashEntry(input: FilePathRequest): Promise<OkResult>;
  quickOpen(input: QuickOpenRequest): Promise<Result<{ entries: FileEntry[]; truncated: boolean }>>;
  startSearch(input: StartSearchRequest): Promise<OkResult>;
  cancelSearch(input: CancelSearchRequest): Promise<OkResult>;
  watchProject(input: { projectId: string }): Promise<OkResult>;
  unwatchProject(input: { projectId: string }): Promise<OkResult>;
  resolveMarkdownAsset(input: FilePathRequest): Promise<Result<{ document: ImageDocument }>>;
  fetchRemoteImage(input: { url: string }): Promise<Result<{ mimeType: string; bytes: Uint8Array }>>;
  openExternal(input: FilePathRequest): Promise<OkResult>;
  reveal(input: FilePathRequest): Promise<OkResult>;
  exportHtml(input: ExportHtmlRequest): Promise<OkResult>;
  exportPdf(input: ExportHtmlRequest): Promise<OkResult>;
  printDocument(input: { html: string }): Promise<OkResult>;
  getWorkspaceState(input: { projectId: string }): Promise<Result<{ state: FileWorkspaceState | null }>>;
  saveWorkspaceState(input: { state: FileWorkspaceState }): Promise<OkResult>;
  putDraft(input: { draft: FileDraft }): Promise<OkResult>;
  removeDraft(input: FilePathRequest): Promise<OkResult>;
  listDrafts(input: { projectId: string }): Promise<Result<{ drafts: FileDraft[] }>>;
  onFileEvents(listener: (event: FileSystemEvent[]) => void): () => void;
  onSearchEvents(listener: (batch: SearchBatch) => void): () => void;
};
