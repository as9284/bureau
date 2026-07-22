import { describe, it, expect } from 'vitest';
import {
  giteaConnectRequestSchema,
  giteaHostUrlSchema,
  giteaPublishRequestSchema,
} from '../../../src/shared/validation/giteaRequests';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';
const SNAPSHOT = 'abcdef0123456789';

function publishInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    snapshotRevision: SNAPSHOT,
    branchName: 'main',
    repositoryName: 'my-project',
    visibility: 'private',
    ...overrides,
  };
}

describe('gitea host URL validation', () => {
  it('accepts an HTTPS instance and a LAN instance over plain HTTP', () => {
    expect(giteaHostUrlSchema.safeParse('https://gitea.example.com').success).toBe(true);
    expect(giteaHostUrlSchema.safeParse('http://192.168.1.10:3000').success).toBe(true);
  });

  it('accepts a subpath install', () => {
    expect(giteaHostUrlSchema.safeParse('https://example.com/gitea').success).toBe(true);
  });

  it('rejects credentials in the URL, so the token has no second home', () => {
    expect(giteaHostUrlSchema.safeParse('https://user:pass@gitea.example.com').success).toBe(false);
  });

  it('rejects non-HTTP schemes', () => {
    expect(giteaHostUrlSchema.safeParse('file:///etc/passwd').success).toBe(false);
    expect(giteaHostUrlSchema.safeParse('ssh://gitea.example.com').success).toBe(false);
    expect(giteaHostUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });

  it('rejects query and fragment, which the origin is never used with', () => {
    expect(giteaHostUrlSchema.safeParse('https://gitea.example.com/?a=1').success).toBe(false);
    expect(giteaHostUrlSchema.safeParse('https://gitea.example.com/#x').success).toBe(false);
  });
});

describe('gitea connect request validation', () => {
  it('accepts a plain token', () => {
    const parsed = giteaConnectRequestSchema.safeParse({
      hostUrl: 'https://gitea.example.com',
      token: 'abc123',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a token carrying CR/LF (header injection into the API request)', () => {
    const parsed = giteaConnectRequestSchema.safeParse({
      hostUrl: 'https://gitea.example.com',
      token: 'abc\r\nX-Evil: 1',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a token with surrounding whitespace rather than silently trimming', () => {
    expect(
      giteaConnectRequestSchema.safeParse({
        hostUrl: 'https://gitea.example.com',
        token: ' abc123 ',
      }).success
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      giteaConnectRequestSchema.safeParse({
        hostUrl: 'https://gitea.example.com',
        token: 'abc123',
        extra: true,
      }).success
    ).toBe(false);
  });
});

describe('gitea publish request validation', () => {
  it('accepts a well-formed request', () => {
    expect(giteaPublishRequestSchema.safeParse(publishInput()).success).toBe(true);
  });

  it('rejects a branch name that git would parse as an option', () => {
    expect(giteaPublishRequestSchema.safeParse(publishInput({ branchName: '--upload-pack=x' }))
      .success).toBe(false);
  });

  it('rejects path traversal in the repository name', () => {
    expect(giteaPublishRequestSchema.safeParse(publishInput({ repositoryName: '..' })).success).toBe(
      false
    );
    expect(
      giteaPublishRequestSchema.safeParse(publishInput({ repositoryName: 'a/../b' })).success
    ).toBe(false);
  });

  it('rejects an owner that would escape the API path segment', () => {
    expect(giteaPublishRequestSchema.safeParse(publishInput({ owner: 'acme/repos' })).success).toBe(
      false
    );
    expect(giteaPublishRequestSchema.safeParse(publishInput({ owner: '-acme' })).success).toBe(false);
  });

  it('accepts Gitea owner names with dots and underscores', () => {
    expect(giteaPublishRequestSchema.safeParse(publishInput({ owner: 'a.b_c-d' })).success).toBe(
      true
    );
  });

  it('rejects a visibility outside the closed set', () => {
    expect(giteaPublishRequestSchema.safeParse(publishInput({ visibility: 'internal' })).success).toBe(
      false
    );
  });
});
