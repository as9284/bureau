import { describe, it, expect } from 'vitest';
import {
  addRemoteRequestSchema,
  branchCreateRequestSchema,
  branchPublishRequestSchema,
  checkoutCommitRequestSchema,
  cherryPickRequestSchema,
  cloneRequestSchema,
  diffRequestSchema,
  listCommitFilesRequestSchema,
  mergeBranchRequestSchema,
  rebaseBranchRequestSchema,
  reflogRequestSchema,
  removeRemoteRequestSchema,
  renameRemoteRequestSchema,
  resetToCommitRequestSchema,
  revertCommitRequestSchema,
  setRemoteUrlRequestSchema,
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

  // These refs become argv for `git merge <ref>` / `git rebase <ref>`, where a
  // dash-leading value would be parsed as an option (e.g. `git rebase --exec=…`
  // runs a shell command per commit).
  it('rejects dash-leading refs for merge and rebase', () => {
    const base = { projectId: PROJECT_ID, snapshotRevision: SNAPSHOT };
    const merge = (branchName: string) =>
      mergeBranchRequestSchema.safeParse({ ...base, branchName }).success;
    const rebase = (ontoRef: string) =>
      rebaseBranchRequestSchema.safeParse({ ...base, ontoRef }).success;

    expect(merge('--no-verify')).toBe(false);
    expect(rebase('--exec=touch /tmp/pwn')).toBe(false);
    expect(merge('')).toBe(false);
    expect(rebase('a'.repeat(256))).toBe(false);

    // Local names and remote-tracking refs both stay valid.
    expect(merge('feature/x')).toBe(true);
    expect(rebase('origin/main')).toBe(true);
  });

  // `commitOid` and `mode` are interpolated into `git reset --<mode> <oid>`. A
  // dash-leading target would be read as an option (`git reset --hard --quiet` is
  // benign, but `--` forms are not something we want reachable from a payload).
  it('rejects a dash-leading or non-hex reset target', () => {
    const base = { projectId: PROJECT_ID, snapshotRevision: SNAPSHOT, mode: 'hard' as const };
    const reset = (commitOid: string) =>
      resetToCommitRequestSchema.safeParse({ ...base, commitOid }).success;

    expect(reset('--hard')).toBe(false);
    expect(reset('-rf')).toBe(false);
    expect(reset('HEAD~1')).toBe(false);
    expect(reset('origin/main')).toBe(false);
    expect(reset('')).toBe(false);
    // Abbreviated and full oids are the only accepted forms.
    expect(reset('a1b2c3d')).toBe(true);
    expect(reset('0'.repeat(40))).toBe(true);
  });

  it('rejects an unknown reset mode and unknown keys', () => {
    const base = {
      projectId: PROJECT_ID,
      snapshotRevision: SNAPSHOT,
      commitOid: 'a1b2c3d',
    };
    expect(resetToCommitRequestSchema.safeParse({ ...base, mode: 'keep' }).success).toBe(false);
    expect(resetToCommitRequestSchema.safeParse({ ...base, mode: 'merge' }).success).toBe(false);
    expect(resetToCommitRequestSchema.safeParse(base).success).toBe(false);
    expect(
      resetToCommitRequestSchema.safeParse({ ...base, mode: 'soft', extra: true }).success
    ).toBe(false);
    for (const mode of ['soft', 'mixed', 'hard']) {
      expect(resetToCommitRequestSchema.safeParse({ ...base, mode }).success).toBe(true);
    }
  });

  it('accepts only a bounded page window on reflog requests', () => {
    expect(reflogRequestSchema.safeParse({ projectId: PROJECT_ID }).success).toBe(true);
    expect(reflogRequestSchema.safeParse({ projectId: PROJECT_ID, limit: 50 }).success).toBe(true);
    expect(reflogRequestSchema.safeParse({ projectId: PROJECT_ID, limit: 0 }).success).toBe(false);
    expect(reflogRequestSchema.safeParse({ projectId: PROJECT_ID, limit: 101 }).success).toBe(false);
    expect(reflogRequestSchema.safeParse({ projectId: 'not-a-uuid' }).success).toBe(false);
    // Reflog is HEAD-only: there is no ref to smuggle in.
    expect(reflogRequestSchema.safeParse({ projectId: PROJECT_ID, ref: '--all' }).success).toBe(
      false
    );
  });

  it('rejects unknown keys and missing refs on merge/rebase requests', () => {
    const base = { projectId: PROJECT_ID, snapshotRevision: SNAPSHOT };
    expect(mergeBranchRequestSchema.safeParse(base).success).toBe(false);
    expect(rebaseBranchRequestSchema.safeParse(base).success).toBe(false);
    expect(
      mergeBranchRequestSchema.safeParse({ ...base, branchName: 'main', extra: true }).success
    ).toBe(false);
  });

  // `-m <n>` reaches argv as a number, so the bound is about it staying a plausible
  // parent index rather than about injection. Absent is the ordinary-commit case and
  // must stay valid — git rejects `-m` on a non-merge commit.
  it('bounds the revert/cherry-pick mainline to a real parent index', () => {
    const base = { projectId: PROJECT_ID, snapshotRevision: SNAPSHOT, commitOid: 'a1b2c3d' };
    for (const schema of [revertCommitRequestSchema, cherryPickRequestSchema]) {
      expect(schema.safeParse(base).success).toBe(true);
      expect(schema.safeParse({ ...base, mainline: 1 }).success).toBe(true);
      expect(schema.safeParse({ ...base, mainline: 2 }).success).toBe(true);

      expect(schema.safeParse({ ...base, mainline: 0 }).success).toBe(false);
      expect(schema.safeParse({ ...base, mainline: -1 }).success).toBe(false);
      expect(schema.safeParse({ ...base, mainline: 1.5 }).success).toBe(false);
      expect(schema.safeParse({ ...base, mainline: 17 }).success).toBe(false);
      expect(schema.safeParse({ ...base, mainline: '1' }).success).toBe(false);
      // The oid guard still applies alongside the new field.
      expect(schema.safeParse({ ...base, commitOid: '--hard', mainline: 1 }).success).toBe(false);
      expect(schema.safeParse({ ...base, mainline: 1, extra: true }).success).toBe(false);
    }
  });

  it('accepts only an oid for a detached checkout', () => {
    const base = { projectId: PROJECT_ID, snapshotRevision: SNAPSHOT };
    expect(checkoutCommitRequestSchema.safeParse({ ...base, commitOid: 'a1b2c3d' }).success).toBe(
      true
    );
    expect(checkoutCommitRequestSchema.safeParse({ ...base, commitOid: '--orphan' }).success).toBe(
      false
    );
    expect(checkoutCommitRequestSchema.safeParse({ ...base, commitOid: 'main' }).success).toBe(
      false
    );
    expect(checkoutCommitRequestSchema.safeParse(base).success).toBe(false);
  });

  // The whole point of routing remote URLs through the shared remoteUrlSchema: a
  // stored `ext::sh -c …` remote is arbitrary code execution on the next fetch/push,
  // not merely a bad-looking string.
  it('rejects remote-helper RCE transports and dash-leading URLs on add/set-url', () => {
    const base = { projectId: PROJECT_ID, snapshotRevision: SNAPSHOT, name: 'origin' };
    const add = (url: string) => addRemoteRequestSchema.safeParse({ ...base, url }).success;
    const setUrl = (url: string) => setRemoteUrlRequestSchema.safeParse({ ...base, url }).success;

    for (const check of [add, setUrl]) {
      expect(check('ext::sh -c "touch /tmp/pwn"')).toBe(false);
      expect(check('ext::sh -c whoami')).toBe(false);
      expect(check('fd::17')).toBe(false);
      expect(check('--upload-pack=/bin/sh')).toBe(false);
      expect(check('-u')).toBe(false);
      expect(check('')).toBe(false);

      // Legitimate forms still pass.
      expect(check('https://github.com/owner/repo.git')).toBe(true);
      expect(check('git@github.com:owner/repo.git')).toBe(true);
      expect(check('ssh://git@host/owner/repo.git')).toBe(true);
      expect(check('C:\\Projects\\mirror.git')).toBe(true);
    }
  });

  it('dash-guards remote names on every remote mutation', () => {
    const base = { projectId: PROJECT_ID, snapshotRevision: SNAPSHOT };
    const url = 'https://github.com/owner/repo.git';

    expect(addRemoteRequestSchema.safeParse({ ...base, name: '-f', url }).success).toBe(false);
    expect(addRemoteRequestSchema.safeParse({ ...base, name: '--mirror', url }).success).toBe(false);
    expect(removeRemoteRequestSchema.safeParse({ ...base, name: '-rf' }).success).toBe(false);
    expect(removeRemoteRequestSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    // Both sides of a rename are argv.
    expect(
      renameRemoteRequestSchema.safeParse({ ...base, name: 'origin', newName: '-x' }).success
    ).toBe(false);
    expect(
      renameRemoteRequestSchema.safeParse({ ...base, name: '-x', newName: 'origin' }).success
    ).toBe(false);
    // A remote name becomes a refspec component, so path/glob characters are out too.
    expect(addRemoteRequestSchema.safeParse({ ...base, name: 'a/b', url }).success).toBe(false);
    expect(addRemoteRequestSchema.safeParse({ ...base, name: 'a b', url }).success).toBe(false);
    expect(addRemoteRequestSchema.safeParse({ ...base, name: 'a'.repeat(101), url }).success).toBe(
      false
    );

    // The names people actually use still pass.
    expect(addRemoteRequestSchema.safeParse({ ...base, name: 'origin', url }).success).toBe(true);
    expect(addRemoteRequestSchema.safeParse({ ...base, name: 'upstream', url }).success).toBe(true);
    expect(addRemoteRequestSchema.safeParse({ ...base, name: 'my-fork.2', url }).success).toBe(true);
    expect(
      renameRemoteRequestSchema.safeParse({ ...base, name: 'origin', newName: 'upstream' }).success
    ).toBe(true);
    expect(removeRemoteRequestSchema.safeParse({ ...base, name: 'origin' }).success).toBe(true);
  });

  it('rejects unknown keys on remote requests', () => {
    const base = { projectId: PROJECT_ID, snapshotRevision: SNAPSHOT, name: 'origin' };
    expect(
      addRemoteRequestSchema.safeParse({
        ...base,
        url: 'https://github.com/o/r.git',
        extra: true,
      }).success
    ).toBe(false);
    expect(removeRemoteRequestSchema.safeParse({ ...base, force: true }).success).toBe(false);
  });
});
