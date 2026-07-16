import { describe, it, expect } from 'vitest';
import { orderProjectTabs, PROJECT_TAB_LABELS } from '@renderer/lib/projectTabs';
import { PROJECT_TAB_IDS } from '@shared/contracts/settings';

describe('orderProjectTabs', () => {
  it('returns the canonical order when nothing is saved', () => {
    expect(orderProjectTabs(undefined)).toEqual([...PROJECT_TAB_IDS]);
    expect(orderProjectTabs([])).toEqual([...PROJECT_TAB_IDS]);
  });

  it('honours a full saved permutation', () => {
    const saved = [
      'git',
      'files',
      'overview',
      'processes',
      'preview',
      'android',
      'toolchains',
      'ports',
    ] as const;
    expect(orderProjectTabs([...saved])).toEqual([...saved]);
  });

  it('appends tabs missing from a partial order in their default position', () => {
    expect(orderProjectTabs(['git', 'files'])).toEqual([
      'git',
      'files',
      'overview',
      'processes',
      'preview',
      'android',
      'toolchains',
      'ports',
    ]);
  });

  it('drops unknown ids and de-duplicates repeats', () => {
    expect(orderProjectTabs(['git', 'git', 'nope' as never, 'files'])).toEqual([
      'git',
      'files',
      'overview',
      'processes',
      'preview',
      'android',
      'toolchains',
      'ports',
    ]);
  });

  it('has a label for every canonical tab', () => {
    for (const id of PROJECT_TAB_IDS) {
      expect(PROJECT_TAB_LABELS[id]).toBeTruthy();
    }
  });
});
