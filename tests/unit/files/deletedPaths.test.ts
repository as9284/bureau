import { describe, expect, it } from 'vitest';
import { isPathDeleted, pathsAffectedByDelete } from '@shared/files/deletedPaths';
import { buildFileTabMenuItems } from '@renderer/features/files/fileTabContextMenu';

describe('pathsAffectedByDelete', () => {
  it('matches the deleted file and descendants of a deleted folder', () => {
    expect(pathsAffectedByDelete(['a.ts', 'src/a.ts', 'src/b.ts', 'lib/c.ts'], 'src')).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(pathsAffectedByDelete(['readme.md', 'src/a.ts'], 'readme.md')).toEqual(['readme.md']);
  });

  it('does not treat similarly prefixed siblings as descendants', () => {
    expect(pathsAffectedByDelete(['src2/a.ts', 'src/a.ts'], 'src')).toEqual(['src/a.ts']);
    expect(isPathDeleted('src2/a.ts', 'src')).toBe(false);
  });
});

describe('buildFileTabMenuItems', () => {
  it('includes close and path actions', () => {
    const items = buildFileTabMenuItems(
      'src/app.ts',
      'E:\\proj',
      { pinned: false, canCloseOthers: true },
      {
        close: () => undefined,
        closeOthers: () => undefined,
        closeAll: () => undefined,
        pin: () => undefined,
        reveal: () => undefined,
        openExternal: () => undefined,
      }
    );
    const labels = items.filter((item) => item.type === 'item').map((item) => item.label);
    expect(labels).toEqual([
      'Close',
      'Close Others',
      'Close All',
      'Pin',
      'Copy Path',
      'Copy Relative Path',
      'Reveal in File Explorer',
      'Open Externally',
    ]);
  });
});
