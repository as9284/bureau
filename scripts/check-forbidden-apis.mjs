#!/usr/bin/env node
// Static guard for Bureau's non-negotiable security boundaries.
// Dependency-free: recursively scans src/** and fails on any forbidden pattern.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** Normalised (forward-slash) repo-relative path, so `only`/`except` scoping is platform-neutral. */
function relPath(file) {
  return file.slice(ROOT.length + 1).replace(/\\/g, '/');
}

const RULES = [
  {
    id: 'SHELL-TRUE',
    // Disallow spawning through a shell — command-injection risk.
    re: /shell\s*:\s*true/,
    message: 'Do not spawn with { shell: true }. Resolve executables and pass array args.',
  },
  {
    id: 'EXEC-SHELL',
    re: /\b(execSync|spawnSync)\s*\(|[^.\w]exec\s*\(/,
    message: 'Do not use exec/execSync/spawnSync. Use spawn with shell:false.',
  },
  {
    id: 'CREDENTIAL-STORAGE',
    re: /(password|token|secret|apikey|api_key)\s*[:=]\s*['"][^'"]{6,}['"]/i,
    message: 'Do not hard-code credentials.',
    // IPC channel string literals are identifiers, not stored credentials.
    skipLine: (line) => line.includes("'bureau:"),
  },
  {
    id: 'TLS-VERIFICATION-DISABLED',
    re: /rejectUnauthorized\s*:\s*false/,
    message:
      'Do not disable TLS verification outside the audited host-scoped TLS policy module (src/main/api/TlsPolicy.ts).',
    except: ['src/main/api/TlsPolicy.ts'],
  },
  {
    id: 'NODE-VM-SANDBOX',
    re: /require\(\s*['"](?:node:)?vm['"]\s*\)|from\s+['"](?:node:)?vm['"]/,
    message: "Node's `vm` is not a security boundary. Use the bounded worker runtime instead.",
  },
  {
    id: 'SCRIPT-WORKER-HOST-ACCESS',
    // The sandbox worker must reach nothing but `worker_threads` and the two QuickJS packages the
    // host resolves for it. Anything else here would be reachable from a guest-triggered code path.
    re: /require\(\s*['"](?!node:worker_threads['"])[^'"]+['"]\s*\)/,
    message:
      'The script sandbox worker may only require node:worker_threads. Other modules are loaded by absolute path from workerData.',
    only: ['src/main/api/script/scriptWorker.js'],
  },
  {
    id: 'RENDERER-API-NETWORK',
    re: /\b(?:fetch|XMLHttpRequest|EventSource|WebSocket)\s*\(|new\s+(?:WebSocket|EventSource|XMLHttpRequest)\b/,
    message:
      'API workbench network traffic belongs in the main process. Call the typed preload bridge instead.',
    only: ['src/renderer/features/api/', 'src/renderer/store/apiStore.ts'],
  },
  {
    id: 'API-IPC-RENDERER',
    re: /\bipcRenderer\b/,
    message: 'The renderer never touches ipcRenderer. Use the frozen preload bridge.',
    only: ['src/renderer/'],
  },
  {
    id: 'API-PLAINTEXT-SECRET-PERSISTENCE',
    // Disk records may carry ciphertext and identifiers only — never a plaintext value.
    re: /\b(?:secretValue|plaintextSecret|tokenPlain|passwordPlain)\s*[?]?\s*:/,
    message:
      'API persistence records must store ciphertext only. Keep plaintext in memory and encrypt before writing.',
    only: ['src/main/api/'],
  },
  {
    id: 'WEBVIEW-TAG',
    re: /webviewTag\s*:\s*true|allowpopups/i,
    message: 'Do not enable <webview> / allowpopups. Use WebContentsView with a hardened session.',
  },
  {
    id: 'UNSAFE-PREVIEW-EMULATION',
    re: /\b(?:enable|disable)DeviceEmulation\s*\(/,
    message:
      'Do not call Chromium device emulation from the sandboxed preview WebContentsView; it crashes Electron 36 on Windows. Keep viewport sizing in previewGeometry instead.',
  },
];

/**
 * Patterns a file *must* contain. A missing safety call is as much a violation as a forbidden one,
 * and unlike a forbidden pattern it cannot be caught by scanning for what is there.
 */
const FILE_REQUIREMENTS = [
  {
    id: 'SCRIPT-SANDBOX-LIMITS',
    file: 'src/main/api/script/scriptWorker.js',
    // A job with no deadline is a hang and one with no heap ceiling is an OOM, so both calls that
    // establish them must stay in the worker.
    require: ['setInterruptHandler', 'setMemoryLimit'],
    message:
      'The script sandbox worker must set both an interrupt handler (deadline) and a memory limit on every runtime.',
  },
];

/** @param {string} dir */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
      // `.js` is scanned too: the script sandbox worker is authored as standalone CommonJS.
    } else if (['.ts', '.tsx', '.js'].includes(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

let violations = 0;
for (const file of walk(SRC)) {
  const rel = relPath(file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes('check-forbidden-apis')) return;
    for (const rule of RULES) {
      if (rule.only && !rule.only.some((prefix) => rel.startsWith(prefix))) continue;
      if (rule.except?.includes(rel)) continue;
      if (rule.skipLine?.(line)) continue;
      if (rule.re.test(line)) {
        violations += 1;
        console.error(`[${rule.id}] ${file}:${index + 1}\n  ${line.trim()}\n  → ${rule.message}`);
      }
    }
  });
}

for (const requirement of FILE_REQUIREMENTS) {
  let source;
  try {
    source = readFileSync(join(ROOT, requirement.file), 'utf8');
  } catch {
    violations += 1;
    console.error(`[${requirement.id}] ${requirement.file} is missing\n  → ${requirement.message}`);
    continue;
  }
  const absent = requirement.require.filter((needle) => !source.includes(needle));
  if (absent.length > 0) {
    violations += 1;
    console.error(
      `[${requirement.id}] ${requirement.file}\n  missing: ${absent.join(', ')}\n  → ${requirement.message}`
    );
  }
}

if (violations > 0) {
  console.error(`\n${violations} forbidden-API violation(s) found.`);
  process.exit(1);
}
console.log('check-forbidden-apis: no violations.');
