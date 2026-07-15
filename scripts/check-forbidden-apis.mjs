#!/usr/bin/env node
// Static guard for Bureau's non-negotiable security boundaries.
// Dependency-free: recursively scans src/** and fails on any forbidden pattern.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

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

/** @param {string} dir */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (['.ts', '.tsx'].includes(extname(full))) {
      out.push(full);
    }
  }
  return out;
}

let violations = 0;
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes('check-forbidden-apis')) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        violations += 1;
        console.error(`[${rule.id}] ${file}:${index + 1}\n  ${line.trim()}\n  → ${rule.message}`);
      }
    }
  });
}

if (violations > 0) {
  console.error(`\n${violations} forbidden-API violation(s) found.`);
  process.exit(1);
}
console.log('check-forbidden-apis: no violations.');
