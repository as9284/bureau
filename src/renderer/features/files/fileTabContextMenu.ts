import type { ContextMenuItem } from '@renderer/store/appStore';
import { copyText } from '@renderer/lib/contextMenu';

function joinProjectPath(root: string, relativePath: string): string {
  if (!relativePath) return root;
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${relativePath.replace(/\//g, sep)}`;
}

type FileTabMenuActions = {
  close(): void;
  closeOthers(): void;
  closeAll(): void;
  pin(): void;
  reveal(): void;
  openExternal(): void;
};

/** Context menu for an open Files tab. */
export function buildFileTabMenuItems(
  relativePath: string,
  projectRoot: string,
  options: { pinned: boolean; canCloseOthers: boolean },
  actions: FileTabMenuActions
): ContextMenuItem[] {
  const absolutePath = joinProjectPath(projectRoot, relativePath);
  return [
    { type: 'item', label: 'Close', onSelect: actions.close },
    { type: 'item', label: 'Close Others', onSelect: actions.closeOthers, disabled: !options.canCloseOthers },
    { type: 'item', label: 'Close All', onSelect: actions.closeAll },
    { type: 'separator' },
    { type: 'item', label: options.pinned ? 'Unpin' : 'Pin', onSelect: actions.pin },
    { type: 'separator' },
    { type: 'item', label: 'Copy Path', onSelect: () => copyText(absolutePath) },
    { type: 'item', label: 'Copy Relative Path', onSelect: () => copyText(relativePath) },
    { type: 'item', label: 'Reveal in File Explorer', onSelect: actions.reveal },
    { type: 'item', label: 'Open Externally', onSelect: actions.openExternal },
  ];
}
