import { describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '@shared/contracts/files';
import {
  buildExplorerBackgroundMenuItems,
  buildExplorerContextMenuItems,
} from '@renderer/features/files/explorerContextMenu';

function entry(relativePath: string, kind: FileEntry['kind']): FileEntry {
  return {
    name: relativePath.split('/').pop() ?? relativePath,
    relativePath,
    kind,
    size: 0,
    modifiedAt: new Date().toISOString(),
    ignored: false,
  };
}

describe('buildExplorerContextMenuItems', () => {
  const actions = {
    open: vi.fn(),
    beginCreate: vi.fn(),
    rename: vi.fn(),
    duplicate: vi.fn(),
    trash: vi.fn(),
    reveal: vi.fn(),
    openExternal: vi.fn(),
  };

  it('offers file actions without new-entry items', () => {
    const labels = buildExplorerContextMenuItems(entry('src/app.ts', 'text'), 'E:\\proj', actions)
      .filter((item) => item.type === 'item')
      .map((item) => item.label);
    expect(labels).toEqual([
      'Open',
      'Copy Path',
      'Copy Relative Path',
      'Reveal in File Explorer',
      'Open Externally',
      'Rename…',
      'Duplicate',
      'Move to Trash',
    ]);
  });

  it('offers folder create actions and omits open/duplicate/external', () => {
    const labels = buildExplorerContextMenuItems(entry('src', 'directory'), 'E:\\proj', actions)
      .filter((item) => item.type === 'item')
      .map((item) => item.label);
    expect(labels).toEqual([
      'New File…',
      'New Folder…',
      'Copy Path',
      'Copy Relative Path',
      'Reveal in File Explorer',
      'Rename…',
      'Move to Trash',
    ]);
  });
});

describe('buildExplorerBackgroundMenuItems', () => {
  it('only offers create actions for empty explorer chrome', () => {
    const labels = buildExplorerBackgroundMenuItems({ beginCreate: vi.fn() })
      .filter((item) => item.type === 'item')
      .map((item) => item.label);
    expect(labels).toEqual(['New File…', 'New Folder…']);
  });
});
