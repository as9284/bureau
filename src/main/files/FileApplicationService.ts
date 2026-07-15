import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import chokidar, { type FSWatcher } from 'chokidar';
import ignore from 'ignore';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import { toBureauError } from '../ipc/errors';
import type { BureauErrorCode, OkResult, Result } from '@shared/contracts/errors';
import type {
  CancelSearchRequest,
  CreateEntryRequest,
  DuplicateEntryRequest,
  FileDraft,
  FileEntry,
  FileRevision,
  FileSystemEvent,
  FileWorkspaceState,
  ImageDocument,
  ListDirectoryRequest,
  MoveEntryRequest,
  QuickOpenRequest,
  RenameEntryRequest,
  SaveTextRequest,
  SearchBatch,
  StartSearchRequest,
  TextDocument,
} from '@shared/contracts/files';
import { fetchPinned, resolvePublicEndpoint } from './remoteImageFetch';

const EDITABLE_LIMIT = 5 * 1024 * 1024;
const TEXT_LIMIT = 20 * 1024 * 1024;
const IMAGE_LIMIT = 25 * 1024 * 1024;
const SEARCH_FILE_LIMIT = 2 * 1024 * 1024;
const SEARCH_MATCH_LIMIT = 500;
const QUICK_OPEN_LIMIT = 200;
const WALK_LIMIT = 50_000;
const CONVENTIONAL_IGNORES = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  'target',
  '.dart_tool',
  '.gradle',
]);

type WorkspaceFile = { schemaVersion: 1; workspaces: Record<string, FileWorkspaceState> };
type DraftFile = { schemaVersion: 1; drafts: FileDraft[] };

type FilesDependencies = {
  catalogue: ProjectCatalogue;
  workspaceStore: AtomicJsonStore<WorkspaceFile>;
  draftStore: AtomicJsonStore<DraftFile>;
  trashItem(targetPath: string): Promise<void>;
  openPath(targetPath: string): Promise<string>;
  revealPath(targetPath: string): void;
  exportHtml(html: string, suggestedName: string): Promise<OkResult>;
  exportPdf(html: string, suggestedName: string): Promise<OkResult>;
  printDocument(html: string): Promise<OkResult>;
  disposeExports(): void;
};

type SearchJob = { cancelled: boolean };
type WatcherReadiness = {
  promise: Promise<OkResult>;
  resolve(result: OkResult): void;
  settled: boolean;
};

export type FileApplicationService = ReturnType<typeof createFileApplicationService>;

function failure(
  code: BureauErrorCode,
  message: string,
  operation: string,
  subjectId?: string,
  retryable = false
): { ok: false; error: ReturnType<typeof toBureauError> } {
  return { ok: false, error: toBureauError({ code, message, operation, subjectId, retryable }) };
}

