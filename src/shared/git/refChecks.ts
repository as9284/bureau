/** Conservative OID hex pattern (abbreviated or full). */
export const OID_HEX_RE = /^[0-9a-f]{7,40}$/i;

/** Maximum ref name length accepted from UI. */
export const MAX_REF_NAME_LENGTH = 255;

export type RefFormatError = {
  code: 'INVALID_REF' | 'REF_LOOKS_LIKE_OPTION' | 'REF_TOO_LONG';
  message: string;
};

/** Pure checks that do not require Git. */
export function checkRefNameBasics(name: string): RefFormatError | undefined {
  if (!name || name.length === 0) {
    return { code: 'INVALID_REF', message: 'Ref name must not be empty.' };
  }
  if (name.length > MAX_REF_NAME_LENGTH) {
    return { code: 'REF_TOO_LONG', message: `Ref name exceeds ${MAX_REF_NAME_LENGTH} characters.` };
  }
  if (name.startsWith('-')) {
    return { code: 'REF_LOOKS_LIKE_OPTION', message: 'Ref name must not start with a dash.' };
  }
  if (name.includes('..')) {
    return { code: 'INVALID_REF', message: 'Ref name must not contain "..".' };
  }
  if (name.endsWith('.') || name.endsWith('/')) {
    return { code: 'INVALID_REF', message: 'Ref name must not end with "." or "/".' };
  }
  if (name.includes('//')) {
    return { code: 'INVALID_REF', message: 'Ref name must not contain consecutive slashes.' };
  }
  if (name.includes('@{')) {
    return { code: 'INVALID_REF', message: 'Ref name must not contain "@{"' };
  }
  if (name.includes('\\')) {
    return { code: 'INVALID_REF', message: 'Ref name must not contain backslashes.' };
  }
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) {
      return { code: 'INVALID_REF', message: 'Ref name contains control characters.' };
    }
  }
  return undefined;
}

export function isOidHex(value: string): boolean {
  return OID_HEX_RE.test(value);
}

export function checkOidFormat(oid: string): RefFormatError | undefined {
  if (!isOidHex(oid)) {
    return { code: 'INVALID_REF', message: 'OID must be 7–40 hexadecimal characters.' };
  }
  return undefined;
}

/** Redact credentials embedded in URLs for display. */
export function redactUrlCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '***' : '';
      parsed.password = parsed.password ? '***' : '';
      return parsed.toString();
    }
  } catch {
    // Not a standard URL — apply simple pattern redaction
    return url.replace(/:\/\/[^@/]+@/g, '://***@');
  }
  return url;
}
