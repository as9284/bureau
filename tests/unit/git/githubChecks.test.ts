import { describe, expect, it } from 'vitest';
import { parseGitHubOwnerRepo } from '../../../src/shared/git/parseGitHubRemote';
import {
  checkItemTone,
  checkRollupLabel,
  checkRollupTone,
  formatCheckItemDetail,
  formatCheckTooltip,
  mapGitHubStatusState,
} from '../../../src/shared/git/checkRollup';
import {
  buildStatusCheckRollupQuery,
  summarizeCommitNode,
} from '../../../src/main/github/GitHubChecksService';

describe('parseGitHubOwnerRepo', () => {
  it('parses HTTPS remotes', () => {
    expect(parseGitHubOwnerRepo('https://github.com/acme/bureau.git')).toEqual({
      owner: 'acme',
      repo: 'bureau',
    });
    expect(parseGitHubOwnerRepo('https://www.github.com/acme/bureau')).toEqual({
      owner: 'acme',
      repo: 'bureau',
    });
  });

  it('parses SSH remotes', () => {
    expect(parseGitHubOwnerRepo('git@github.com:acme/bureau.git')).toEqual({
      owner: 'acme',
      repo: 'bureau',
    });
    expect(parseGitHubOwnerRepo('ssh://git@github.com/acme/bureau.git')).toEqual({
      owner: 'acme',
      repo: 'bureau',
    });
  });

  it('rejects non-GitHub hosts', () => {
    expect(parseGitHubOwnerRepo('https://gitlab.com/acme/bureau.git')).toBeUndefined();
    expect(parseGitHubOwnerRepo('git@gitea.example.com:acme/bureau.git')).toBeUndefined();
  });
});

describe('mapGitHubStatusState', () => {
  it('maps StatusState tokens', () => {
    expect(mapGitHubStatusState('SUCCESS')).toBe('success');
    expect(mapGitHubStatusState('FAILURE')).toBe('failure');
    expect(mapGitHubStatusState('ERROR')).toBe('error');
    expect(mapGitHubStatusState('PENDING')).toBe('pending');
    expect(mapGitHubStatusState('EXPECTED')).toBe('pending');
    expect(mapGitHubStatusState(null)).toBe('none');
  });
});

describe('checkRollup helpers', () => {
  it('labels and tones', () => {
    expect(checkRollupLabel('success')).toBe('Checks passing');
    expect(checkRollupTone('failure')).toBe('danger');
    expect(checkRollupTone('pending')).toBe('info');
  });

  it('formats individual check details', () => {
    expect(formatCheckItemDetail({ state: 'COMPLETED', conclusion: 'FAILURE' })).toBe('failure');
    expect(formatCheckItemDetail({ state: 'IN_PROGRESS' })).toBe('in progress');
    expect(checkItemTone({ state: 'COMPLETED', conclusion: 'SUCCESS' })).toBe('success');
    expect(checkItemTone({ state: 'QUEUED' })).toBe('info');
  });

  it('builds a multi-line tooltip', () => {
    const tip = formatCheckTooltip('failure', [
      { name: 'build', state: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'lint', state: 'COMPLETED', conclusion: 'SUCCESS' },
    ]);
    expect(tip).toContain('Checks failing');
    expect(tip).toContain('build: failure');
    expect(tip).toContain('lint: success');
  });
});

describe('GitHubChecksService GraphQL helpers', () => {
  it('embeds only hex OIDs as aliases', () => {
    const query = buildStatusCheckRollupQuery(['abc1234', 'def5678']);
    expect(query).toContain('c0: object(oid: "abc1234")');
    expect(query).toContain('c1: object(oid: "def5678")');
    expect(query).toContain('statusCheckRollup');
  });

  it('summarizes a rollup node', () => {
    const summary = summarizeCommitNode(
      'abc',
      {
        oid: 'ABCDEF',
        statusCheckRollup: {
          state: 'FAILURE',
          contexts: {
            nodes: [
              {
                __typename: 'CheckRun',
                name: 'CI',
                status: 'COMPLETED',
                conclusion: 'FAILURE',
                detailsUrl: 'https://github.com/acme/bureau/actions',
              },
              {
                __typename: 'StatusContext',
                context: 'coverage',
                state: 'SUCCESS',
                targetUrl: null,
              },
            ],
          },
        },
      },
      '2026-08-01T00:00:00.000Z'
    );
    expect(summary.state).toBe('failure');
    expect(summary.oid).toBe('abcdef');
    expect(summary.checks).toHaveLength(2);
    expect(summary.checks[0]?.name).toBe('CI');
    expect(summary.checks[1]?.name).toBe('coverage');
  });

  it('treats a missing rollup as none', () => {
    expect(summarizeCommitNode('abc', { oid: 'abc' }, 't').state).toBe('none');
    expect(summarizeCommitNode('abc', null, 't').state).toBe('none');
  });
});
