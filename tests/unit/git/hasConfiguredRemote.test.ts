import { describe, expect, it } from 'vitest';
import { hasConfiguredRemote } from '@shared/git/hasConfiguredRemote';

describe('hasConfiguredRemote', () => {
  it('is true when remotes are listed', () => {
    expect(
      hasConfiguredRemote({
        remotes: [{ name: 'origin' }],
        branchDetails: [],
      })
    ).toBe(true);
  });

  it('is true when remote-tracking branches exist', () => {
    expect(
      hasConfiguredRemote({
        remotes: [],
        branchDetails: [
          {
            kind: 'remote',
            published: true,
            remoteName: 'origin',
          },
        ],
      })
    ).toBe(true);
  });

  it('is false for a brand-new local-only repo', () => {
    expect(
      hasConfiguredRemote({
        remotes: [],
        branchDetails: [
          {
            kind: 'local',
            published: false,
          },
        ],
      })
    ).toBe(false);
  });
});
