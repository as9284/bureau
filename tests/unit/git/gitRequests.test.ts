import { describe, it, expect } from 'vitest';
import {
  branchCreateRequestSchema,
  branchPublishRequestSchema,
  cloneRequestSchema,
  diffRequestSchema,
  listCommitFilesRequestSchema,
} from '../../../src/shared/validation/gitRequests';

const PROJECT_ID = '00000000-0000-4000-8000-000000000000';
const SNAPSHOT = 'abcdef0123456789';

describe('git request validation — argument-injection hardening', () => {
  it('rejects a non-hex commitOid (blocks `git show --output=…` injection)', () => {
    expect(
      diffRequestSchema.safeParse({
        projectId: PROJECT_ID,
        path: 'src/a.ts',
        area: 'commit',
        commitOid: '--output=/tmp/pwn',
      }).success
    ).toBe(false);
    expect(
      listCommitFilesRequestSchema.safeParse({ projectId: PROJECT_ID, commitOid: '-rf' }).success
    ).toBe(false);
    expect(
      listCommitFilesRequestSchema.safeParse({ projectId: PROJECT_ID, commitOid: 'a1b2c3d' }).success
    ).toBe(true);
  });

  it('rejects a dash-leading branch startPoint (blocks `git branch -D` injection)', () => {
    const base = { projectId: PROJECT_ID, snapshotRevision: SNAPSHOT, branchName: 'feature' };
    expect(branchCreateRequestSchema.safeParse({ ...base, startPoint: '-D' }).success).toBe(false);
    expect(branchCreateRequestSchema.safeParse({ ...base, startPoint: 'main' }).success).toBe(true);
  });

  it('rejects dangerous remote URLs (ext::/fd:: transports, dash options)', () => {
    const clone = (url: string) =>
      cloneRequestSchema.safeParse({ url, parentDirectory: '/tmp', folderName: 'repo' }).success;
    expect(clone('ext::sh -c "touch /tmp/pwn"')).toBe(false);
    expect(clone('fd::17')).toBe(false);
    expect(clone('--upload-pack=/bin/sh')).toBe(false);
    // Legitimate forms still pass.
    expect(clone('https://github.com/owner/repo.git')).toBe(true);
    expect(clone('git@github.com:owner/repo.git')).toBe(true);
    expect(clone('ssh://git@host/owner/repo.git')).toBe(true);

    const publish = (remoteUrl: string) =>
      branchPublishRequestSchema.safeParse({
        projectId: PROJECT_ID,
        snapshotRevision: SNAPSHOT,
        remoteUrl,
      }).success;
    expect(publish('ext::sh -c evil')).toBe(false);
    expect(publish('https://github.com/owner/repo.git')).toBe(true);
  });
});
