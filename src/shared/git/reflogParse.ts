import type { ReflogEntry } from '../contracts/history';

/**
 * Fields requested from `git reflog show`, in order. Deliberately has no trailing
 * `%x00`: `-z` alone separates records, so each entry is a clean 4-field NUL group.
 * A trailing separator would inject an empty token between records that a naive
 * `filter(Boolean)` then conflates with a legitimately-empty field (e.g. `%gs`).
 */
export const REFLOG_FORMAT = '%gD%x00%H%x00%h%x00%gs';

const FIELD_COUNT = 4;

/**
 * `%gD` is the reflog selector. Under `--date=<fmt>` git renders it as
 * `HEAD@{2026-07-15T21:14:01+03:00}` rather than `HEAD@{0}` — the index and the
 * timestamp are mutually exclusive in git's output, so we take the timestamp here
 * and synthesize the index from the walk position (`startIndex`).
 */
function selectorDate(raw: string): string {
  const open = raw.indexOf('@{');
  if (open < 0 || !raw.endsWith('}')) return '';
  return raw.slice(open + 2, -1);
}

/**
 * Splits a reflog subject (`%gs`) into its action verb and remainder:
 * `commit: fix: the thing` → `commit` / `fix: the thing`. Entries with no colon
 * (git writes a bare subject for some actions) become all-action, empty-subject.
 */
function splitSubject(raw: string): { action: string; subject: string } {
  const colon = raw.indexOf(':');
  if (colon < 0) return { action: raw.trim(), subject: '' };
  return { action: raw.slice(0, colon).trim(), subject: raw.slice(colon + 1).trim() };
}

/**
 * Parses `-z`-separated `git reflog show --format=REFLOG_FORMAT` output.
 * `startIndex` is the walk offset (`--skip`), so selectors stay correct on page 2+.
 */
export function parseReflog(stdout: string, startIndex = 0): ReflogEntry[] {
  // Do NOT filter(Boolean): a reflog subject can be empty, and dropping it would
  // shift every subsequent field. The loop ignores the lone trailing token instead.
  const tokens = stdout.split('\0');
  const entries: ReflogEntry[] = [];

  for (let i = 0; i + FIELD_COUNT - 1 < tokens.length; i += FIELD_COUNT) {
    const [rawSelector, oid, abbreviatedOid, rawSubject] = tokens.slice(i, i + FIELD_COUNT);
    // A record with no oid is not an entry — guards against a trailing newline or
    // a stray token producing a phantom row with an unusable reset target.
    if (!oid) continue;
    const { action, subject } = splitSubject(rawSubject);
    entries.push({
      selector: `HEAD@{${startIndex + entries.length}}`,
      oid,
      abbreviatedOid,
      movedAt: selectorDate(rawSelector),
      action,
      subject,
    });
  }

  return entries;
}
