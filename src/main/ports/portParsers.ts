export type RawPortRow = {
  protocol: 'tcp' | 'udp';
  address: string;
  port: number;
  pid: number | null;
};

/** Parses Windows `netstat -ano` output. */
export function parseNetstatOutput(stdout: string): RawPortRow[] {
  const rows: RawPortRow[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/^(TCP|UDP)/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    const proto = parts[0].toLowerCase() === 'udp' ? 'udp' : 'tcp';
    const local = parts[1];
    // TCP rows carry a state column (`Proto Local Foreign STATE PID`); UDP rows omit it
    // (`Proto Local Foreign PID`). The PID is always the final token either way.
    if (proto === 'tcp' && parts[3] !== 'LISTENING') continue;
    const pidToken = parts[parts.length - 1];
    const endpoint = parseEndpoint(local);
    if (!endpoint) continue;
    const pid = Number.parseInt(pidToken, 10);
    rows.push({
      protocol: proto,
      address: endpoint.address,
      port: endpoint.port,
      pid: Number.isFinite(pid) ? pid : null,
    });
  }
  return dedupeRows(rows);
}

/** Parses POSIX `lsof -nP -iTCP -sTCP:LISTEN` style output. */
export function parseLsofOutput(stdout: string): RawPortRow[] {
  const rows: RawPortRow[] = [];
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    // With `-sTCP:LISTEN` the NAME column is followed by a `(LISTEN)` state token, so the
    // address is the second-to-last field. Fall back to the last field when no state suffix.
    const last = parts[parts.length - 1] ?? '';
    const name = /^\(.*\)$/.test(last) ? (parts[parts.length - 2] ?? '') : last;
    const pid = Number.parseInt(parts[1] ?? '', 10);
    const endpoint = parseEndpoint(name.includes('->') ? name.split('->')[0] : name);
    if (!endpoint) continue;
    rows.push({
      protocol: 'tcp',
      address: endpoint.address,
      port: endpoint.port,
      pid: Number.isFinite(pid) ? pid : null,
    });
  }
  return dedupeRows(rows);
}

function parseEndpoint(value: string): { address: string; port: number } | null {
  // Bracketed IPv6, e.g. `[::]:135` or `[fe80::1%12]:8080` → address inside the brackets.
  const bracketed = value.match(/^\[(.+)\]:(\d+)$/);
  const match = bracketed ?? value.match(/^(.*?):(\d+)$/);
  if (!match) return null;
  const port = Number.parseInt(match[2], 10);
  if (!Number.isFinite(port)) return null;
  return { address: match[1] || '*', port };
}

function dedupeRows(rows: RawPortRow[]): RawPortRow[] {
  const seen = new Set<string>();
  const out: RawPortRow[] = [];
  for (const row of rows) {
    const key = `${row.protocol}:${row.address}:${row.port}:${row.pid ?? 'none'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => a.port - b.port);
}

export function extractPortFromUrl(url: string | undefined): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number.parseInt(parsed.port, 10);
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return null;
  }
}
