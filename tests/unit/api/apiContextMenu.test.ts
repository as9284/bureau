import { describe, expect, it, vi } from 'vitest';
import {
  buildCollectionMenuItems,
  buildDocumentTabMenuItems,
  formatStreamLine,
} from '@renderer/features/api/apiContextMenu';
import type { ApiCollectionNode, ApiStreamEntry } from '@shared/contracts/apiWorkbench';

const noopActions = {
  open: vi.fn(),
  createFolder: vi.fn(),
  createRequest: vi.fn(),
  rename: vi.fn(),
  duplicate: vi.fn(),
  copyAsCurl: vi.fn(),
  copyId: vi.fn(),
  remove: vi.fn(),
};

function labels(items: ReturnType<typeof buildCollectionMenuItems>): string[] {
  return items.filter((item) => item.type === 'item').map((item) => item.label);
}

describe('buildCollectionMenuItems', () => {
  it('returns request actions for a request node', () => {
    const node: ApiCollectionNode = {
      collectionId: 'col-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'request',
      name: 'List users',
      order: 0,
      requestId: 'req-1',
      variables: [],
      revision: 1,
    };
    expect(labels(buildCollectionMenuItems(node, noopActions))).toEqual([
      'Open',
      'Copy as cURL',
      'Copy request ID',
      'Rename…',
      'Duplicate',
      'Delete request',
    ]);
  });

  it('returns folder actions for a folder node', () => {
    const node: ApiCollectionNode = {
      collectionId: 'col-2',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'folder',
      name: 'Auth',
      order: 0,
      variables: [],
      revision: 1,
    };
    expect(labels(buildCollectionMenuItems(node, noopActions))).toEqual([
      'New folder',
      'New request',
      'Copy folder ID',
      'Rename…',
      'Duplicate',
      'Delete folder',
    ]);
  });
});

describe('buildDocumentTabMenuItems', () => {
  it('returns tab actions with dirty/save state reflected', () => {
    const items = buildDocumentTabMenuItems(
      { dirty: true, canCloseOthers: true, canSave: true },
      {
        close: vi.fn(),
        closeOthers: vi.fn(),
        closeAll: vi.fn(),
        save: vi.fn(),
        discard: vi.fn(),
        copyAsCurl: vi.fn(),
        remove: vi.fn(),
      }
    );
    expect(labels(items)).toEqual([
      'Close',
      'Close Others',
      'Close All',
      'Save',
      'Discard changes',
      'Copy as cURL',
      'Delete request',
    ]);
    const discard = items.find((item) => item.type === 'item' && item.label === 'Discard changes');
    expect(discard?.type === 'item' && discard.disabled).toBe(false);
  });

  it('disables discard and save when the tab is clean', () => {
    const items = buildDocumentTabMenuItems(
      { dirty: false, canCloseOthers: false, canSave: false },
      {
        close: vi.fn(),
        closeOthers: vi.fn(),
        closeAll: vi.fn(),
        save: vi.fn(),
        discard: vi.fn(),
        copyAsCurl: vi.fn(),
        remove: vi.fn(),
      }
    );
    const byLabel = Object.fromEntries(
      items.filter((item) => item.type === 'item').map((item) => [item.label, item])
    );
    expect(byLabel['Close Others']?.type === 'item' && byLabel['Close Others'].disabled).toBe(true);
    expect(byLabel.Save?.type === 'item' && byLabel.Save.disabled).toBe(true);
    expect(byLabel['Discard changes']?.type === 'item' && byLabel['Discard changes'].disabled).toBe(
      true
    );
  });
});

describe('formatStreamLine', () => {
  it('formats a transcript row for copy', () => {
    const entry: ApiStreamEntry = {
      entryId: 'e1',
      seq: 1,
      at: '2026-07-30T14:22:01.123Z',
      kind: 'message',
      direction: 'in',
      text: '{"ok":true}',
    };
    expect(formatStreamLine(entry)).toBe('14:22:01.123 message {"ok":true}');
  });
});
