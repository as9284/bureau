import { describe, it, expect } from 'vitest';
import { pushEnv } from '../../../src/main/gitea/GiteaPublishingService';
import type { GitVersion } from '../../../src/main/git/gitTypes';

const version = (major: number, minor: number, patch = 0): GitVersion => ({
  raw: `git version ${major}.${minor}.${patch}`,
  major,
  minor,
  patch,
});

const CLONE_URL = 'https://gitea.example.com/ana/demo.git';

describe('pushEnv — token delivery for a Gitea push', () => {
  it('passes the credential through the environment, never through argv', () => {
    const env = pushEnv(CLONE_URL, 'ana', 's3cret', version(2, 43));
    expect(env).toBeDefined();
    expect(env?.GIT_CONFIG_COUNT).toBe('1');
    expect(env?.GIT_CONFIG_KEY_0).toBe(`http.${CLONE_URL}.extraHeader`);
    expect(env?.GIT_CONFIG_VALUE_0).toBe(
      `Authorization: Basic ${Buffer.from('ana:s3cret').toString('base64')}`
    );
  });

  it('scopes the header to the clone URL so a redirect cannot replay it', () => {
    const env = pushEnv(CLONE_URL, 'ana', 's3cret', version(2, 43));
    expect(env?.GIT_CONFIG_KEY_0).not.toBe('http.extraHeader');
  });

  it('carries the parent environment through, since GitRunner replaces env wholesale', () => {
    const env = pushEnv(CLONE_URL, 'ana', 's3cret', version(2, 43));
    // PATH is required for git to find its own helpers on every platform.
    const hasPath = Object.keys(env ?? {}).some((key) => key.toUpperCase() === 'PATH');
    expect(hasPath).toBe(true);
  });

  it('declines on git < 2.31, which ignores GIT_CONFIG_* env config', () => {
    expect(pushEnv(CLONE_URL, 'ana', 's3cret', version(2, 30, 9))).toBeUndefined();
    expect(pushEnv(CLONE_URL, 'ana', 's3cret', version(2, 25))).toBeUndefined();
    expect(pushEnv(CLONE_URL, 'ana', 's3cret', version(2, 31))).toBeDefined();
    expect(pushEnv(CLONE_URL, 'ana', 's3cret', version(3, 0))).toBeDefined();
  });

  it('declines for an SSH remote, where an HTTP header would do nothing', () => {
    expect(
      pushEnv('git@gitea.example.com:ana/demo.git', 'ana', 's3cret', version(2, 43))
    ).toBeUndefined();
    expect(
      pushEnv('ssh://gitea.example.com/ana/demo.git', 'ana', 's3cret', version(2, 43))
    ).toBeUndefined();
  });
});
