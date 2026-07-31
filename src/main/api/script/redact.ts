/**
 * Secret redaction for everything a script emits.
 *
 * A script may read a secret variable (§13.2) to use it in the current request, so a secret value
 * can legitimately be inside the sandbox. What must never happen is that value coming back out
 * into console output, an assertion message, an error, history, or an exported run report — so the
 * host redacts on the way out rather than trying to keep secrets out on the way in.
 */

const PLACEHOLDER = '«redacted»';

/**
 * Below this length a "secret" is more likely to be a common substring (`1`, `abc`) than a
 * credential, and blanket-replacing it would corrupt unrelated output.
 */
const MIN_REDACTABLE_LENGTH = 4;

export type Redactor = (text: string) => string;

export function createRedactor(secrets: Iterable<string | undefined>): Redactor {
  const values: string[] = [];
  for (const secret of secrets) {
    if (!secret || secret.length < MIN_REDACTABLE_LENGTH) continue;
    if (!values.includes(secret)) values.push(secret);
  }
  // Longest first, so a secret that contains another is replaced whole.
  values.sort((a, b) => b.length - a.length);
  if (values.length === 0) return (text) => text;
  return (text) => {
    let result = text;
    for (const value of values) result = result.split(value).join(PLACEHOLDER);
    return result;
  };
}

export const REDACTED_PLACEHOLDER = PLACEHOLDER;
