/**
 * Windows native-build patches for Electron Forge / node-pty.
 *
 * 1. @electron/node-gyp: recognize Visual Studio 18 (2025/2026). Upstream
 *    node-gyp ≥12.1 has this; Electron's fork still stops at VS 17.
 * 2. node-pty: drop SpectreMitigation so rebuild works without installing
 *    Spectre-mitigated MSVC libs (MSB8040). Optional; install those libs
 *    instead if you prefer the stock gyp files.
 *
 * Safe to re-run — no-ops when already patched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function resolvePackageRoot(packageName) {
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return null;
  }
}

function patchElectronNodeGyp() {
  const root = resolvePackageRoot('@electron/node-gyp');
  if (!root) {
    console.log('patch-native-build: @electron/node-gyp not installed — skipped');
    return;
  }
  const target = path.join(root, 'lib', 'find-visualstudio.js');
  if (!fs.existsSync(target)) {
    console.log('patch-native-build: find-visualstudio.js missing — skipped');
    return;
  }

  let source = fs.readFileSync(target, 'utf8');
  if (source.includes('versionMajor === 18')) {
    console.log('patch-native-build: VS18 support already applied');
    return;
  }

  const before = source;
  source = source.replaceAll('[2019, 2022]', '[2019, 2022, 2026]');
  source = source.replace(
    `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    this.log.silly('- unsupported version:', ret.versionMajor)`,
    `    if (ret.versionMajor === 17) {
      ret.versionYear = 2022
      return ret
    }
    if (ret.versionMajor === 18) {
      ret.versionYear = 2026
      return ret
    }
    this.log.silly('- unsupported version:', ret.versionMajor)`
  );
  source = source.replace(
    `    } else if (versionYear === 2022) {
      return 'v143'
    }
    this.log.silly('- invalid versionYear:', versionYear)`,
    `    } else if (versionYear === 2022) {
      return 'v143'
    } else if (versionYear === 2026) {
      return 'v145'
    }
    this.log.silly('- invalid versionYear:', versionYear)`
  );

  if (source === before) {
    console.warn('patch-native-build: VS18 patterns not found — skipped');
    return;
  }
  fs.writeFileSync(target, source, 'utf8');
  console.log(`patch-native-build: patched VS18 into ${target}`);
}

function disableSpectre(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const source = fs.readFileSync(filePath, 'utf8');
  if (!source.includes("'SpectreMitigation': 'Spectre'")) {
    if (source.includes("'SpectreMitigation': 'false'")) {
      return false;
    }
    return false;
  }
  const next = source.replaceAll("'SpectreMitigation': 'Spectre'", "'SpectreMitigation': 'false'");
  fs.writeFileSync(filePath, next, 'utf8');
  console.log(`patch-native-build: disabled Spectre in ${filePath}`);
  return true;
}

function patchNodePtySpectre() {
  let root;
  try {
    root = path.dirname(require.resolve('node-pty/package.json'));
  } catch {
    console.log('patch-native-build: node-pty not installed — skipped Spectre patch');
    return;
  }

  const files = [
    path.join(root, 'binding.gyp'),
    path.join(root, 'deps', 'winpty', 'src', 'winpty.gyp'),
  ];
  let patched = 0;
  for (const file of files) {
    if (disableSpectre(file)) patched += 1;
  }
  if (patched === 0) {
    console.log('patch-native-build: Spectre already disabled or gyp files unchanged');
  }
}

patchElectronNodeGyp();
patchNodePtySpectre();
