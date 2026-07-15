// Detects a local dev-server URL announced in process output.
const URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})?(?:\/[^\s'"]*)?/i;

/** Returns the first localhost URL found in a line of output, normalized, or undefined. */
export function detectLocalUrl(text: string): string | undefined {
  const match = URL_RE.exec(text);
  if (!match) return undefined;
  let url = match[0];
  // 0.0.0.0 is not browsable; present it as localhost.
  url = url.replace('0.0.0.0', 'localhost').replace('[::]', 'localhost');
  return url;
}
