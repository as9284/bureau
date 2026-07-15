import { describe, expect, it } from 'vitest';
import { saveWorkspaceStateRequestSchema } from '@shared/validation/files';

describe('files workspace validation', () => {
  it('rejects traversal keys and oversized mode/cursor maps', () => {
    const base = {
      state: {
        projectId: '11111111-1111-4111-8111-111111111111',
        openPaths: [],
        activePath: null,
        expandedPaths: [],
        recentPaths: [],
        pinnedPaths: [],
        modeByPath: {},
        cursorByPath: {},
        explorerWidth: 260,
        updatedAt: new Date().toISOString(),
      },
    };
    expect(saveWorkspaceStateRequestSchema.safeParse({
      state: { ...base.state, modeByPath: { '../escape': 'edit' } },
    }).success).toBe(false);

    const huge: Record<string, 'edit'> = {};
    for (let index = 0; index < 201; index += 1) huge[`file-${index}.md`] = 'edit';
    expect(saveWorkspaceStateRequestSchema.safeParse({
      state: { ...base.state, modeByPath: huge },
    }).success).toBe(false);

    expect(saveWorkspaceStateRequestSchema.safeParse({
      state: { ...base.state, modeByPath: { 'docs/readme.md': 'preview' }, cursorByPath: { 'docs/readme.md': { line: 1, column: 1, scrollTop: 0 } } },
    }).success).toBe(true);
  });
});
