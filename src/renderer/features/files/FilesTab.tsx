import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ArrowSquareOutIcon } from '@phosphor-icons/react/ArrowSquareOut';
import { ArrowsInSimpleIcon } from '@phosphor-icons/react/ArrowsInSimple';
import { ArrowsOutIcon } from '@phosphor-icons/react/ArrowsOut';
import { CaretDownIcon } from '@phosphor-icons/react/CaretDown';
import { CaretRightIcon } from '@phosphor-icons/react/CaretRight';
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/ClockCounterClockwise';
import { EyeIcon } from '@phosphor-icons/react/Eye';
import { FileIcon } from '@phosphor-icons/react/File';
import { FileHtmlIcon } from '@phosphor-icons/react/FileHtml';
import { FilePdfIcon } from '@phosphor-icons/react/FilePdf';
import { FilePlusIcon } from '@phosphor-icons/react/FilePlus';
import { FloppyDiskIcon } from '@phosphor-icons/react/FloppyDisk';
import { FloppyDiskBackIcon } from '@phosphor-icons/react/FloppyDiskBack';
import { FolderIcon } from '@phosphor-icons/react/Folder';
import { FolderOpenIcon } from '@phosphor-icons/react/FolderOpen';
import { FolderPlusIcon } from '@phosphor-icons/react/FolderPlus';
import { FrameCornersIcon } from '@phosphor-icons/react/FrameCorners';
import { GitDiffIcon } from '@phosphor-icons/react/GitDiff';
import { InfoIcon } from '@phosphor-icons/react/Info';
import { ListNumbersIcon } from '@phosphor-icons/react/ListNumbers';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/MagnifyingGlass';
import { MagnifyingGlassMinusIcon } from '@phosphor-icons/react/MagnifyingGlassMinus';
import { MagnifyingGlassPlusIcon } from '@phosphor-icons/react/MagnifyingGlassPlus';
import { MinusCircleIcon } from '@phosphor-icons/react/MinusCircle';
import { NotePencilIcon } from '@phosphor-icons/react/NotePencil';
import { PencilSimpleIcon } from '@phosphor-icons/react/PencilSimple';
import { PlusCircleIcon } from '@phosphor-icons/react/PlusCircle';
import { PrinterIcon } from '@phosphor-icons/react/Printer';
import { PushPinIcon } from '@phosphor-icons/react/PushPin';
import { SidebarSimpleIcon } from '@phosphor-icons/react/SidebarSimple';
import { SquareSplitHorizontalIcon } from '@phosphor-icons/react/SquareSplitHorizontal';
import { TreeStructureIcon } from '@phosphor-icons/react/TreeStructure';
import { XIcon } from '@phosphor-icons/react/X';
import type { FileEntry } from '@shared/contracts/files';
import { useAppStore, type FilesProjectState } from '@renderer/store/appStore';
import { ensureGitProject, useGitStore } from '@renderer/store/gitStore';
import { ResizablePanel } from '@renderer/components/ResizablePanel';
import { Button } from '@renderer/components/Button';
import { IconButton } from '@renderer/components/IconButton';
import { TextField } from '@renderer/components/TextField';
import { Dialog } from '@renderer/components/Dialog';
import { Checkbox } from '@renderer/components/Checkbox';
import { Dropdown } from '@renderer/components/Dropdown';
import { CodeEditor } from './CodeEditor';
import { MarkdownReader } from './MarkdownReader';
import { SvgBlobPreview } from './SvgBlobPreview';
import { markdownFrontMatter, markdownOutline, markdownStats } from './markdown';
import { tabDropPlaceFromPoint } from '@shared/files/tabOrder';
import { isValidEntryName, resolveCreateParent } from './createEntry';
import { buildExplorerBackgroundMenuItems, buildExplorerContextMenuItems } from './explorerContextMenu';
import { buildFileTabMenuItems } from './fileTabContextMenu';
import { FilesLoadingState } from './FilesLoadingState';
import {
  entryMatchesExplorerFilter,
  hasMatchingExplorerDescendant,
  normalizeExplorerFilter,
} from './explorerFilter';

const TOOLBAR_ICON = 16;
const TAB_DRAG_MIME = 'application/x-bureau-files-tab';
const EMPTY_DIRECTORY_CACHE: Record<string, FileEntry[]> = {};

type SidebarMode = 'explorer' | 'search' | 'outline' | 'recent' | 'info';
type DocumentMode = 'edit' | 'preview' | 'split';
type CreateDraft = { kind: 'file' | 'directory'; parentPath: string; name: string; error: string | null };

const SIDEBAR_MODE_META: Record<SidebarMode, { label: string; icon: ReactNode }> = {
  explorer: { label: 'Explorer', icon: <TreeStructureIcon size={TOOLBAR_ICON} /> },
  search: { label: 'Search', icon: <MagnifyingGlassIcon size={TOOLBAR_ICON} /> },
  outline: { label: 'Outline', icon: <ListNumbersIcon size={TOOLBAR_ICON} /> },
  recent: { label: 'Recent', icon: <ClockCounterClockwiseIcon size={TOOLBAR_ICON} /> },
  info: { label: 'Info', icon: <InfoIcon size={TOOLBAR_ICON} /> },
};

const DOCUMENT_MODE_META: Record<DocumentMode, { label: string; icon: ReactNode }> = {
  edit: { label: 'Edit', icon: <PencilSimpleIcon size={TOOLBAR_ICON} /> },
  preview: { label: 'Preview', icon: <EyeIcon size={TOOLBAR_ICON} /> },
  split: { label: 'Split', icon: <SquareSplitHorizontalIcon size={TOOLBAR_ICON} /> },
};
type MutationDialog =
  | { kind: 'rename'; path: string; value: string }
  | { kind: 'move' | 'duplicate' | 'save-copy'; path: string; value: string }
  | { kind: 'trash'; path: string; value: string }
  | null;

function basename(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath;
}

function dirname(relativePath: string): string {
  const parts = relativePath.split('/');
  parts.pop();
  return parts.join('/');
}

function pathJoin(parent: string, name: string): string {
  return [parent, name].filter(Boolean).join('/');
}

