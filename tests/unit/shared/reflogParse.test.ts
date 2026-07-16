import { describe, it, expect } from 'vitest';
import { parseReflog, REFLOG_FORMAT } from '../../../src/shared/git/reflogParse';

/** Builds one `-z` record exactly as git emits it for REFLOG_FORMAT. */
function record(selector: string, oid: string, abbrev: string, subject: string): string {
  return [selector, oid, abbrev, subject].join('\0');
}

const OID_A = '596384d308c2a02671a7b1be9b9160b7749ed099';
const OID_B = '2760c39b6a84accb2c42ea35ebd19e957a1eb822';
const OID_C = '4b02b4c34c71218ff94e96015488cedf85f970ca';

describe('parseReflog', () => {
  // Captured from `git reflog show --date=iso-strict --format=<REFLOG_FORMAT> -z HEAD`
  // in this repository, including the trailing NUL git writes after the last record.
  const REAL_SAMPLE =
    [
      record('HEAD@{2026-07-15T21:14:01+03:00}', OID_A, '596384d', 'commit: 1.0.5'),
      record(
        'HEAD@{2026-07-15T21:13:42+03:00}',
        OID_B,
        '2760c39',
        'commit: QOL update and design fixes across the entire app'
      ),
      record('HEAD@{2026-07-15T20:47:06+03:00}', OID_C, '4b02b4c', 'reset: moving to HEAD'),
    ].join('\0') + '\0';

  it('parses real reflog output into entries', () => {
    const entries = parseReflog(REAL_SAMPLE);

    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      selector: 'HEAD@{0}',
      oid: OID_A,
      abbreviatedOid: '596384d',
      movedAt: '2026-07-15T21:14:01+03:00',
      action: 'commit',
      subject: '1.0.5',
    });
    expect(entries[2].action).toBe('reset');
    expect(entries[2].subject).toBe('moving to HEAD');
  });

  // The trailing NUL after the last record yields an empty token. Regression guard for
  // the listHistory-family bug: filter(Boolean) would drop legitimately-empty fields
  // and shift every subsequent one; the field loop must ignore the stray token instead.
  it('ignores the trailing separator without inventing a phantom entry', () => {
    expect(parseReflog(REAL_SAMPLE)).toHaveLength(3);
    expect(parseReflog('')).toEqual([]);
    expect(parseReflog('\0')).toEqual([]);
  });

  // Selectors are synthesized from the walk position because git renders `%gD` as
  // either the index or the date, never both — and we ask for the date.
  it('numbers selectors from the page offset so page 2 stays correct', () => {
    const entries = parseReflog(REAL_SAMPLE, 50);
    expect(entries.map((e) => e.selector)).toEqual(['HEAD@{50}', 'HEAD@{51}', 'HEAD@{52}']);
  });

  it('splits the action at the first colon only', () => {
    const entries = parseReflog(
      [
        record('HEAD@{2026-07-15T21:14:01+03:00}', OID_A, '596384d', 'commit: fix: nested colons'),
        record(
          'HEAD@{2026-07-15T21:13:42+03:00}',
          OID_B,
          '2760c39',
          'rebase (finish): returning to refs/heads/main'
        ),
        record(
          'HEAD@{2026-07-15T20:47:06+03:00}',
          OID_C,
          '4b02b4c',
          'clone: from https://github.com/owner/repo.git'
        ),
      ].join('\0')
    );

    expect(entries[0]).toMatchObject({ action: 'commit', subject: 'fix: nested colons' });
    expect(entries[1]).toMatchObject({
      action: 'rebase (finish)',
      subject: 'returning to refs/heads/main',
    });
    expect(entries[2]).toMatchObject({
      action: 'clone',
      subject: 'from https://github.com/owner/repo.git',
    });
  });

  it('handles a subject with no colon and an empty subject', () => {
    const entries = parseReflog(
      [
        record('HEAD@{2026-07-15T21:14:01+03:00}', OID_A, '596384d', 'initial pull'),
        record('HEAD@{2026-07-15T21:13:42+03:00}', OID_B, '2760c39', ''),
      ].join('\0')
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ action: 'initial pull', subject: '' });
    // An empty %gs must still produce an entry — it has a usable reset target.
    expect(entries[1]).toMatchObject({ oid: OID_B, action: '', subject: '' });
    expect(entries[1].selector).toBe('HEAD@{1}');
  });

  // A commit subject can itself contain `@{`/`}`; the date must come from the selector
  // field, not from a scan of the whole record.
  it('reads the date from the selector even when the subject contains @{', () => {
    const entries = parseReflog(
      record('HEAD@{2026-07-15T21:14:01+03:00}', OID_A, '596384d', 'commit: use HEAD@{1} in docs')
    );

    expect(entries[0].movedAt).toBe('2026-07-15T21:14:01+03:00');
    expect(entries[0].subject).toBe('use HEAD@{1} in docs');
  });

  it('leaves movedAt empty when the selector has no date (no --date passed)', () => {
    const entries = parseReflog(record('HEAD@{0}', OID_A, '596384d', 'commit: x'));
    // `HEAD@{0}` parses as an inner value of "0" — not a date, but never thrown away
    // as an entry, since the oid is what a reset actually needs.
    expect(entries[0].oid).toBe(OID_A);
  });

  it('drops a record with no oid rather than offering an unusable reset target', () => {
    const entries = parseReflog(record('HEAD@{2026-07-15T21:14:01+03:00}', '', '', ''));
    expect(entries).toEqual([]);
  });

  it('requests no trailing separator in the format string', () => {
    // The trailing-%x00 bug class: -z already separates records.
    expect(REFLOG_FORMAT.endsWith('%x00')).toBe(false);
    expect(REFLOG_FORMAT.split('%x00')).toHaveLength(4);
  });
});
