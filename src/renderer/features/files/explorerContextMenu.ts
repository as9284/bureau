import type { FileEntry } from '@shared/contracts/files';
import type { ContextMenuItem } from '@renderer/store/appStore';
import { copyText } from '@renderer/lib/contextMenu';

type ExplorerMenuActions = {
  open(): void;
  beginCreate(kind: 'file' | 'directory'): void;
  rename(): void;
  duplicate(): void;
  trash(): void;
  reveal(): void;
  openExternal(): void;
};

function joinProjectPath(root: string, relativePath: string): string {
  if (!relativePath) return root;
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${relativePath.replace(/\//g, sep)}`;
}

/** Context menu items tailored to a Files explorer entry (file vs folder). */
export function buildExplorerContextMenuItems(
  entry: FileEntry,
  projectRoot: string,
  actions: ExplorerMenuActions
): ContextMenuItem[] {
  const isDirectory = entry.kind === 'directory';
  const absolutePath = joinProjectPath(projectRoot, entry.relativePath);
  const items: ContextMenuItem[] = [];

  if (!isDirectory) {
    items.push({ type: 'item', label: 'Open', onSelect: actions.open });
    items.push({ type: 'separator' });
  } else {
    items.push(
      { type: 'item', label: 'New File…', onSelect: () => actions.beginCreate('file') },
      { type: 'item', label: 'New Folder…', onSelect: () => actions.beginCreate('directory') },
      { type: 'separator' }
    );
  }

  items.push(
    { type: 'item', label: 'Copy Path', onSelect: () => copyText(absolutePath) },
    { type: 'item', label: 'Copy Relative Path', onSelect: () => copyText(entry.relativePath) },
    { type: 'item', label: 'Reveal in File Explorer', onSelect: actions.reveal },
  );

  if (!isDirectory) {
    items.push({ type: 'item', label: 'Open Externally', onSelect: actions.openExternal });
  }

  items.push(
    { type: 'separator' },
    { type: 'item', label: 'Rename…', onSelect: actions.rename },
  );

  if (!isDirectory) {
    items.push({ type: 'item', label: 'Duplicate', onSelect: actions.duplicate });
  }

  items.push(
    { type: 'separator' },
    { type: 'item', label: 'Move to Trash', danger: true, onSelect: actions.trash }
  );

  return items;
}

/** Empty-space / background menu for the explorer tree root. */
export function buildExplorerBackgroundMenuItems(actions: {
  beginCreate(kind: 'file' | 'directory'): void;
}): ContextMenuItem[] {
  return [
    { type: 'item', label: 'New File…', onSelect: () => actions.beginCreate('file') },
    { type: 'item', label: 'New Folder…', onSelect: () => actions.beginCreate('directory') },
  ];
}
