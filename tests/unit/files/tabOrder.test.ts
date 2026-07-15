import { describe, expect, it } from 'vitest';
import { moveTabRelative, tabDropPlaceFromPoint } from '@shared/files/tabOrder';

describe('moveTabRelative', () => {
  it('moves a tab left before the drop target', () => {
    expect(moveTabRelative(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('moves a tab right after the drop target', () => {
    expect(moveTabRelative(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
  });

  it('moves a tab right before the drop target', () => {
    expect(moveTabRelative(['a', 'b', 'c'], 'a', 'c', 'before')).toEqual(['b', 'a', 'c']);
  });

  it('is a no-op when source and target match or are unknown', () => {
    const tabs = ['a', 'b', 'c'];
    expect(moveTabRelative(tabs, 'a', 'a', 'after')).toBe(tabs);
    expect(moveTabRelative(tabs, 'missing', 'a', 'before')).toBe(tabs);
    expect(moveTabRelative(tabs, 'a', 'missing', 'after')).toBe(tabs);
  });
});

describe('tabDropPlaceFromPoint', () => {
  it('uses the horizontal midpoint to choose before vs after', () => {
    const rect = { left: 100, width: 40 };
    expect(tabDropPlaceFromPoint(110, rect)).toBe('before');
    expect(tabDropPlaceFromPoint(130, rect)).toBe('after');
  });
});
