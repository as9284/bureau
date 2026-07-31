import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAIN_EXTERNAL_MODULES, isPackagedMainRuntime } from '../../../packaging';

const repoRoot = path.resolve(__dirname, '../../..');

describe('packaged main-process modules', () => {
  it('packages every module the main bundle keeps external', () => {
    // Regression: 1.1.0 externalized `ws` without packaging it, so the app crashed on launch
    // with `Cannot find module 'ws'` before the first window opened.
    expect(MAIN_EXTERNAL_MODULES).toContain('ws');

    for (const name of MAIN_EXTERNAL_MODULES) {
      expect(isPackagedMainRuntime(`/node_modules/${name}`), name).toBe(true);
      expect(isPackagedMainRuntime(`/node_modules/${name}/package.json`), name).toBe(true);
    }
  });

  it('declares the main bundle externals from the shared list', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'vite.main.config.ts'), 'utf8');
    const externals = /external:\s*\[([^\]]*)\]/.exec(source)?.[1];

    expect(externals).toBeDefined();
    expect(externals).toContain('...MAIN_EXTERNAL_MODULES');
    // Anything else listed by hand would be external at build time but unpackaged at runtime.
    expect([...(externals ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual([
      'electron',
      'node:*',
    ]);
  });

  it('still excludes sources and renderer-only dependencies', () => {
    expect(isPackagedMainRuntime('/src/main/main.ts')).toBe(false);
    expect(isPackagedMainRuntime('/node_modules/react')).toBe(false);
    expect(isPackagedMainRuntime('/node_modules/@codemirror/view')).toBe(false);
  });

  it('keeps the built bundles and the QuickJS runtime assets', () => {
    expect(isPackagedMainRuntime('/.vite/build/main.js')).toBe(true);
    expect(isPackagedMainRuntime('/node_modules')).toBe(true);
    expect(isPackagedMainRuntime('/node_modules/@jitl')).toBe(true);
    expect(
      isPackagedMainRuntime('/node_modules/@jitl/quickjs-singlefile-cjs-release-sync/dist/index.js'),
    ).toBe(true);
    expect(isPackagedMainRuntime('/node_modules/quickjs-emscripten-core/dist/index.js')).toBe(true);
  });
});
