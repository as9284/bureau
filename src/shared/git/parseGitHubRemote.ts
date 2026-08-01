/**
 * Extract `owner/repo` from a GitHub remote URL.
 * Supports HTTPS, SSH (`git@github.com:…`), and `ssh://` forms.
 * Returns undefined for non-github.com hosts (including GitHub Enterprise).
 */
export function parseGitHubOwnerRepo(
  remoteUrl: string
): { owner: string; repo: string } | undefined {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return undefined;

  // git@github.com:owner/repo(.git)
  const scp = /^git@github\.com:(.+)$/i.exec(trimmed);
  if (scp) return splitOwnerRepo(scp[1]!);

  // ssh://git@github.com/owner/repo(.git)  or  https://github.com/owner/repo(.git)
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withScheme);
    const host = url.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return undefined;
    return splitOwnerRepo(url.pathname.replace(/^\/+/, ''));
  } catch {
    return undefined;
  }
}

function splitOwnerRepo(pathPart: string): { owner: string; repo: string } | undefined {
  const cleaned = pathPart
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean);
  if (cleaned.length < 2) return undefined;
  const owner = cleaned[0]!;
  const repo = cleaned[1]!;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner)) return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) return undefined;
  return { owner, repo };
}
