import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discoverNestedRoots } from '@main/projects/nestedRoots';
import { versionSatisfies } from '@main/toolchains/versionFileParsers';

describe('discoverNestedRoots', () => {
  it('finds workspace package roots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bureau-mono-'));
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['apps/*', 'packages/*'] })
    );
    await mkdir(path.join(root, 'apps', 'web'), { recursive: true });
    await writeFile(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web' }));
    await mkdir(path.join(root, 'packages', 'ui'), { recursive: true });
    await writeFile(
      path.join(root, 'packages', 'ui', 'package.json'),
      JSON.stringify({ name: 'ui' })
    );

    const roots = await discoverNestedRoots(root);
    expect(roots).toEqual(['apps/web', 'packages/ui']);
  });
});

describe('versionSatisfies ranges', () => {
  it('accepts newer majors for >= constraints', () => {
    expect(versionSatisfies('>=22', '24.15.0')).toBe(true);
  });
});