function uniqueDuplicatePath(relativePath: string, existing: Set<string>): string {
  const fileName = basename(relativePath);
  const parent = dirname(relativePath);
  const dot = fileName.lastIndexOf('.');
  const hasExtension = dot > 0;
  const stem = hasExtension ? fileName.slice(0, dot) : fileName;
  const extension = hasExtension ? fileName.slice(dot) : '';
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`;
    const candidate = pathJoin(parent, `${stem}${suffix}${extension}`);
    if (!existing.has(candidate)) return candidate;
  }
  return pathJoin(parent, `${stem} copy ${Date.now()}${extension}`);
}

function blobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Image conversion failed.'));
    reader.readAsDataURL(blob);
  });
}

async function prepareExportHtml(renderedHtml: string): Promise<string> {
  const documentCopy = new DOMParser().parseFromString(renderedHtml, 'text/html');
  for (const image of documentCopy.querySelectorAll<HTMLImageElement>('img[src^="blob:"]')) {
    const response = await fetch(image.src, { credentials: 'omit' });
    image.src = await blobAsDataUrl(await response.blob());
  }
  const tokens = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) => tokens.getPropertyValue(name).trim() || fallback;
  const css = `
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 40px; background: ${value('--color-surface-canvas', '#111')}; color: ${value('--color-text-primary', '#eee')}; font: ${value('--font-size-body', '13px')}/${value('--line-height-body', '1.6')} ${value('--font-family-ui', 'sans-serif')}; }
    .markdown-reader { max-width: 760px; margin: 0 auto; }
    pre, code { font-family: ${value('--font-family-mono', 'monospace')}; }
    pre { overflow: auto; padding: 16px; background: ${value('--color-surface-sunken', '#0b0b0b')}; border: 1px solid ${value('--color-border-subtle', '#333')}; border-radius: ${value('--radius-panel', '6px')}; }
    a { color: ${value('--color-accent-primary', '#8da2fb')}; }
    img, svg { max-width: 100%; height: auto; }
    blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid ${value('--color-border-strong', '#555')}; color: ${value('--color-text-secondary', '#bbb')}; }
    table { border-collapse: collapse; } th, td { padding: 6px 10px; border: 1px solid ${value('--color-border-default', '#444')}; }
    @media print { body { padding: 0; } }
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${documentCopy.body.innerHTML}</body></html>`;
}

function focusRelativeRow(current: HTMLElement, offset: number): void {
  const rows = [...(current.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
  const index = rows.indexOf(current);
  rows[Math.max(0, Math.min(rows.length - 1, index + offset))]?.focus();
}

type ExplorerTreeProps = {
  projectId: string;
  projectRoot: string;
  project: FilesProjectState;
  parentPath: string;
  gitStates: ReadonlyMap<string, string>;
  filterQuery: string;
  depth?: number;
  createDraft: CreateDraft | null;
  onMutation(dialog: MutationDialog): void;
  onBeginCreate(kind: 'file' | 'directory', parentPath: string): void;
  onCreateDraftChange(draft: CreateDraft): void;
  onCommitCreate(): void;
  onCancelCreate(): void;
};

type ExplorerWorkingSetEntry = Pick<FileEntry, 'name' | 'relativePath'>;

function TreeCreateRow({
  draft,
  depth,
  onChange,
  onCommit,
  onCancel,
}: {
  draft: CreateDraft;
  depth: number;
  onChange(draft: CreateDraft): void;
  onCommit(): void;
  onCancel(): void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div
      className={['files-tree__row', 'files-tree__create', draft.error ? 'has-error' : ''].filter(Boolean).join(' ')}
      style={{ '--files-tree-depth': depth } as CSSProperties}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected="true"
    >
      <span className="files-tree__caret" aria-hidden />
      <span className="files-tree__icon" aria-hidden>{draft.kind === 'directory' ? <FolderIcon /> : <FileIcon />}</span>
      <TextField
        ref={inputRef}
        className="files-tree__create-input"
        mono
        aria-label={draft.kind === 'directory' ? 'New folder name' : 'New file name'}
        aria-invalid={Boolean(draft.error) || undefined}
        aria-describedby={draft.error ? 'files-tree-create-error' : undefined}
        placeholder={draft.kind === 'directory' ? 'Folder name' : 'File name'}
        value={draft.name}
        onChange={(event) => onChange({ ...draft, name: event.target.value, error: null })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            skipBlurRef.current = true;
            onCommit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            skipBlurRef.current = true;
            onCancel();
          }
        }}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }
          if (!draft.name.trim()) onCancel();
          else onCommit();
        }}
      />
      {draft.error ? <span id="files-tree-create-error" className="files-tree__create-error" role="alert">{draft.error}</span> : null}
    </div>
  );
}

function ExplorerWorkingSet({
  label,
  entries,
  expanded,
  filterQuery,
  activePath,
  onToggle,
  onOpen,
}: {
  label: string;
  entries: ExplorerWorkingSetEntry[];
  expanded: boolean;
  filterQuery: string;
  activePath: string | null;
  onToggle(): void;
  onOpen(relativePath: string): void;
}) {
  const visibleEntries = filterQuery
    ? entries.filter((entry) => `${entry.name}\n${entry.relativePath}`.toLocaleLowerCase().includes(filterQuery))
    : entries;
  if (!visibleEntries.length) return null;

  return (
    <section className="files-explorer-group" aria-label={label}>
      <button
        type="button"
        className="files-explorer-group__toggle"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="files-explorer-group__caret" aria-hidden>
          {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
        </span>
        <span>{label}</span>
        <span className="files-explorer-group__count">{visibleEntries.length}</span>
      </button>
      {expanded ? (
        <div className="files-explorer-group__items">
          {visibleEntries.map((entry) => (
            <button
              type="button"
              key={entry.relativePath}
              className="files-explorer-group__item"
              aria-current={entry.relativePath === activePath ? 'page' : undefined}
              onClick={() => onOpen(entry.relativePath)}
            >
              <FileIcon aria-hidden />
              <span>{entry.name}</span>
              <small className="mono">{dirname(entry.relativePath) || 'Project root'}</small>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ExplorerTree({
  projectId,
  projectRoot,
  project,
  parentPath,
  gitStates,
  filterQuery,
  depth = 0,
  createDraft,
  onMutation,
  onBeginCreate,
  onCreateDraftChange,
  onCommitCreate,
  onCancelCreate,
}: ExplorerTreeProps) {
  const openProjectFile = useAppStore((state) => state.openProjectFile);
  const toggleFileDirectory = useAppStore((state) => state.toggleFileDirectory);
  const setSelection = useAppStore((state) => state.setFilesSelection);
  const openContextMenu = useAppStore((state) => state.openContextMenu);
  const pushToast = useAppStore((state) => state.pushToast);
  const entries = project.directoryCache[parentPath] ?? [];
  const visibleEntries = filterQuery
    ? entries.filter((entry) => entryMatchesExplorerFilter(entry, filterQuery, project.directoryCache))
    : entries;

  const openMenu = (event: MouseEvent, entry: FileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    setSelection(projectId, entry.relativePath);
    const existing = new Set(
      Object.values(project.directoryCache).flatMap((list) => list.map((item) => item.relativePath))
    );
    openContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildExplorerContextMenuItems(entry, projectRoot, {
        open: () => void openProjectFile(projectId, entry),
        beginCreate: (kind) => onBeginCreate(kind, entry.relativePath),
        rename: () => onMutation({ kind: 'rename', path: entry.relativePath, value: entry.name }),
        duplicate: () => {
          void (async () => {
            const destinationPath = uniqueDuplicatePath(entry.relativePath, existing);
            const result = await window.bureau.files.duplicateEntry({
              projectId,
              relativePath: entry.relativePath,
              destinationPath,
            });
            if (!result.ok) {
              pushToast('error', result.error.message);
              return;
            }
            await useAppStore.getState().loadFileDirectory(projectId, dirname(entry.relativePath));
            if (entry.kind !== 'directory') void openProjectFile(projectId, destinationPath);
          })();
        },
        trash: () => onMutation({ kind: 'trash', path: entry.relativePath, value: entry.name }),
        reveal: () => void window.bureau.files.reveal({ projectId, relativePath: entry.relativePath }),
        openExternal: () => void window.bureau.files.openExternal({ projectId, relativePath: entry.relativePath }),
      }),
    });
  };

  const dropOn = async (event: DragEvent, entry: FileEntry) => {
    if (entry.kind !== 'directory') return;
    event.preventDefault();
    const source = event.dataTransfer.getData('application/x-bureau-file');
    if (!source || source === entry.relativePath) return;
    const destinationPath = pathJoin(entry.relativePath, basename(source));
    const result = await window.bureau.files.moveEntry({ projectId, relativePath: source, destinationPath });
    if (result.ok) {
      await useAppStore.getState().loadFileDirectory(projectId, dirname(source));
      await useAppStore.getState().loadFileDirectory(projectId, entry.relativePath);
    } else useAppStore.getState().pushToast('error', result.error.message);
  };

  const showCreate = createDraft?.parentPath === parentPath;

  return (
    <>
      {showCreate && createDraft ? (
        <TreeCreateRow
          draft={createDraft}
          depth={depth}
          onChange={onCreateDraftChange}
          onCommit={onCommitCreate}
          onCancel={onCancelCreate}
        />
      ) : null}
      {visibleEntries.map((entry) => {
        const selected = project.selectedPath === entry.relativePath;
        const isDirectory = entry.kind === 'directory';
        const persistedExpanded = project.expandedPaths.includes(entry.relativePath);
        const filterExpanded = hasMatchingExplorerDescendant(entry, filterQuery, project.directoryCache);
        const expanded = persistedExpanded || filterExpanded;
        const buffer = project.buffers[entry.relativePath];
        return (
          <div
            key={entry.relativePath}
            role="none"
            className={['files-tree__branch', isDirectory ? 'is-directory' : '', expanded ? 'is-expanded' : ''].filter(Boolean).join(' ')}
            style={{ '--files-tree-depth': depth } as CSSProperties}
          >
            <button
              type="button"
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={isDirectory ? expanded : undefined}
              aria-selected={selected}
              className={['files-tree__row', isDirectory ? 'is-directory' : '', selected ? 'is-selected' : '', entry.ignored ? 'is-ignored' : ''].filter(Boolean).join(' ')}
              style={{ '--files-tree-depth': depth } as CSSProperties}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('application/x-bureau-file', entry.relativePath)}
              onDragOver={(event) => { if (isDirectory) event.preventDefault(); }}
              onDrop={(event) => void dropOn(event, entry)}
              onClick={() => {
                setSelection(projectId, entry.relativePath);
                if (isDirectory) {
                  if (!filterExpanded) void toggleFileDirectory(projectId, entry.relativePath);
                } else void openProjectFile(projectId, entry);
              }}
              onDoubleClick={() => { if (!isDirectory) void openProjectFile(projectId, entry); }}
              onContextMenu={(event) => openMenu(event, entry)}
              onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); focusRelativeRow(event.currentTarget, 1); }
                if (event.key === 'ArrowUp') { event.preventDefault(); focusRelativeRow(event.currentTarget, -1); }
                if (event.key === 'ArrowRight' && isDirectory && !expanded) { event.preventDefault(); void toggleFileDirectory(projectId, entry.relativePath); }
                if (event.key === 'ArrowLeft' && isDirectory && persistedExpanded && !filterExpanded) { event.preventDefault(); void toggleFileDirectory(projectId, entry.relativePath); }
                if (event.key === 'Enter') { event.preventDefault(); void openProjectFile(projectId, entry); }
                if (event.key === 'F2') { event.preventDefault(); onMutation({ kind: 'rename', path: entry.relativePath, value: entry.name }); }
                if (event.key === 'Delete') { event.preventDefault(); onMutation({ kind: 'trash', path: entry.relativePath, value: entry.name }); }
              }}
            >
              <span className="files-tree__caret" aria-hidden>{isDirectory ? expanded ? <CaretDownIcon /> : <CaretRightIcon /> : null}</span>
              <span className="files-tree__icon" aria-hidden>{isDirectory ? <FolderIcon weight={expanded ? 'fill' : 'regular'} /> : <FileIcon />}</span>
              <span className="files-tree__name">{entry.name}</span>
              {buffer?.kind === 'text' && buffer.dirty ? <span className="files-tree__state" aria-label="Unsaved">M</span> : null}
              {buffer?.kind === 'text' && buffer.conflict ? <span className="files-tree__state is-danger" aria-label="Conflict">!</span> : null}
              {(buffer?.kind !== 'text' || !buffer.dirty) && gitStates.has(entry.relativePath) ? <span className="files-tree__state is-git" aria-label="Git changed">{gitStates.get(entry.relativePath)}</span> : null}
            </button>
            {isDirectory && expanded ? (
              <ExplorerTree
                projectId={projectId}
                projectRoot={projectRoot}
                project={project}
                parentPath={entry.relativePath}
                gitStates={gitStates}
                filterQuery={filterQuery}
                depth={depth + 1}
                createDraft={createDraft}
                onMutation={onMutation}
                onBeginCreate={onBeginCreate}
                onCreateDraftChange={onCreateDraftChange}
                onCommitCreate={onCommitCreate}
                onCancelCreate={onCancelCreate}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function ImageViewer({ projectId, relativePath, objectUrl, size }: { projectId: string; relativePath: string; objectUrl: string; size: number }) {
  const [zoom, setZoom] = useState<'fit' | number>('fit');
  return (
    <div className="files-image-viewer">
      <div className="files-image-viewer__toolbar">
        <IconButton label="Fit" className={zoom === 'fit' ? 'is-active' : undefined} onClick={() => setZoom('fit')}><ArrowsInSimpleIcon size={TOOLBAR_ICON} /></IconButton>
        <IconButton label="Actual size" className={zoom === 1 ? 'is-active' : undefined} onClick={() => setZoom(1)}><FrameCornersIcon size={TOOLBAR_ICON} /></IconButton>
        <IconButton label="Zoom in" onClick={() => setZoom(typeof zoom === 'number' ? Math.min(4, zoom + 0.25) : 1.25)}><MagnifyingGlassPlusIcon size={TOOLBAR_ICON} /></IconButton>
        <IconButton label="Zoom out" onClick={() => setZoom(typeof zoom === 'number' ? Math.max(0.25, zoom - 0.25) : 0.75)}><MagnifyingGlassMinusIcon size={TOOLBAR_ICON} /></IconButton>
        <span className="files-image-viewer__meta mono">{Math.ceil(size / 1024).toLocaleString()} KiB</span>
        <IconButton label="Reveal in explorer" onClick={() => void window.bureau.files.reveal({ projectId, relativePath })}><FolderOpenIcon size={TOOLBAR_ICON} /></IconButton>
        <IconButton label="Open externally" onClick={() => void window.bureau.files.openExternal({ projectId, relativePath })}><ArrowSquareOutIcon size={TOOLBAR_ICON} /></IconButton>
      </div>
      <div className="files-image-viewer__canvas">
        <img src={objectUrl} alt={basename(relativePath)} style={zoom === 'fit' ? undefined : { width: `${zoom * 100}%`, maxWidth: 'none' }} />
      </div>
    </div>
  );
}

export function FilesTab({ projectId }: { projectId: string }) {
  const projectRecord = useAppStore((state) => state.projects.find((project) => project.projectId === projectId));
  const project = useAppStore((state) => state.filesByProject[projectId]);
  const filesSettings = useAppStore((state) => state.settings?.files);
  const filesExplorerWidth = useAppStore((state) => state.settings?.layout.paneWidths.filesExplorer ?? 280);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const ensureFilesProject = useAppStore((state) => state.ensureFilesProject);
  const openProjectFile = useAppStore((state) => state.openProjectFile);
  const updateFileBuffer = useAppStore((state) => state.updateFileBuffer);
  const saveFile = useAppStore((state) => state.saveFile);
  const saveAllFiles = useAppStore((state) => state.saveAllFiles);
  const closeFile = useAppStore((state) => state.closeFile);
  const openContextMenu = useAppStore((state) => state.openContextMenu);
  const setActiveFile = useAppStore((state) => state.setActiveFile);
  const reorderFileTabs = useAppStore((state) => state.reorderFileTabs);
  const togglePinnedFile = useAppStore((state) => state.togglePinnedFile);
  const setFileMode = useAppStore((state) => state.setFileMode);
  const setFileCursor = useAppStore((state) => state.setFileCursor);
  const setFileLineEnding = useAppStore((state) => state.setFileLineEnding);
  const setFileReadingProgress = useAppStore((state) => state.setFileReadingProgress);
  const setProjectTab = useAppStore((state) => state.setProjectTab);
  const setShowIgnored = useAppStore((state) => state.setFilesShowIgnored);
  const toggleFileDirectory = useAppStore((state) => state.toggleFileDirectory);
  const setFilesSelection = useAppStore((state) => state.setFilesSelection);
  const loadFileDirectory = useAppStore((state) => state.loadFileDirectory);
  const searchProjectFiles = useAppStore((state) => state.searchProjectFiles);
  const cancelProjectSearch = useAppStore((state) => state.cancelProjectSearch);
  const gitRepo = useGitStore((state) => state.repos[projectId]);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('explorer');
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [quickResults, setQuickResults] = useState<FileEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [explorerFilter, setExplorerFilter] = useState('');
  const [openFilesExpanded, setOpenFilesExpanded] = useState(true);
  const [recentFilesExpanded, setRecentFilesExpanded] = useState(false);
  const [mutation, setMutation] = useState<MutationDialog>(null);
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [closeCandidate, setCloseCandidate] = useState<string | null>(null);
  const [forceCandidate, setForceCandidate] = useState<string | null>(null);
  const [focusReading, setFocusReading] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState('');
  const [previewFindOpen, setPreviewFindOpen] = useState(false);
  const [previewFindQuery, setPreviewFindQuery] = useState('');
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ path: string; place: 'before' | 'after' } | null>(null);
  const quickInputRef = useRef<HTMLInputElement>(null);
  const quickRequestRef = useRef(0);

  useEffect(() => {
    void ensureFilesProject(projectId);
    return () => {
      void cancelProjectSearch(projectId);
    };
  }, [cancelProjectSearch, ensureFilesProject, projectId]);

  useEffect(() => {
    if (project?.status !== 'ready' || !projectRecord) return;
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
      const handle = idleWindow.requestIdleCallback(
        () => ensureGitProject({ projectId, path: projectRecord.canonicalPath, name: projectRecord.name }),
        { timeout: 1000 }
      );
      return () => idleWindow.cancelIdleCallback?.(handle);
    }
    const timeout = window.setTimeout(
      () => ensureGitProject({ projectId, path: projectRecord.canonicalPath, name: projectRecord.name }),
      0
    );
    return () => window.clearTimeout(timeout);
  }, [project?.status, projectId, projectRecord]);

  useEffect(() => {
    const openQuickOpen = () => setQuickOpen(true);
    const openSearch = () => setSidebarMode('search');
    window.addEventListener('bureau:files:quick-open', openQuickOpen);
    window.addEventListener('bureau:files:search', openSearch);
    return () => {
      window.removeEventListener('bureau:files:quick-open', openQuickOpen);
      window.removeEventListener('bureau:files:search', openSearch);
    };
  }, []);

  useEffect(() => {
    if (!quickOpen) return;
    const request = ++quickRequestRef.current;
    const handle = window.setTimeout(() => {
      void window.bureau.files.quickOpen({ projectId, query: quickQuery, showIgnored: project?.showIgnored }).then((result) => {
        if (quickRequestRef.current === request) setQuickResults(result.ok ? result.entries : []);
      });
    }, 90);
    return () => window.clearTimeout(handle);
  }, [project?.showIgnored, projectId, quickOpen, quickQuery]);

  const activePath = project?.activePath ?? null;
  const directoryCache = project?.directoryCache ?? EMPTY_DIRECTORY_CACHE;
  const activeBuffer = activePath ? project?.buffers[activePath] : undefined;
  const activeMode = activePath ? project?.modeByPath[activePath] ?? 'edit' : 'edit';
  const isMarkdown = activeBuffer?.kind === 'text' && activeBuffer.document.languageId === 'markdown';
  const isSvg = activeBuffer?.kind === 'text' && /\.svg$/i.test(activePath ?? '');
  const outline = useMemo(() => isMarkdown && activeBuffer?.kind === 'text' ? markdownOutline(activeBuffer.content) : [], [activeBuffer, isMarkdown]);
  const stats = useMemo(() => isMarkdown && activeBuffer?.kind === 'text' ? markdownStats(activeBuffer.content) : null, [activeBuffer, isMarkdown]);
  const metadata = useMemo(() => isMarkdown && activeBuffer?.kind === 'text' ? markdownFrontMatter(activeBuffer.content) : {}, [activeBuffer, isMarkdown]);
  const changedFile = gitRepo?.snapshot?.changedFiles.find((file) => file.path.replace(/\\/g, '/') === activePath);
  const gitStates = useMemo(() => new Map(
    (gitRepo?.snapshot?.changedFiles ?? []).map((file) => [
      file.path.replace(/\\/g, '/'),
      file.unmerged ? '!' : file.untracked ? 'U' : file.staged && !file.unstaged ? 'S' : 'M',
    ])
  ), [gitRepo?.snapshot?.changedFiles]);
  const normalizedExplorerFilter = useMemo(() => normalizeExplorerFilter(explorerFilter), [explorerFilter]);
  const openFiles = useMemo<ExplorerWorkingSetEntry[]>(() => {
    const tabs = project?.tabs ?? [];
    const paths = activePath
      ? [activePath, ...tabs.filter((path) => path !== activePath)]
      : tabs;
    return paths.map((relativePath) => ({ name: basename(relativePath), relativePath }));
  }, [activePath, project?.tabs]);
  const recentlyModifiedFiles = useMemo(() => {
    const entriesByPath = new Map<string, FileEntry>();
    for (const entries of Object.values(directoryCache)) {
      for (const entry of entries) {
        if (entry.kind !== 'directory' && !entry.ignored) entriesByPath.set(entry.relativePath, entry);
      }
    }
    return [...entriesByPath.values()]
      .sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt))
      .slice(0, 6);
  }, [directoryCache]);
  const explorerHasMatches = useMemo(
    () => !normalizedExplorerFilter
      || (directoryCache[''] ?? []).some((entry) =>
        entryMatchesExplorerFilter(entry, normalizedExplorerFilter, directoryCache)
      ),
    [directoryCache, normalizedExplorerFilter]
  );
  const updateReadingProgress = useCallback((progress: number) => {
    if (activePath) setFileReadingProgress(projectId, activePath, progress);
  }, [activePath, projectId, setFileReadingProgress]);

  const exportRendered = useCallback(async (format: 'html' | 'pdf' | 'print') => {
    if (!activePath) return;
    try {
      const html = await prepareExportHtml(renderedHtml);
      const result = format === 'html'
        ? await window.bureau.files.exportHtml({ projectId, relativePath: activePath, html, suggestedName: basename(activePath) })
        : format === 'pdf'
          ? await window.bureau.files.exportPdf({ projectId, relativePath: activePath, html, suggestedName: basename(activePath) })
          : await window.bureau.files.printDocument({ html });
      if (!result.ok) useAppStore.getState().pushToast('error', result.error.message);
    } catch {
      useAppStore.getState().pushToast('error', 'The rendered document could not be prepared for export.');
    }
  }, [activePath, projectId, renderedHtml]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLocaleLowerCase() === 'p') { event.preventDefault(); setQuickOpen(true); }
      if (mod && event.shiftKey && event.key.toLocaleLowerCase() === 'f') { event.preventDefault(); setSidebarMode('search'); }
      if (mod && !event.shiftKey && event.key.toLocaleLowerCase() === 'f' && activeMode === 'preview') { event.preventDefault(); setPreviewFindOpen(true); }
      if (mod && !event.shiftKey && !event.altKey && event.key.toLocaleLowerCase() === 's' && activePath) { event.preventDefault(); void saveFile(projectId, activePath); }
      if (mod && event.altKey && event.key.toLocaleLowerCase() === 's') { event.preventDefault(); void saveAllFiles(projectId); }
      if (mod && event.shiftKey && event.key.toLocaleLowerCase() === 's' && activePath) { event.preventDefault(); setMutation({ kind: 'save-copy', path: activePath, value: `${activePath}.copy` }); }
      if (mod && event.key.toLocaleLowerCase() === 'w' && activePath) { event.preventDefault(); if (activeBuffer?.kind === 'text' && activeBuffer.dirty) setCloseCandidate(activePath); else closeFile(projectId, activePath); }
      if (mod && event.key === 'Tab' && project?.tabs.length) { event.preventDefault(); const index = project.tabs.indexOf(activePath ?? ''); const next = project.tabs[(index + (event.shiftKey ? -1 : 1) + project.tabs.length) % project.tabs.length]; setActiveFile(projectId, next); }
      if (mod && event.shiftKey && event.key.toLocaleLowerCase() === 'v' && isMarkdown && activePath) { event.preventDefault(); setFileMode(projectId, activePath, 'preview'); }
      if (event.key === 'F5') { const dirty = Object.values(project?.buffers ?? {}).some((buffer) => buffer.kind === 'text' && buffer.dirty); if (dirty) { event.preventDefault(); useAppStore.getState().pushToast('info', 'Save or discard file changes before reloading.'); } }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeBuffer, activeMode, activePath, closeFile, isMarkdown, project?.buffers, project?.tabs, projectId, saveAllFiles, saveFile, setActiveFile, setFileMode]);

  useEffect(() => {
    const findInPage = (window as typeof window & { find?(query: string, caseSensitive?: boolean, backwards?: boolean, wrapAround?: boolean): boolean }).find;
    if (previewFindOpen && previewFindQuery) findInPage?.(previewFindQuery, false, false, true);
  }, [previewFindOpen, previewFindQuery]);

  if (!project || project.status === 'idle' || project.status === 'loading') {
    return <FilesLoadingState phase={project?.loadingPhase ?? 'starting'} />;
  }
  if (project.status === 'error') {
    return <div className="files-tab"><div className="files-error" role="alert"><strong>Files could not be loaded.</strong><span>{project.error?.message}</span><Button onClick={() => void ensureFilesProject(projectId)}>Retry</Button></div></div>;
  }

  const runMutation = async () => {
    if (!mutation) return;
    let result;
    if (mutation.kind === 'rename') result = await window.bureau.files.renameEntry({ projectId, relativePath: mutation.path, newName: mutation.value });
    else if (mutation.kind === 'move') result = await window.bureau.files.moveEntry({ projectId, relativePath: mutation.path, destinationPath: mutation.value });
    else if (mutation.kind === 'duplicate') result = await window.bureau.files.duplicateEntry({ projectId, relativePath: mutation.path, destinationPath: mutation.value });
    else if (mutation.kind === 'trash') result = await window.bureau.files.trashEntry({ projectId, relativePath: mutation.path });
    else if (mutation.kind === 'save-copy') {
      const source = project.buffers[mutation.path];
      result = await window.bureau.files.createEntry({ projectId, relativePath: mutation.value, kind: 'file' });
      if (result.ok && source?.kind === 'text') {
        const read = await window.bureau.files.readText({ projectId, relativePath: mutation.value });
        if (read.ok) result = await window.bureau.files.saveText({ projectId, relativePath: mutation.value, content: source.content, expectedRevision: read.document.revision, encoding: source.document.encoding, lineEnding: source.document.lineEnding === 'mixed' ? 'lf' : source.document.lineEnding });
      }
    }
    if (!result) return;
    if (!result.ok) useAppStore.getState().pushToast('error', result.error.message);
    else {
      useAppStore.getState().pushToast('success', mutation.kind === 'trash' ? 'Moved to trash' : 'File operation completed');
      if (mutation.kind === 'trash') {
        useAppStore.getState().closeDeletedFiles(projectId, mutation.path);
      }
      await useAppStore.getState().loadFileDirectory(projectId, dirname(mutation.path));
      if (mutation.kind === 'move' || mutation.kind === 'duplicate' || mutation.kind === 'save-copy') {
        await useAppStore.getState().loadFileDirectory(projectId, dirname(mutation.value));
      }
      window.setTimeout(() => void useAppStore.getState().loadGit(projectId), 180);
    }
    setMutation(null);
  };

  const beginCreate = async (kind: 'file' | 'directory', explicitParent?: string) => {
    setSidebarMode('explorer');
    setMutation(null);
    const latest = useAppStore.getState().filesByProject[projectId] ?? project;
    const parentPath = explicitParent ?? resolveCreateParent(latest.selectedPath, latest.directoryCache, latest.expandedPaths);
    if (parentPath && !latest.expandedPaths.includes(parentPath)) {
      await toggleFileDirectory(projectId, parentPath);
    } else {
      await loadFileDirectory(projectId, parentPath);
    }
    setFilesSelection(projectId, parentPath || null);
    setCreateDraft({ kind, parentPath, name: '', error: null });
  };

  const commitCreate = async () => {
    if (!createDraft) return;
    const name = createDraft.name.trim();
    if (!name) {
      setCreateDraft(null);
      return;
    }
    if (!isValidEntryName(name)) {
      setCreateDraft({ ...createDraft, error: 'Enter a valid file or folder name.' });
      return;
    }
    const relativePath = pathJoin(createDraft.parentPath, name);
    const result = await window.bureau.files.createEntry({
      projectId,
      relativePath,
      kind: createDraft.kind === 'file' ? 'file' : 'directory',
    });
    if (!result.ok) {
      setCreateDraft({ ...createDraft, error: result.error.message });
      useAppStore.getState().pushToast('error', result.error.message);
      return;
    }
    const parentPath = createDraft.parentPath;
    const kind = createDraft.kind;
    setCreateDraft(null);
    await loadFileDirectory(projectId, parentPath);
    if (kind === 'file') void openProjectFile(projectId, relativePath);
    else {
      const current = useAppStore.getState().filesByProject[projectId];
      if (current && !current.expandedPaths.includes(relativePath)) await toggleFileDirectory(projectId, relativePath);
      setFilesSelection(projectId, relativePath);
    }
  };

  const openDiff = () => {
    if (!activePath || !changedFile) return;
    useGitStore.getState().setRepoPanel('changes');
    useGitStore.getState().setSelectedFile({ projectId, path: activePath, area: changedFile.unstaged ? 'unstaged' : 'staged' });
    setProjectTab('git');
  };

  return (
    <section
      className={['files-tab', focusReading ? 'is-focus-reading' : ''].filter(Boolean).join(' ')}
      data-reader-width={filesSettings?.readerWidth ?? 'standard'}
      aria-label="Files workspace"
      onContextMenu={(event) => {
        // Let inputs / CodeMirror bubble to the shell edit menu; suppress hub chrome elsewhere.
        if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"], .cm-editor')) return;
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
      }}
    >      <div className="files-toolbar">
        <Button size="compact" variant="secondary" leadingIcon={<MagnifyingGlassIcon size={TOOLBAR_ICON} />} onClick={() => setQuickOpen(true)}>Quick Open</Button>
        <span className="files-toolbar__divider" />
        <IconButton label="Save file" disabled={!activePath || activeBuffer?.kind !== 'text' || !activeBuffer.dirty} onClick={() => activePath && void saveFile(projectId, activePath)}><FloppyDiskIcon size={TOOLBAR_ICON} /></IconButton>
        <IconButton label="Save all" disabled={!Object.values(project.buffers).some((buffer) => buffer.kind === 'text' && buffer.dirty)} onClick={() => void saveAllFiles(projectId)}><FloppyDiskBackIcon size={TOOLBAR_ICON} /></IconButton>
        {activePath ? <IconButton label={project.pinnedPaths.includes(activePath) ? 'Unpin file' : 'Pin file'} onClick={() => togglePinnedFile(projectId, activePath)}><PushPinIcon size={TOOLBAR_ICON} weight={project.pinnedPaths.includes(activePath) ? 'fill' : 'regular'} /></IconButton> : null}
        {(isMarkdown || isSvg) && activePath ? <div className="files-toolbar__modes" role="group" aria-label="Document mode">{(Object.entries(DOCUMENT_MODE_META) as [DocumentMode, typeof DOCUMENT_MODE_META[DocumentMode]][]).map(([mode, meta]) => <button type="button" key={mode} className={activeMode === mode ? 'is-active' : ''} aria-label={meta.label} aria-pressed={activeMode === mode} title={meta.label} onClick={() => setFileMode(projectId, activePath, mode)}>{meta.icon}</button>)}</div> : null}
        {previewFindOpen ? <div className="files-toolbar__find"><TextField aria-label="Find in preview" value={previewFindQuery} onChange={(event) => setPreviewFindQuery(event.target.value)} autoFocus /><IconButton label="Close preview find" onClick={() => { setPreviewFindOpen(false); setPreviewFindQuery(''); }}><XIcon size={TOOLBAR_ICON} /></IconButton></div> : null}
        {activeBuffer?.kind === 'text' && activePath ? <Dropdown className="files-toolbar__line-ending" label="Line ending" value={activeBuffer.document.lineEnding} options={[{ value: 'mixed', label: 'Mixed, choose before save', disabled: true }, { value: 'none', label: 'No line endings', disabled: true }, { value: 'lf', label: 'LF' }, { value: 'crlf', label: 'CRLF' }, { value: 'cr', label: 'CR' }]} onChange={(value) => { if (value === 'lf' || value === 'crlf' || value === 'cr') setFileLineEnding(projectId, activePath, value); }} /> : null}
        <span className="files-toolbar__spacer" />
        {changedFile && activeBuffer?.kind === 'text' ? <>
          <IconButton label={changedFile.unstaged ? 'Stage file' : 'Unstage file'} disabled={activeBuffer.dirty} onClick={() => void (changedFile.unstaged ? useGitStore.getState().stageFile(projectId, gitRepo?.snapshot?.revision ?? '', activePath ?? '') : useGitStore.getState().unstageFile(projectId, gitRepo?.snapshot?.revision ?? '', activePath ?? ''))}>{changedFile.unstaged ? <PlusCircleIcon size={TOOLBAR_ICON} /> : <MinusCircleIcon size={TOOLBAR_ICON} />}</IconButton>
          <IconButton label="Open Diff" onClick={openDiff}><GitDiffIcon size={TOOLBAR_ICON} /></IconButton>
        </> : null}
        {isMarkdown && activePath ? <>
          <IconButton label="Export HTML" onClick={() => void exportRendered('html')}><FileHtmlIcon size={TOOLBAR_ICON} /></IconButton>
          <IconButton label="Export PDF" onClick={() => void exportRendered('pdf')}><FilePdfIcon size={TOOLBAR_ICON} /></IconButton>
          <IconButton label="Print" onClick={() => void exportRendered('print')}><PrinterIcon size={TOOLBAR_ICON} /></IconButton>
          <IconButton label={focusReading ? 'Exit focus reading' : 'Focus reading'} onClick={() => setFocusReading((value) => !value)}><ArrowsOutIcon size={TOOLBAR_ICON} /></IconButton>
        </> : null}
        <IconButton label="Toggle files sidebar" onClick={() => setFocusReading((value) => !value)}><SidebarSimpleIcon size={TOOLBAR_ICON} /></IconButton>
      </div>

      <div className="files-main">
        <ResizablePanel axis="horizontal" defaultSize={filesExplorerWidth} minSize={200} maxSize={520} minSiblingSize={420} storageKey="files-explorer" resizeLabel="Resize files explorer" className="files-sidebar" onSizeCommit={(filesExplorer) => void updateSettings({ layout: { paneWidths: { filesExplorer } } })}>
          <div className="files-sidebar__modes" role="tablist" aria-label="Files sidebar views">
            {(Object.entries(SIDEBAR_MODE_META) as [SidebarMode, typeof SIDEBAR_MODE_META[SidebarMode]][]).map(([mode, meta]) => (
              <button type="button" role="tab" aria-selected={sidebarMode === mode} aria-label={meta.label} title={meta.label} key={mode} onClick={() => setSidebarMode(mode)}>{meta.icon}</button>
            ))}
          </div>
          {sidebarMode === 'explorer' ? <>
            <div className="files-sidebar__header"><span>Explorer</span><span className="files-sidebar__actions"><IconButton label="New file" onClick={() => void beginCreate('file')}><FilePlusIcon size={TOOLBAR_ICON} /></IconButton><IconButton label="New folder" onClick={() => void beginCreate('directory')}><FolderPlusIcon size={TOOLBAR_ICON} /></IconButton></span></div>
            <div className="files-explorer-filter">
              <MagnifyingGlassIcon className="files-explorer-filter__icon" size={TOOLBAR_ICON} aria-hidden />
              <TextField
                aria-label="Filter files and folders"
                placeholder="Filter files and folders"
                value={explorerFilter}
                onChange={(event) => setExplorerFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && explorerFilter) {
                    event.preventDefault();
                    setExplorerFilter('');
                  }
                }}
              />
              {explorerFilter ? <IconButton label="Clear file filter" onClick={() => setExplorerFilter('')}><XIcon size={TOOLBAR_ICON} /></IconButton> : null}
            </div>
            <div className="files-sidebar__section-title files-sidebar__section-title--project"><span>{projectRecord?.name ?? 'Project'}</span><Checkbox checked={project.showIgnored} onChange={(checked) => void setShowIgnored(projectId, checked)} label="Show ignored" /></div>
            <div className="files-explorer-groups">
              <ExplorerWorkingSet
                label="Open files"
                entries={openFiles}
                expanded={openFilesExpanded}
                filterQuery={normalizedExplorerFilter}
                activePath={activePath}
                onToggle={() => setOpenFilesExpanded((expanded) => !expanded)}
                onOpen={(relativePath) => void openProjectFile(projectId, relativePath)}
              />
              <ExplorerWorkingSet
                label="Recently modified"
                entries={recentlyModifiedFiles}
                expanded={recentFilesExpanded}
                filterQuery={normalizedExplorerFilter}
                activePath={activePath}
                onToggle={() => setRecentFilesExpanded((expanded) => !expanded)}
                onOpen={(relativePath) => void openProjectFile(projectId, relativePath)}
              />
            </div>
            <div
              className="files-tree"
              role="tree"
              aria-label="Project files"
              onContextMenu={(event) => {
                if ((event.target as HTMLElement).closest('.files-tree__row, .files-tree__create')) return;
                event.preventDefault();
                event.stopPropagation();
                useAppStore.getState().openContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  items: buildExplorerBackgroundMenuItems({
                    beginCreate: (kind) => void beginCreate(kind, ''),
                  }),
                });
              }}
            >
              {explorerHasMatches ? (
                <ExplorerTree
                  projectId={projectId}
                  projectRoot={projectRecord?.canonicalPath ?? ''}
                  project={project}
                  parentPath=""
                  gitStates={gitStates}
                  filterQuery={normalizedExplorerFilter}
                  createDraft={createDraft}
                  onMutation={setMutation}
                  onBeginCreate={(kind, parentPath) => void beginCreate(kind, parentPath)}
                  onCreateDraftChange={setCreateDraft}
                  onCommitCreate={() => void commitCreate()}
                  onCancelCreate={() => setCreateDraft(null)}
                />
              ) : <div className="files-tree__empty">No matching files or folders in the loaded tree.</div>}
            </div>
          </> : null}
          {sidebarMode === 'search' ? <div className="files-search"><form onSubmit={(event) => { event.preventDefault(); void searchProjectFiles(projectId, searchQuery); }}><label htmlFor="files-project-search">Search project content</label><div className="files-search__input"><TextField id="files-project-search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} mono /><IconButton label="Search" type="submit"><MagnifyingGlassIcon /></IconButton></div></form>{project.search.error ? <div className="files-banner is-danger" role="alert"><strong>Search failed</strong><span>{project.search.error}</span><Button size="compact" onClick={() => void searchProjectFiles(projectId, searchQuery)}>Retry</Button></div> : null}<div className="files-search__summary">{project.search.running ? 'Searching' : `${project.search.matches.length} matches`}{project.search.truncated ? ', truncated' : ''}</div><div className="files-search__results">{project.search.matches.map((match, index) => <button type="button" key={`${match.relativePath}:${match.line}:${match.column}:${index}`} onClick={() => void openProjectFile(projectId, match.relativePath)}><strong className="mono">{match.relativePath}</strong><span className="mono">{match.line}:{match.column}</span><small className="mono">{match.preview}</small></button>)}</div></div> : null}
          {sidebarMode === 'outline' ? <div className="files-outline">{outline.length ? outline.map((heading) => <button type="button" key={heading.slug} style={{ '--outline-depth': heading.depth } as CSSProperties} onClick={() => document.getElementById(heading.slug)?.scrollIntoView({ behavior: 'smooth' })}>{heading.text}</button>) : <div className="files-sidebar__empty">Open a Markdown document to see its outline.</div>}</div> : null}
          {sidebarMode === 'recent' ? <div className="files-recent">{!project.pinnedPaths.length && !project.recentPaths.length ? <div className="files-sidebar__empty empty-state"><p>No pinned or recent files yet.</p><p>Open a file from the explorer to populate this list.</p></div> : null}{project.pinnedPaths.length ? <><div className="files-sidebar__section-title">Pinned</div>{project.pinnedPaths.map((path) => <button type="button" key={`pinned:${path}`} onClick={() => void openProjectFile(projectId, path)}><span className="mono">{basename(path)}</span><small className="mono">{dirname(path)}</small></button>)}</> : null}{project.recentPaths.length ? <><div className="files-sidebar__section-title">Recent</div>{project.recentPaths.map((path) => <button type="button" key={path} onClick={() => void openProjectFile(projectId, path)}><span className="mono">{basename(path)}</span><small className="mono">{dirname(path)}</small></button>)}</> : null}</div> : null}
          {sidebarMode === 'info' ? <div className="files-info">{activeBuffer ? <dl><dt>Path</dt><dd className="mono">{activePath}</dd><dt>Type</dt><dd className="mono">{activeBuffer.kind === 'text' ? activeBuffer.document.languageId : activeBuffer.document.mimeType}</dd><dt>Size</dt><dd className="mono">{(activeBuffer.kind === 'text' ? activeBuffer.document.revision.size : activeBuffer.document.size).toLocaleString()} bytes</dd>{activeBuffer.kind === 'text' ? <><dt>Encoding</dt><dd className="mono">{activeBuffer.document.encoding}</dd><dt>Line ending</dt><dd className="mono">{activeBuffer.document.lineEnding.toUpperCase()}</dd></> : null}{stats ? <><dt>Words</dt><dd className="mono">{stats.words.toLocaleString()}</dd><dt>Read time</dt><dd className="mono">{stats.readMinutes} min</dd></> : null}{Object.entries(metadata).map(([key, value]) => <div key={key} className="files-info__metadata"><dt>{key}</dt><dd className="mono">{value}</dd></div>)}</dl> : <div className="files-sidebar__empty">Open a file to inspect it.</div>}</div> : null}
        </ResizablePanel>

        <div className="files-workarea">
          <div
            className="files-tabs"
            role="tablist"
            aria-label="Open files"
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
            }}
          >
            {project.tabs.map((path) => {
              const buffer = project.buffers[path];
              const dropPlace = dropTarget?.path === path ? dropTarget.place : null;
              return (
                <div
                  key={path}
                  className={[
                    'files-tab-item',
                    project.activePath === path ? 'is-active' : '',
                    buffer?.kind === 'text' && buffer.conflict ? 'has-conflict' : '',
                    draggingTab === path ? 'is-dragging' : '',
                    dropPlace === 'before' ? 'is-drop-before' : '',
                    dropPlace === 'after' ? 'is-drop-after' : '',
                  ].filter(Boolean).join(' ')}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const projectRoot = projectRecord?.canonicalPath ?? '';
                    const dirty = buffer?.kind === 'text' && buffer.dirty;
                    openContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      items: buildFileTabMenuItems(
                        path,
                        projectRoot,
                        {
                          pinned: project.pinnedPaths.includes(path),
                          canCloseOthers: project.tabs.length > 1,
                        },
                        {
                          close: () => (dirty ? setCloseCandidate(path) : closeFile(projectId, path)),
                          closeOthers: () => {
                            for (const other of [...project.tabs]) {
                              if (other === path) continue;
                              const otherBuffer = project.buffers[other];
                              if (otherBuffer?.kind === 'text' && otherBuffer.dirty) setCloseCandidate(other);
                              else closeFile(projectId, other);
                            }
                          },
                          closeAll: () => {
                            for (const other of [...project.tabs]) {
                              const otherBuffer = project.buffers[other];
                              if (otherBuffer?.kind === 'text' && otherBuffer.dirty) setCloseCandidate(other);
                              else closeFile(projectId, other);
                            }
                          },
                          pin: () => togglePinnedFile(projectId, path),
                          reveal: () => void window.bureau.files.reveal({ projectId, relativePath: path }),
                          openExternal: () => void window.bureau.files.openExternal({ projectId, relativePath: path }),
                        }
                      ),
                    });
                  }}
                  onDragOver={(event) => {
                    if (!draggingTab || draggingTab === path) return;
                    if (![...event.dataTransfer.types].includes(TAB_DRAG_MIME)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    const place = tabDropPlaceFromPoint(event.clientX, event.currentTarget.getBoundingClientRect());
                    if (dropTarget?.path !== path || dropTarget.place !== place) setDropTarget({ path, place });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourcePath = event.dataTransfer.getData(TAB_DRAG_MIME) || draggingTab;
                    const place = tabDropPlaceFromPoint(event.clientX, event.currentTarget.getBoundingClientRect());
                    setDropTarget(null);
                    setDraggingTab(null);
                    if (sourcePath) reorderFileTabs(projectId, sourcePath, path, place);
                  }}
                >
                  <button
                    type="button"
                    role="tab"
                    draggable
                    aria-selected={project.activePath === path}
                    title={path}
                    onClick={() => setActiveFile(projectId, path)}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(TAB_DRAG_MIME, path);
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggingTab(path);
                    }}
                    onDragEnd={() => {
                      setDraggingTab(null);
                      setDropTarget(null);
                    }}
                  >
                    <span className="mono">{basename(path)}</span>
                    {buffer?.kind === 'text' && buffer.dirty ? <span className="files-tab-item__dirty" aria-label="Unsaved changes" /> : null}
                    {buffer?.kind === 'text' && buffer.missing ? <span aria-label="Missing">?</span> : null}
                    {(buffer?.kind !== 'text' || !buffer.dirty) && gitStates.has(path) ? <span className="files-tab-item__git" aria-label="Git changed">{gitStates.get(path)}</span> : null}
                  </button>
                  <IconButton
                    label={`Close ${basename(path)}`}
                    onClick={() => (buffer?.kind === 'text' && buffer.dirty ? setCloseCandidate(path) : closeFile(projectId, path))}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <XIcon size={TOOLBAR_ICON} />
                  </IconButton>
                </div>
              );
            })}
          </div>
          {!activePath || !activeBuffer ? <div className="files-empty-state"><NotePencilIcon size={32} /><h2>Open a project file</h2><p>Browse the explorer or use Quick Open to read and edit without leaving Bureau.</p><Button variant="primary" onClick={() => setQuickOpen(true)}>Quick Open</Button></div> : <>
            {activeBuffer.kind === 'text' && activeBuffer.recovered ? <div className="files-banner" role="status"><strong>Recovered draft</strong><span>This buffer was restored after the previous session.</span><Button size="compact" onClick={() => void saveFile(projectId, activePath)}>Save</Button><Button size="compact" variant="ghost" onClick={() => closeFile(projectId, activePath, true)}>Discard</Button></div> : null}
            {activeBuffer.kind === 'text' && activeBuffer.conflict ? <div className="files-banner is-danger" role="alert"><strong>File changed on disk</strong><span>Compare or choose which version to keep.</span><Button size="compact" onClick={() => void useAppStore.getState().reloadFileFromDisk(projectId, activePath)}>Reload disk</Button><Button size="compact" variant="danger" onClick={() => setForceCandidate(activePath)}>Keep mine</Button><Button size="compact" variant="ghost" onClick={() => setMutation({ kind: 'save-copy', path: activePath, value: `${activePath}.mine` })}>Save copy</Button></div> : null}
            {activeBuffer.kind === 'text' && activeBuffer.missing ? <div className="files-banner is-danger" role="alert"><strong>File deleted on disk</strong><span>The unsaved buffer is retained. Save a copy or discard it.</span></div> : null}
            <div className={['files-document', activeMode === 'split' ? 'files-document--split' : ''].join(' ')}>
              {activeBuffer.kind === 'image' ? <ImageViewer projectId={projectId} relativePath={activePath} objectUrl={activeBuffer.objectUrl} size={activeBuffer.document.size} /> : <>
                {(activeMode === 'edit' || activeMode === 'split' || (!isMarkdown && !isSvg)) ? <div className="files-document__editor"><CodeEditor value={activeBuffer.content} languageId={activeBuffer.document.languageId} readOnly={activeBuffer.document.readOnly} wordWrap={isMarkdown || filesSettings?.wordWrap} onChange={(value) => updateFileBuffer(projectId, activePath, value)} onCursor={(line, column) => { setCursor({ line, column }); setFileCursor(projectId, activePath, line, column); }} /></div> : null}
                {(activeMode === 'preview' || activeMode === 'split') && (isMarkdown || isSvg) ? <div className="files-document__preview">{isMarkdown ? <MarkdownReader projectId={projectId} relativePath={activePath} source={activeBuffer.content} allowRawHtml={filesSettings?.allowRawHtml} remoteImages={filesSettings?.remoteImages} onRenderedHtml={setRenderedHtml} onProgress={updateReadingProgress} /> : <SvgBlobPreview markup={activeBuffer.content} title={basename(activePath)} />}</div> : null}
              </>}
            </div>
            {activeBuffer.kind === 'text' ? <div className="files-local-status mono"><span>{activePath}</span><span>Ln {cursor.line}, Col {cursor.column}</span><span>{activeBuffer.document.encoding.toUpperCase()}</span><span>{activeBuffer.document.lineEnding.toUpperCase()}</span><span>{activeBuffer.document.languageId}</span>{stats ? <span>{stats.words} words, {stats.readMinutes} min read</span> : null}<span>{activeBuffer.conflict ? 'Conflict' : activeBuffer.dirty ? 'Modified' : 'Saved'}</span></div> : null}
          </>}
        </div>
      </div>

      <Dialog open={quickOpen} title="Quick Open" description="Search project-relative file names." initialFocusRef={quickInputRef} onClose={() => setQuickOpen(false)} actions={<Button variant="secondary" onClick={() => setQuickOpen(false)}>Close</Button>}>
        <TextField ref={quickInputRef} value={quickQuery} onChange={(event) => setQuickQuery(event.target.value)} placeholder="File name or path" mono />
        <div className="files-quick-results">{quickResults.map((entry) => <button type="button" key={entry.relativePath} onClick={() => { void openProjectFile(projectId, entry); setQuickOpen(false); }}><span className="mono">{entry.name}</span><small className="mono">{entry.relativePath}</small></button>)}</div>
      </Dialog>
      <Dialog open={Boolean(mutation)} title={mutation?.kind === 'trash' ? 'Move to Trash' : mutation?.kind === 'rename' ? 'Rename entry' : mutation?.kind === 'save-copy' ? 'Save a copy' : mutation?.kind === 'move' ? 'Move entry' : 'Duplicate entry'} description={mutation?.kind === 'trash' ? `${mutation.value} will be moved to the operating system trash.` : mutation?.kind === 'rename' ? 'Enter a new name for this entry.' : 'Paths are relative to the project root. Existing files are never overwritten.'} onClose={() => setMutation(null)} actions={<><Button variant="secondary" onClick={() => setMutation(null)}>Cancel</Button><Button variant={mutation?.kind === 'trash' ? 'danger' : 'primary'} onClick={() => void runMutation()}>{mutation?.kind === 'trash' ? 'Move to Trash' : 'Confirm'}</Button></>}>
        {mutation && mutation.kind !== 'trash' ? <><label htmlFor="files-mutation-value">{mutation.kind === 'rename' ? 'New name' : 'Project-relative path'}</label><TextField id="files-mutation-value" value={mutation.value} onChange={(event) => setMutation({ ...mutation, value: event.target.value })} mono /></> : null}
      </Dialog>
      <Dialog open={Boolean(closeCandidate)} title="Unsaved changes" description={`${closeCandidate ? basename(closeCandidate) : 'This file'} has changes that have not been saved.`} onClose={() => setCloseCandidate(null)} actions={<><Button variant="secondary" onClick={() => setCloseCandidate(null)}>Cancel</Button><Button variant="danger" onClick={() => { if (closeCandidate) closeFile(projectId, closeCandidate, true); setCloseCandidate(null); }}>Discard</Button><Button variant="primary" onClick={() => { if (closeCandidate) void saveFile(projectId, closeCandidate).then((ok) => { if (ok) { closeFile(projectId, closeCandidate); setCloseCandidate(null); } }); }}>Save</Button></>} />
      <Dialog open={Boolean(forceCandidate)} title="Overwrite external changes" description="Keeping your buffer will replace the newer disk version. This cannot be merged automatically." onClose={() => setForceCandidate(null)} actions={<><Button variant="secondary" onClick={() => setForceCandidate(null)}>Cancel</Button><Button variant="danger" onClick={() => { if (forceCandidate) void saveFile(projectId, forceCandidate, true).then((ok) => { if (ok) setForceCandidate(null); }); }}>Keep Mine</Button></>} />
    </section>
  );
}
