import { describe, it, expect } from 'vitest';
import { orderProjectTabs, PROJECT_TAB_LABELS } from '@renderer/lib/projectTabs';
import { PROJECT_TAB_IDS, sanitizeProjectTabOrder } from '@shared/contracts/settings';

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
      'terminal',
      'preview',
      'android',
    ] as const;
    expect(orderProjectTabs([...saved])).toEqual([...saved]);
  });

  it('appends tabs missing from a partial order in their default position', () => {
    expect(orderProjectTabs(['git', 'files'])).toEqual([
      'git',
      'files',
      'overview',
      'processes',
      'terminal',
      'preview',
      'android',
    ]);
  });

  it('drops unknown ids and de-duplicates repeats', () => {
    expect(orderProjectTabs(['git', 'git', 'nope' as never, 'files'])).toEqual([
      'git',
      'files',
      'overview',
      'processes',
      'terminal',
      'preview',
      'android',
    ]);
  });

  it('has a label for every canonical tab', () => {
    for (const id of PROJECT_TAB_IDS) {
      expect(PROJECT_TAB_LABELS[id]).toBeTruthy();
    }
  });
});

describe('sanitizeProjectTabOrder', () => {
  it('drops removed tab ids such as toolchains and ports', () => {
    expect(
      sanitizeProjectTabOrder([
        'overview',
        'toolchains',
        'ports',
        'git',
        'files',
      ])
    ).toEqual(['overview', 'git', 'files']);
  });

  it('returns undefined for empty or non-array input', () => {
    expect(sanitizeProjectTabOrder(undefined)).toBeUndefined();
    expect(sanitizeProjectTabOrder([])).toBeUndefined();
    expect(sanitizeProjectTabOrder('nope')).toBeUndefined();
  });
});