export function createFileApplicationService(deps: FilesDependencies) {
  const watchers = new Map<string, FSWatcher>();
  const watcherReadiness = new Map<string, WatcherReadiness>();
  const watcherQueues = new Map<string, FileSystemEvent[]>();
  const watcherTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const searches = new Map<string, SearchJob>();
  const fileListeners = new Set<(events: FileSystemEvent[]) => void>();
  const searchListeners = new Set<(batch: SearchBatch) => void>();
  const mutationQueues = new Map<string, Promise<unknown>>();
  let dirtyFileCount = 0;

  function settleWatcherReadiness(projectId: string, result: OkResult): void {
    const readiness = watcherReadiness.get(projectId);
    if (!readiness || readiness.settled) return;
    readiness.settled = true;
    readiness.resolve(result);
  }

  function projectRoot(projectId: string): string | null {
    return deps.catalogue.get(projectId)?.canonicalPath ?? null;
  }

  function normalizeRelative(input: string): string {
    const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
    return normalized === '.' ? '' : normalized.replace(/\/$/, '');
  }

  function isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  async function resolvePath(
    projectId: string,
    relativeInput: string,
    operation: string,
    options: { allowRoot?: boolean; allowMissing?: boolean } = {}
  ): Promise<Result<{ root: string; absolutePath: string; relativePath: string }>> {
    const rootCandidate = projectRoot(projectId);
    if (!rootCandidate) return failure('PROJECT_NOT_FOUND', 'Project not found.', operation, projectId);
    const relativePath = normalizeRelative(relativeInput);
    const segments = relativePath.split('/').filter(Boolean);
    if (
      (!options.allowRoot && segments.length === 0) ||
      segments.some((segment) => segment === '..' || segment === '.git') ||
      path.isAbsolute(relativeInput) ||
      /^[A-Za-z]:/.test(relativeInput)
    ) {
      return failure('FILE_OUTSIDE_PROJECT', 'That path is outside the accessible project files.', operation, projectId);
    }
    try {
      const root = await fs.realpath(rootCandidate);
      const absolutePath = path.resolve(root, ...segments);
      if (!isContained(root, absolutePath)) {
        return failure('FILE_OUTSIDE_PROJECT', 'That path is outside the accessible project files.', operation, projectId);
      }
      let existing = absolutePath;
      if (options.allowMissing) {
        while (existing !== root) {
          try {
            await fs.lstat(existing);
            break;
          } catch {
            existing = path.dirname(existing);
          }
        }
      }
      const real = await fs.realpath(existing);
      if (!isContained(root, real)) {
        return failure('FILE_OUTSIDE_PROJECT', 'Symlink traversal outside the project is blocked.', operation, projectId);
      }
      if (existing !== root) {
        const stat = await fs.lstat(existing);
        if (stat.isSymbolicLink()) {
          return failure('FILE_OUTSIDE_PROJECT', 'Symlinks are visible but cannot be traversed or edited.', operation, projectId);
        }
      }
      return { ok: true, root, absolutePath, relativePath };
    } catch (error) {
      if (options.allowMissing && error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return failure('FILE_NOT_FOUND', 'The parent path does not exist.', operation, projectId);
      }
      return failure('FILE_NOT_FOUND', 'The file or directory no longer exists.', operation, projectId);
    }
  }

  // Compiled .gitignore matchers keyed by absolute path, validated by mtime so
  // edits invalidate lazily. Re-reading and re-parsing every ancestor .gitignore
  // for every entry, on every listing and every walk, was the dominant cost when
  // opening the Files workspace on a large repo. A null entry is a negative
  // cache (no .gitignore at that path).
  const gitignoreCache = new Map<
    string,
    { mtimeMs: number; matcher: ReturnType<typeof ignore> } | null
  >();

  async function loadGitignoreMatcher(
    absoluteDir: string
  ): Promise<ReturnType<typeof ignore> | null> {
    const gitignorePath = path.join(absoluteDir, '.gitignore');
    try {
      const stat = await fs.stat(gitignorePath);
      const cached = gitignoreCache.get(gitignorePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) return cached.matcher;
      const rules = await fs.readFile(gitignorePath, 'utf8');
      const matcher = ignore().add(rules);
      gitignoreCache.set(gitignorePath, { mtimeMs: stat.mtimeMs, matcher });
      return matcher;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        gitignoreCache.set(gitignorePath, null);
        return null;
      }
      throw error;
    }
  }

  function invalidateGitignore(root: string, relativePath: string): void {
    if (path.basename(relativePath) !== '.gitignore') return;
    const parts = normalizeRelative(relativePath).split('/').filter(Boolean);
    gitignoreCache.delete(path.join(root, ...parts));
  }

  async function ignored(root: string, relativePath: string): Promise<boolean> {
    const parts = normalizeRelative(relativePath).split('/').filter(Boolean);
    if (parts.some((part) => part === '.git')) return true;
    if (parts.some((part) => CONVENTIONAL_IGNORES.has(part))) return true;
    for (let depth = 0; depth <= Math.max(0, parts.length - 1); depth += 1) {
      const matcher = await loadGitignoreMatcher(path.join(root, ...parts.slice(0, depth)));
      if (matcher) {
        const subject = parts.slice(depth).join('/');
        if (subject && matcher.ignores(subject)) return true;
      }
    }
    return false;
  }

  // A per-directory predicate: load each ancestor .gitignore once (cached), then
  // test every child in memory — instead of an async .gitignore walk per child.
  async function directoryIgnoreFilter(
    root: string,
    dirRelative: string
  ): Promise<(childName: string) => boolean> {
    const dirParts = normalizeRelative(dirRelative).split('/').filter(Boolean);
    const dirIgnored = dirParts.some((part) => part === '.git' || CONVENTIONAL_IGNORES.has(part));
    const matchers: Array<{ depth: number; matcher: ReturnType<typeof ignore> }> = [];
    for (let depth = 0; depth <= dirParts.length; depth += 1) {
      const matcher = await loadGitignoreMatcher(path.join(root, ...dirParts.slice(0, depth)));
      if (matcher) matchers.push({ depth, matcher });
    }
    return (childName: string): boolean => {
      if (dirIgnored) return true;
      if (childName === '.git' || CONVENTIONAL_IGNORES.has(childName)) return true;
      for (const { depth, matcher } of matchers) {
        if (matcher.ignores([...dirParts.slice(depth), childName].join('/'))) return true;
      }
      return false;
    };
  }

  const imageTypes: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  };

  function languageId(relativePath: string): string {
    const name = path.basename(relativePath).toLowerCase();
    const ext = path.extname(name);
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'javascript';
    if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) return 'typescript';
    if (['.json', '.jsonc'].includes(ext) || ['package-lock.json', 'tsconfig.json'].includes(name)) return 'json';
    if (['.md', '.mdx', '.markdown'].includes(ext)) return 'markdown';
    if (['.html', '.htm'].includes(ext)) return 'html';
    if (['.css', '.scss', '.less'].includes(ext)) return ext.slice(1);
    if (ext === '.py') return 'python';
    if (['.sh', '.bash', '.zsh'].includes(ext)) return 'shell';
    if (['.ps1', '.psm1'].includes(ext)) return 'powershell';
    if (['.yml', '.yaml'].includes(ext)) return 'yaml';
    if (ext === '.toml') return 'toml';
    if (['.xml', '.svg'].includes(ext)) return 'xml';
    if (ext === '.sql') return 'sql';
    if (ext === '.java') return 'java';
    if (['.kt', '.kts'].includes(ext)) return 'kotlin';
    if (ext === '.dart') return 'dart';
    if (['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp'].includes(ext)) return 'cpp';
    if (ext === '.cs') return 'csharp';
    if (ext === '.rs') return 'rust';
    if (ext === '.go') return 'go';
    if (ext === '.php') return 'php';
    if (ext === '.rb') return 'ruby';
    return 'plaintext';
  }

  async function revision(buffer: Uint8Array, stat?: { size: number; mtimeMs: number }): Promise<FileRevision> {
    return {
      hash: createHash('sha256').update(buffer).digest('hex'),
      size: stat?.size ?? buffer.byteLength,
      modifiedAtMs: stat?.mtimeMs ?? Date.now(),
    };
  }

  function lineEndingOf(content: string): TextDocument['lineEnding'] {
    const crlf = (content.match(/\r\n/g) ?? []).length;
    const withoutCrlf = content.replace(/\r\n/g, '');
    const lf = (withoutCrlf.match(/\n/g) ?? []).length;
    const cr = (withoutCrlf.match(/\r/g) ?? []).length;
    const kinds = [crlf, lf, cr].filter((count) => count > 0).length;
    if (kinds > 1) return 'mixed';
    if (crlf) return 'crlf';
    if (lf) return 'lf';
    if (cr) return 'cr';
    return 'none';
  }

  async function classifyRegularFile(absolutePath: string, fileName: string): Promise<FileEntry['kind']> {
    if (imageTypes[path.extname(fileName).toLowerCase()]) return 'image';
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(absolutePath, 'r');
      const sample = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
      const bytes = sample.subarray(0, bytesRead);
      if (bytes.includes(0)) return 'binary';
      const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
      return 'text';
    } catch {
      return 'unsupported';
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async function listDirectory(input: ListDirectoryRequest): Promise<Result<{ entries: FileEntry[] }>> {
    const resolved = await resolvePath(input.projectId, input.relativePath, 'files.listDirectory', { allowRoot: true });
    if (!resolved.ok) return resolved;
    try {
      const children = await fs.readdir(resolved.absolutePath, { withFileTypes: true });
      const isChildIgnored = await directoryIgnoreFilter(resolved.root, resolved.relativePath);
      const entries = await Promise.all(children.map(async (child): Promise<FileEntry | null> => {
        if (child.name === '.git') return null;
        const relativePath = normalizeRelative([resolved.relativePath, child.name].filter(Boolean).join('/'));
        const isIgnored = isChildIgnored(child.name);
        if (isIgnored && !input.showIgnored) return null;
        const absolute = path.join(resolved.absolutePath, child.name);
        const stat = await fs.lstat(absolute);
        const kind = stat.isSymbolicLink()
          ? 'symlink'
          : stat.isDirectory()
            ? 'directory'
            : await classifyRegularFile(absolute, child.name);
        return { name: child.name, relativePath, kind, size: stat.size, modifiedAt: stat.mtime.toISOString(), ignored: isIgnored };
      }));
      return {
        ok: true,
        entries: entries.filter((entry): entry is FileEntry => entry !== null).sort((a, b) =>
          a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : b.kind === 'directory' ? 1 : a.name.localeCompare(b.name)
        ),
      };
    } catch {
      return failure('FILE_MUTATION_FAILED', 'The directory could not be read.', 'files.listDirectory', input.projectId, true);
    }
  }

  async function readText(input: { projectId: string; relativePath: string }): Promise<Result<{ document: TextDocument }>> {
    const resolved = await resolvePath(input.projectId, input.relativePath, 'files.readText');
    if (!resolved.ok) return resolved;
    try {
      const stat = await fs.lstat(resolved.absolutePath);
      if (!stat.isFile()) return failure('FILE_UNSUPPORTED_TYPE', 'Only regular files can be opened.', 'files.readText', input.projectId);
      if (stat.size > TEXT_LIMIT) return failure('FILE_TOO_LARGE', 'This text file exceeds the 20 MiB viewer limit.', 'files.readText', input.projectId);
      const buffer = await fs.readFile(resolved.absolutePath);
      if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
        return failure('FILE_UNSUPPORTED_TYPE', 'This appears to be a binary file.', 'files.readText', input.projectId);
      }
      const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? buffer.subarray(3) : buffer);
      } catch {
        return failure('FILE_UNSUPPORTED_ENCODING', 'Only UTF-8 text files can be edited.', 'files.readText', input.projectId);
      }
      return {
        ok: true,
        document: {
          relativePath: resolved.relativePath,
          content,
          encoding: hasBom ? 'utf-8-bom' : 'utf-8',
          lineEnding: lineEndingOf(content),
          revision: await revision(buffer, stat),
          languageId: languageId(resolved.relativePath),
          readOnly: stat.size > EDITABLE_LIMIT,
        },
      };
    } catch {
      return failure('FILE_NOT_FOUND', 'The file no longer exists.', 'files.readText', input.projectId);
    }
  }

  async function readImage(input: { projectId: string; relativePath: string }): Promise<Result<{ document: ImageDocument }>> {
    const resolved = await resolvePath(input.projectId, input.relativePath, 'files.readImage');
    if (!resolved.ok) return resolved;
    const mimeType = imageTypes[path.extname(resolved.relativePath).toLowerCase()];
    if (!mimeType) return failure('FILE_UNSUPPORTED_TYPE', 'This image format is not supported.', 'files.readImage', input.projectId);
    try {
      const stat = await fs.lstat(resolved.absolutePath);
      if (stat.size > IMAGE_LIMIT) return failure('FILE_TOO_LARGE', 'This image exceeds the 25 MiB viewer limit.', 'files.readImage', input.projectId);
      return { ok: true, document: { relativePath: resolved.relativePath, mimeType, bytes: await fs.readFile(resolved.absolutePath), size: stat.size, modifiedAt: stat.mtime.toISOString() } };
    } catch {
      return failure('FILE_NOT_FOUND', 'The image no longer exists.', 'files.readImage', input.projectId);
    }
  }

  async function serializeMutation<T>(projectId: string, task: () => Promise<T>): Promise<T> {
    const previous = mutationQueues.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    mutationQueues.set(projectId, next);
    try { return await next; } finally { if (mutationQueues.get(projectId) === next) mutationQueues.delete(projectId); }
  }

  async function saveText(input: SaveTextRequest): Promise<Result<{ revision: FileRevision }>> {
    return serializeMutation(input.projectId, async () => {
      const resolved = await resolvePath(input.projectId, input.relativePath, 'files.saveText');
      if (!resolved.ok) return resolved;
      try {
        const current = await fs.readFile(resolved.absolutePath);
        const stat = await fs.stat(resolved.absolutePath);
        const currentRevision = await revision(current, stat);
        if (!input.force && (!input.expectedRevision || currentRevision.hash !== input.expectedRevision.hash || currentRevision.modifiedAtMs !== input.expectedRevision.modifiedAtMs)) {
          return failure('FILE_CONFLICT', 'The file changed on disk. Review the conflict before saving.', 'files.saveText', input.projectId);
        }
        const newline = input.lineEnding === 'crlf' ? '\r\n' : input.lineEnding === 'cr' ? '\r' : '\n';
        const normalized = input.content.replace(/\r\n|\r|\n/g, newline);
        const body = Buffer.from(normalized, 'utf8');
        const bytes = input.encoding === 'utf-8-bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
        if (bytes.length > EDITABLE_LIMIT) return failure('FILE_TOO_LARGE', 'The edited file exceeds the 5 MiB save limit.', 'files.saveText', input.projectId);
        const tempPath = path.join(path.dirname(resolved.absolutePath), `.bureau-${path.basename(resolved.absolutePath)}-${Date.now()}.tmp`);
        const handle = await fs.open(tempPath, 'wx');
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        try { await fs.rename(tempPath, resolved.absolutePath); } catch (error) { await fs.rm(tempPath, { force: true }); throw error; }
        const savedStat = await fs.stat(resolved.absolutePath);
        return { ok: true, revision: await revision(bytes, savedStat) };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return failure('FILE_NOT_FOUND', 'The file was deleted.', 'files.saveText', input.projectId);
        return failure('FILE_MUTATION_FAILED', 'The file could not be saved.', 'files.saveText', input.projectId, true);
      }
    });
  }

  function validName(name: string): boolean {
    if (!name || /[<>:"/\\|?*\0]/.test(name) || /[ .]$/.test(name)) return false;
    return !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name);
  }

  async function destination(input: { projectId: string; relativePath: string }, operation: string) {
    if (!validName(path.basename(normalizeRelative(input.relativePath)))) return failure('INVALID_REQUEST', 'That name is not valid on supported platforms.', operation, input.projectId);
    const resolved = await resolvePath(input.projectId, input.relativePath, operation, { allowMissing: true });
    if (!resolved.ok) return resolved;
    try { await fs.lstat(resolved.absolutePath); return failure('FILE_ALREADY_EXISTS', 'A file or folder already exists at that location.', operation, input.projectId); } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) return failure('FILE_MUTATION_FAILED', 'The destination could not be checked.', operation, input.projectId);
    }
    return resolved;
  }

  async function createEntry(input: CreateEntryRequest): Promise<OkResult> {
    return serializeMutation(input.projectId, async () => {
      const target = await destination(input, 'files.createEntry');
      if (!target.ok) return target;
      try {
        if (input.kind === 'directory') await fs.mkdir(target.absolutePath);
        else await fs.writeFile(target.absolutePath, '', { flag: 'wx' });
        return { ok: true };
      } catch { return failure('FILE_MUTATION_FAILED', 'The entry could not be created.', 'files.createEntry', input.projectId); }
    });
  }

  async function renameEntry(input: RenameEntryRequest): Promise<Result<{ relativePath: string }>> {
    if (!validName(input.newName)) return failure('INVALID_REQUEST', 'That name is not valid on supported platforms.', 'files.renameEntry', input.projectId);
    const parent = path.posix.dirname(normalizeRelative(input.relativePath));
    const destinationPath = parent === '.' ? input.newName : `${parent}/${input.newName}`;
    return moveEntry({ projectId: input.projectId, relativePath: input.relativePath, destinationPath }, 'files.renameEntry');
  }

  async function moveEntry(input: MoveEntryRequest, operation = 'files.moveEntry'): Promise<Result<{ relativePath: string }>> {
    return serializeMutation(input.projectId, async () => {
      const source = await resolvePath(input.projectId, input.relativePath, operation);
      if (!source.ok) return source;
      const target = await destination({ projectId: input.projectId, relativePath: input.destinationPath }, operation);
      if (!target.ok) return target;
      if (isContained(source.absolutePath, target.absolutePath)) return failure('INVALID_REQUEST', 'A folder cannot be moved into itself.', operation, input.projectId);
      try { await fs.rename(source.absolutePath, target.absolutePath); return { ok: true, relativePath: target.relativePath }; }
      catch { return failure('FILE_MUTATION_FAILED', 'The entry could not be moved.', operation, input.projectId); }
    });
  }

  async function duplicateEntry(input: DuplicateEntryRequest): Promise<Result<{ relativePath: string }>> {
    return serializeMutation(input.projectId, async () => {
      const source = await resolvePath(input.projectId, input.relativePath, 'files.duplicateEntry');
      if (!source.ok) return source;
      const target = await destination({ projectId: input.projectId, relativePath: input.destinationPath }, 'files.duplicateEntry');
      if (!target.ok) return target;
      try { await fs.cp(source.absolutePath, target.absolutePath, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true }); return { ok: true, relativePath: target.relativePath }; }
      catch { return failure('FILE_MUTATION_FAILED', 'The entry could not be duplicated.', 'files.duplicateEntry', input.projectId); }
    });
  }

  async function trashEntry(input: { projectId: string; relativePath: string }): Promise<OkResult> {
    return serializeMutation(input.projectId, async () => {
      const resolved = await resolvePath(input.projectId, input.relativePath, 'files.trashEntry');
      if (!resolved.ok) return resolved;
      try { await deps.trashItem(resolved.absolutePath); return { ok: true }; }
      catch { return failure('FILE_MUTATION_FAILED', 'The entry could not be moved to the OS trash.', 'files.trashEntry', input.projectId); }
    });
  }

  async function walk(projectId: string, showIgnored: boolean, visit: (entry: FileEntry, absolutePath: string) => Promise<boolean | void>): Promise<{ truncated: boolean; visited: number }> {
    const rootResult = await resolvePath(projectId, '', 'files.walk', { allowRoot: true });
    if (!rootResult.ok) return { truncated: false, visited: 0 };
    const queue = [''];
    let visited = 0;
    while (queue.length && visited < WALK_LIMIT) {
      const parent = queue.shift() ?? '';
      let children: Dirent<string>[];
      try { children = await fs.readdir(path.join(rootResult.root, ...parent.split('/').filter(Boolean)), { withFileTypes: true }); } catch { continue; }
      for (const child of children) {
        const relativePath = [parent, child.name].filter(Boolean).join('/');
        if (child.name === '.git') continue;
        const isIgnored = await ignored(rootResult.root, relativePath);
        if (isIgnored && !showIgnored) continue;
        const absolutePath = path.join(rootResult.root, ...relativePath.split('/'));
        const stat = await fs.lstat(absolutePath).catch(() => null);
        if (!stat || stat.isSymbolicLink()) continue;
        visited += 1;
        const entry: FileEntry = {
          name: child.name,
          relativePath,
          kind: stat.isDirectory() ? 'directory' : await classifyRegularFile(absolutePath, child.name),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          ignored: isIgnored,
        };
        const stop = await visit(entry, absolutePath);
        if (stop) return { truncated: true, visited };
        if (stat.isDirectory()) queue.push(relativePath);
        if (visited >= WALK_LIMIT) break;
      }
    }
    return { truncated: queue.length > 0, visited };
  }

  async function quickOpen(input: QuickOpenRequest): Promise<Result<{ entries: FileEntry[]; truncated: boolean }>> {
    const needle = input.query.toLocaleLowerCase();
    const entries: FileEntry[] = [];
    const result = await walk(input.projectId, input.showIgnored ?? false, async (entry) => {
      if (entry.kind !== 'directory' && entry.relativePath.toLocaleLowerCase().includes(needle)) entries.push(entry);
      return entries.length >= QUICK_OPEN_LIMIT;
    });
    return { ok: true, entries, truncated: result.truncated || entries.length >= QUICK_OPEN_LIMIT };
  }

  async function startSearch(input: StartSearchRequest): Promise<OkResult> {
    const key = `${input.projectId}:${input.searchId}`;
    searches.set(key, { cancelled: false });
    void (async () => {
      const matches: SearchBatch['matches'] = [];
      let truncated = false;
      const walkResult = await walk(input.projectId, input.showIgnored ?? false, async (entry, absolutePath) => {
        const job = searches.get(key);
        if (!job || job.cancelled) return true;
        if (entry.kind !== 'text' || entry.size > SEARCH_FILE_LIMIT) return;
        const buffer = await fs.readFile(absolutePath).catch(() => null);
        if (!buffer || buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) return;
        let content: string;
        try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { return; }
        const query = input.caseSensitive ? input.query : input.query.toLocaleLowerCase();
        const lines = content.split(/\r\n|\r|\n/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const source = input.caseSensitive ? lines[lineIndex] : lines[lineIndex].toLocaleLowerCase();
          let from = 0;
          while (from <= source.length) {
            const index = source.indexOf(query, from);
            if (index < 0) break;
            const before = index === 0 || !/[\p{L}\p{N}_]/u.test(source[index - 1]);
            const afterIndex = index + query.length;
            const after = afterIndex >= source.length || !/[\p{L}\p{N}_]/u.test(source[afterIndex]);
            if (!input.wholeWord || (before && after)) matches.push({ relativePath: entry.relativePath, line: lineIndex + 1, column: index + 1, preview: lines[lineIndex].slice(0, 500) });
            if (matches.length >= SEARCH_MATCH_LIMIT) { truncated = true; return true; }
            from = index + Math.max(1, query.length);
          }
        }
        if (matches.length >= 50) {
          const batch = matches.splice(0, matches.length);
          for (const listener of searchListeners) listener({ projectId: input.projectId, searchId: input.searchId, matches: batch, done: false, truncated: false, cancelled: false, visitedFiles: 0 });
        }
      });
      const job = searches.get(key);
      const cancelled = !job || job.cancelled;
      for (const listener of searchListeners) listener({ projectId: input.projectId, searchId: input.searchId, matches, done: true, truncated: truncated || walkResult.truncated, cancelled, visitedFiles: walkResult.visited });
      searches.delete(key);
    })();
    return { ok: true };
  }

  async function cancelSearch(input: CancelSearchRequest): Promise<OkResult> {
    const job = searches.get(`${input.projectId}:${input.searchId}`);
    if (job) job.cancelled = true;
    return { ok: true };
  }

  function queueWatcherEvent(event: FileSystemEvent): void {
    const queue = watcherQueues.get(event.projectId) ?? [];
    queue.push(event);
    watcherQueues.set(event.projectId, queue);
    if (watcherTimers.has(event.projectId)) return;
    watcherTimers.set(event.projectId, setTimeout(() => {
      watcherTimers.delete(event.projectId);
      const events = watcherQueues.get(event.projectId) ?? [];
      watcherQueues.delete(event.projectId);
      if (events.length) for (const listener of fileListeners) listener(events);
    }, 80));
  }

  async function watchProject(input: { projectId: string }): Promise<OkResult> {
    if (watchers.has(input.projectId)) return watcherReadiness.get(input.projectId)?.promise ?? { ok: true };
    const rootResult = await resolvePath(input.projectId, '', 'files.watchProject', { allowRoot: true });
    if (!rootResult.ok) return rootResult;
    let resolveReadiness!: (result: OkResult) => void;
    const readiness: WatcherReadiness = {
      promise: new Promise<OkResult>((resolve) => { resolveReadiness = resolve; }),
      resolve: (result) => resolveReadiness(result),
      settled: false,
    };
    watcherReadiness.set(input.projectId, readiness);
    // Prune the initial recursive scan with the project's root .gitignore (plus
    // the conventional set) so heavy ignored trees — node_modules, .venv,
    // __pycache__, bin/obj, build output — are never walked or watched. Without
    // this the watcher walks the entire tree and blocks the workspace on ready.
    const rootIgnore = await loadGitignoreMatcher(rootResult.root).catch(() => null);
    const scanIgnored = (candidate: string): boolean => {
      if (path.basename(candidate) === '.git') return true;
      const relative = path.relative(rootResult.root, candidate);
      if (!relative || relative.startsWith('..')) return false;
      const segments = relative.split(path.sep);
      if (segments.some((part) => CONVENTIONAL_IGNORES.has(part))) return true;
      return Boolean(rootIgnore && rootIgnore.ignores(segments.join('/')));
    };
    let watcher: FSWatcher;
    try {
      watcher = chokidar.watch(rootResult.root, { followSymlinks: false, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }, ignored: scanIgnored });
    } catch {
      watcherReadiness.delete(input.projectId);
      return failure('COMMAND_FAILED', 'File watching could not be initialized.', 'files.watchProject', input.projectId, true);
    }
    const emit = async (type: FileSystemEvent['type'], absolutePath: string, isDirectory: boolean) => {
      const relativePath = normalizeRelative(path.relative(rootResult.root, absolutePath));
      if (!relativePath || relativePath.split('/').includes('.git')) return;
      invalidateGitignore(rootResult.root, relativePath);
      if (await ignored(rootResult.root, relativePath)) return;
      queueWatcherEvent({ projectId: input.projectId, type, relativePath, isDirectory, occurredAt: new Date().toISOString() });
    };
    watcher.on('add', (p) => { void emit('created', p, false); }).on('addDir', (p) => { void emit('created', p, true); }).on('change', (p) => { void emit('changed', p, false); }).on('unlink', (p) => { void emit('deleted', p, false); }).on('unlinkDir', (p) => { void emit('deleted', p, true); }).on('ready', () => {
      settleWatcherReadiness(input.projectId, { ok: true });
      queueWatcherEvent({ projectId: input.projectId, type: 'watcher-ready', relativePath: '', isDirectory: true, occurredAt: new Date().toISOString() });
    }).on('error', () => {
      const failedDuringStartup = !readiness.settled;
      settleWatcherReadiness(input.projectId, failure('COMMAND_FAILED', 'File watching could not be initialized.', 'files.watchProject', input.projectId, true));
      queueWatcherEvent({ projectId: input.projectId, type: 'watcher-error', relativePath: '', isDirectory: true, occurredAt: new Date().toISOString() });
      if (failedDuringStartup) {
        watchers.delete(input.projectId);
        watcherReadiness.delete(input.projectId);
        void watcher.close();
      }
    });
    watchers.set(input.projectId, watcher);
    return readiness.promise;
  }

  async function unwatchProject(input: { projectId: string }): Promise<OkResult> {
    const watcher = watchers.get(input.projectId);
    watchers.delete(input.projectId);
    settleWatcherReadiness(input.projectId, failure('COMMAND_FAILED', 'File watching was stopped before initialization completed.', 'files.watchProject', input.projectId, true));
    watcherReadiness.delete(input.projectId);
    if (watcher) await watcher.close();
    return { ok: true };
  }

  async function getWorkspaceState(input: { projectId: string }): Promise<Result<{ state: FileWorkspaceState | null }>> {
    return { ok: true, state: deps.workspaceStore.read().workspaces[input.projectId] ?? null };
  }
  async function saveWorkspaceState(input: { state: FileWorkspaceState }): Promise<OkResult> {
    await deps.workspaceStore.update((current) => ({ ...current, workspaces: { ...current.workspaces, [input.state.projectId]: input.state } }));
    return { ok: true };
  }
  async function putDraft(input: { draft: FileDraft }): Promise<OkResult> {
    await deps.draftStore.update((current) => ({ ...current, drafts: [...current.drafts.filter((draft) => !(draft.projectId === input.draft.projectId && draft.relativePath === input.draft.relativePath)), input.draft] }));
    return { ok: true };
  }
  async function removeDraft(input: { projectId: string; relativePath: string }): Promise<OkResult> {
    await deps.draftStore.update((current) => ({ ...current, drafts: current.drafts.filter((draft) => !(draft.projectId === input.projectId && draft.relativePath === input.relativePath)) }));
    return { ok: true };
  }
  async function listDrafts(input: { projectId: string }): Promise<Result<{ drafts: FileDraft[] }>> {
    return { ok: true, drafts: deps.draftStore.read().drafts.filter((draft) => draft.projectId === input.projectId) };
  }

  async function openExternal(input: { projectId: string; relativePath: string }): Promise<OkResult> {
    const resolved = await resolvePath(input.projectId, input.relativePath, 'files.openExternal');
    if (!resolved.ok) return resolved;
    const message = await deps.openPath(resolved.absolutePath);
    return message ? failure('COMMAND_FAILED', 'The file could not be opened externally.', 'files.openExternal', input.projectId) : { ok: true };
  }
  async function reveal(input: { projectId: string; relativePath: string }): Promise<OkResult> {
    const resolved = await resolvePath(input.projectId, input.relativePath, 'files.reveal');
    if (!resolved.ok) return resolved;
    deps.revealPath(resolved.absolutePath);
    return { ok: true };
  }

  async function resolveMarkdownAsset(input: { projectId: string; relativePath: string }): Promise<Result<{ document: ImageDocument }>> {
    const ext = path.extname(input.relativePath).toLowerCase();
    if (ext === '.svg') {
      const resolved = await resolvePath(input.projectId, input.relativePath, 'files.resolveMarkdownAsset');
      if (!resolved.ok) return resolved;
      try {
        const stat = await fs.lstat(resolved.absolutePath);
        if (stat.isSymbolicLink()) {
          return failure('FILE_OUTSIDE_PROJECT', 'Symlinks are visible but cannot be traversed or edited.', 'files.resolveMarkdownAsset', input.projectId);
        }
        if (stat.size > IMAGE_LIMIT) {
          return failure('FILE_TOO_LARGE', 'This image exceeds the 25 MiB viewer limit.', 'files.resolveMarkdownAsset', input.projectId);
        }
        const markup = await fs.readFile(resolved.absolutePath, 'utf8');
        const bytes = new TextEncoder().encode(markup);
        return {
          ok: true,
          document: {
            relativePath: resolved.relativePath,
            mimeType: 'image/svg+xml',
            bytes,
            size: bytes.byteLength,
            modifiedAt: stat.mtime.toISOString(),
          },
        };
      } catch {
        return failure('FILE_NOT_FOUND', 'The image no longer exists.', 'files.resolveMarkdownAsset', input.projectId);
      }
    }
    return readImage(input);
  }

  async function fetchRemoteImage(input: { url: string }): Promise<Result<{ mimeType: string; bytes: Uint8Array }>> {
    let current: URL;
    try { current = new URL(input.url); } catch { return failure('INVALID_REQUEST', 'The remote image URL is invalid.', 'files.fetchRemoteImage'); }
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const endpoint = await resolvePublicEndpoint(current);
      if ('error' in endpoint) {
          return failure('INVALID_REQUEST', endpoint.error, 'files.fetchRemoteImage');
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetchPinned(endpoint, {
          signal: controller.signal,
          headers: { Accept: 'image/*', Connection: 'close' },
          maxBytes: IMAGE_LIMIT,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
          if (!location || redirects === 3) return failure('COMMAND_FAILED', 'The remote image redirected too many times.', 'files.fetchRemoteImage');
          current = new URL(location, current);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          return failure('COMMAND_FAILED', `The remote image request failed with status ${response.status}.`, 'files.fetchRemoteImage', undefined, true);
        }
        const rawType = response.headers['content-type'];
        const mimeType = (Array.isArray(rawType) ? rawType[0] : rawType)?.split(';')[0].trim().toLowerCase() ?? '';
        if (!mimeType.startsWith('image/') || mimeType === 'image/svg+xml') {
          return failure('FILE_UNSUPPORTED_TYPE', 'The remote resource is not a supported raster image.', 'files.fetchRemoteImage');
        }
        return { ok: true, mimeType, bytes: response.body };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'FILE_TOO_LARGE') {
          return failure('FILE_TOO_LARGE', 'The remote image exceeds the 25 MiB limit.', 'files.fetchRemoteImage');
        }
        return failure('COMMAND_FAILED', 'The remote image could not be fetched.', 'files.fetchRemoteImage', undefined, true);
      } finally { clearTimeout(timeout); }
    }
    return failure('COMMAND_FAILED', 'The remote image could not be fetched.', 'files.fetchRemoteImage');
  }

  async function exportHtml(input: { projectId: string; relativePath: string; html: string; suggestedName: string }): Promise<OkResult> {
    const resolved = await resolvePath(input.projectId, input.relativePath, 'files.exportHtml');
    if (!resolved.ok) return resolved;
    return deps.exportHtml(input.html, input.suggestedName);
  }
  async function exportPdf(input: { projectId: string; relativePath: string; html: string; suggestedName: string }): Promise<OkResult> {
    const resolved = await resolvePath(input.projectId, input.relativePath, 'files.exportPdf');
    if (!resolved.ok) return resolved;
    return deps.exportPdf(input.html, input.suggestedName);
  }

  async function dispose(): Promise<void> {
    for (const job of searches.values()) job.cancelled = true;
    searches.clear();
    for (const projectId of watcherReadiness.keys()) {
      settleWatcherReadiness(projectId, failure('COMMAND_FAILED', 'File watching was stopped during shutdown.', 'files.watchProject', projectId, true));
    }
    watcherReadiness.clear();
    await Promise.all([...watchers.values()].map((watcher) => watcher.close()));
    watchers.clear();
    for (const timer of watcherTimers.values()) clearTimeout(timer);
    watcherTimers.clear();
    deps.disposeExports();
  }

  return {
    listDirectory, readText, readImage, saveText, createEntry, renameEntry, moveEntry,
    duplicateEntry, trashEntry, quickOpen, startSearch, cancelSearch, watchProject, unwatchProject,
    resolveMarkdownAsset, fetchRemoteImage, openExternal, reveal, exportHtml, exportPdf,
    printDocument: (input: { html: string }) => deps.printDocument(input.html),
    getWorkspaceState, saveWorkspaceState,
    putDraft, removeDraft, listDrafts, dispose,
    onFileEvents(listener: (events: FileSystemEvent[]) => void) { fileListeners.add(listener); return () => fileListeners.delete(listener); },
    onSearchEvents(listener: (batch: SearchBatch) => void) { searchListeners.add(listener); return () => searchListeners.delete(listener); },
    setDirtyFileCount(count: number) { dirtyFileCount = Math.max(0, Math.floor(count)); },
    dirtyFileCount() { return dirtyFileCount; },
  };
}
