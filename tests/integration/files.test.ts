import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileApplicationService, type FileApplicationService } from '@main/files/FileApplicationService';
import { createFilesPersistence } from '@main/files/FilePersistence';
import type { ProjectCatalogue } from '@main/projects/ProjectCatalogue';
import type { SearchBatch } from '@shared/contracts/files';

const projectId = '11111111-1111-4111-8111-111111111111';

describe('FileApplicationService', () => {
  let temporary: string;
  let root: string;
  let service: FileApplicationService;
  let trashed: string[];

  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-files-'));
    root = path.join(temporary, 'project');
    await fs.mkdir(root);
    const persistence = await createFilesPersistence(path.join(temporary, 'data'));
    trashed = [];
    const project = {
      projectId,
      name: 'Fixture',
      path: root,
      canonicalPath: root,
      stack: [],
      addedAt: new Date().toISOString(),
    };
    const catalogue = { get: (id: string) => id === projectId ? project : undefined } as ProjectCatalogue;
    service = createFileApplicationService({
      catalogue,
      ...persistence,
      async trashItem(targetPath) { trashed.push(targetPath); await fs.rm(targetPath, { recursive: true, force: true }); },
      async openPath() { return ''; },
      revealPath() {},
      async exportHtml() { return { ok: true }; },
      async exportPdf() { return { ok: true }; },
      async printDocument() { return { ok: true }; },
      disposeExports() {},
    });
  });

  afterEach(async () => {
    await service.dispose();
    await fs.rm(temporary, { recursive: true, force: true });
  });

  it('lists dotfiles, hides .git and nested ignored content, and never traverses outside root', async () => {
    await fs.writeFile(path.join(root, '.env.example'), 'SAFE=1\n');
    await fs.writeFile(path.join(root, '.gitignore'), 'ignored.txt\nnested/generated/\n');
    await fs.writeFile(path.join(root, 'ignored.txt'), 'ignored\n');
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, '.git', 'config'), 'secret');
    await fs.mkdir(path.join(root, 'nested', 'generated'), { recursive: true });
    await fs.writeFile(path.join(root, 'nested', 'generated', 'output.txt'), 'ignored');

    const visible = await service.listDirectory({ projectId, relativePath: '' });
    expect(visible.ok).toBe(true);
    if (visible.ok) expect(visible.entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['.env.example', '.gitignore', 'nested']));
    if (visible.ok) expect(visible.entries.map((entry) => entry.name)).not.toEqual(expect.arrayContaining(['.git', 'ignored.txt']));

    const shown = await service.listDirectory({ projectId, relativePath: '', showIgnored: true });
    expect(shown.ok && shown.entries.some((entry) => entry.name === 'ignored.txt' && entry.ignored)).toBe(true);
    const traversal = await service.readText({ projectId, relativePath: '../outside.txt' });
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) expect(traversal.error.code).toBe('FILE_OUTSIDE_PROJECT');
    const git = await service.readText({ projectId, relativePath: '.git/config' });
    expect(git.ok).toBe(false);
  });

  it('re-reads a cached .gitignore after it changes on disk', async () => {
    await fs.writeFile(path.join(root, 'keep.txt'), 'keep\n');
    await fs.writeFile(path.join(root, 'later.txt'), 'later\n');
    await fs.writeFile(path.join(root, '.gitignore'), 'keep.txt\n');

    const first = await service.listDirectory({ projectId, relativePath: '' });
    expect(first.ok).toBe(true);
    if (first.ok) {
      const names = first.entries.map((entry) => entry.name);
      expect(names).toContain('later.txt');
      expect(names).not.toContain('keep.txt');
    }

    // Rewrite the rules to ignore the other file. The compiled-matcher cache is
    // keyed by mtime, so a stale cache would keep hiding keep.txt; bump the mtime
    // deterministically (no sleep) to guarantee the change is observed.
    await fs.writeFile(path.join(root, '.gitignore'), 'later.txt\n');
    const future = new Date(Date.now() + 2000);
    await fs.utimes(path.join(root, '.gitignore'), future, future);

    const second = await service.listDirectory({ projectId, relativePath: '' });
    expect(second.ok).toBe(true);
    if (second.ok) {
      const names = second.entries.map((entry) => entry.name);
      expect(names).toContain('keep.txt');
      expect(names).not.toContain('later.txt');
    }
  });

  it('preserves UTF-8 BOM and CRLF, then rejects a stale revision', async () => {
    const filePath = path.join(root, 'README.md');
    await fs.writeFile(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Hello\r\nWorld\r\n')]));
    const read = await service.readText({ projectId, relativePath: 'README.md' });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.document.encoding).toBe('utf-8-bom');
    expect(read.document.lineEnding).toBe('crlf');

    const saved = await service.saveText({ projectId, relativePath: 'README.md', content: '# Changed\nWorld\n', expectedRevision: read.document.revision, encoding: read.document.encoding, lineEnding: 'crlf' });
    expect(saved.ok).toBe(true);
    const bytes = await fs.readFile(filePath);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.toString('utf8')).toContain('# Changed\r\nWorld\r\n');

    await fs.writeFile(filePath, '# External\n');
    const stale = await service.saveText({ projectId, relativePath: 'README.md', content: '# Mine\n', expectedRevision: saved.ok ? saved.revision : read.document.revision, encoding: 'utf-8', lineEnding: 'lf' });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('FILE_CONFLICT');
  });

  it('classifies binary and unsupported-encoding files without offering them as text', async () => {
    await fs.writeFile(path.join(root, 'binary.dat'), Buffer.from([0x41, 0x00, 0x42]));
    await fs.writeFile(path.join(root, 'legacy.txt'), Buffer.from([0xff, 0xfe, 0x41]));

    const listed = await service.listDirectory({ projectId, relativePath: '' });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.entries.find((entry) => entry.name === 'binary.dat')?.kind).toBe('binary');
    expect(listed.entries.find((entry) => entry.name === 'legacy.txt')?.kind).toBe('unsupported');
    const opened = await service.readText({ projectId, relativePath: 'legacy.txt' });
    expect(opened.ok).toBe(false);
    if (!opened.ok) expect(opened.error.code).toBe('FILE_UNSUPPORTED_ENCODING');
  });

  it('serializes collision-safe mutations and uses the injected OS trash adapter', async () => {
    expect((await service.createEntry({ projectId, relativePath: 'docs', kind: 'directory' })).ok).toBe(true);
    expect((await service.createEntry({ projectId, relativePath: 'docs/note.md', kind: 'file' })).ok).toBe(true);
    const collision = await service.createEntry({ projectId, relativePath: 'docs/note.md', kind: 'file' });
    expect(collision.ok).toBe(false);
    if (!collision.ok) expect(collision.error.code).toBe('FILE_ALREADY_EXISTS');
    const renamed = await service.renameEntry({ projectId, relativePath: 'docs/note.md', newName: 'guide.md' });
    expect(renamed).toMatchObject({ ok: true, relativePath: 'docs/guide.md' });
    const duplicated = await service.duplicateEntry({ projectId, relativePath: 'docs/guide.md', destinationPath: 'docs/guide-copy.md' });
    expect(duplicated.ok).toBe(true);
    expect((await service.trashEntry({ projectId, relativePath: 'docs/guide-copy.md' })).ok).toBe(true);
    expect(trashed).toHaveLength(1);
    expect(path.relative(await fs.realpath(root), trashed[0])).toBe(path.join('docs', 'guide-copy.md'));
    expect((await service.trashEntry({ projectId, relativePath: '' })).ok).toBe(false);
  });

  it('streams bounded literal whole-word search results and cancellation state', async () => {
    await fs.writeFile(path.join(root, 'one.txt'), 'alpha alphabet ALPHA\n');
    await fs.writeFile(path.join(root, 'two.txt'), 'alpha\n');
    const searchId = '22222222-2222-4222-8222-222222222222';
    const completed = new Promise<SearchBatch>((resolve) => {
      const unsubscribe = service.onSearchEvents((batch) => {
        if (batch.searchId === searchId && batch.done) { unsubscribe(); resolve(batch); }
      });
    });
    await service.startSearch({ projectId, searchId, query: 'alpha', caseSensitive: true, wholeWord: true });
    const batch = await completed;
    expect(batch.cancelled).toBe(false);
    expect(batch.matches).toHaveLength(2);
    expect(batch.matches.map((match) => match.relativePath).sort()).toEqual(['one.txt', 'two.txt']);
  });

  it('batches watcher events and disposes the watcher explicitly', async () => {
    const eventsPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watcher event timeout')), 5000);
      const unsubscribe = service.onFileEvents((events) => {
        if (events.some((event) => event.type === 'watcher-ready')) {
          void fs.writeFile(path.join(root, 'watched.txt'), 'changed').catch(reject);
        }
        const changed = events.find((event) => event.relativePath === 'watched.txt');
        if (changed) { clearTimeout(timeout); unsubscribe(); resolve(changed.type); }
      });
    });
    expect((await service.watchProject({ projectId })).ok).toBe(true);
    expect(await eventsPromise).toBe('created');
    expect((await service.unwatchProject({ projectId })).ok).toBe(true);
  });

  it('rejects symlink targets and serves markdown-embedded SVG as image/svg+xml', async () => {
    const outside = path.join(temporary, 'secret.txt');
    await fs.writeFile(outside, 'secret');
    const linkPath = path.join(root, 'escape.txt');
    let symlinkCreated = false;
    try {
      await fs.symlink(outside, linkPath);
      symlinkCreated = true;
    } catch {
      // Windows may lack SeCreateSymbolicLinkPrivilege in CI/dev shells.
    }
    if (symlinkCreated) {
      const escaped = await service.readText({ projectId, relativePath: 'escape.txt' });
      expect(escaped.ok).toBe(false);
      if (!escaped.ok) expect(escaped.error.code).toBe('FILE_OUTSIDE_PROJECT');
    }

    await fs.writeFile(path.join(root, 'badge.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="2" cy="2" r="2" /></svg>');
    const asset = await service.resolveMarkdownAsset({ projectId, relativePath: 'badge.svg' });
    expect(asset.ok).toBe(true);
    if (asset.ok) {
      expect(asset.document.mimeType).toBe('image/svg+xml');
      expect(new TextDecoder().decode(asset.document.bytes)).toContain('<circle');
    }
    const rasterMissing = await service.readImage({ projectId, relativePath: 'badge.svg' });
    expect(rasterMissing.ok).toBe(false);
    if (!rasterMissing.ok) expect(rasterMissing.error.code).toBe('FILE_UNSUPPORTED_TYPE');
  });

  it('rejects remote image fetches aimed at private or loopback hosts', async () => {
    const loopback = await service.fetchRemoteImage({ url: 'http://127.0.0.1/image.png' });
    expect(loopback.ok).toBe(false);
    if (!loopback.ok) expect(loopback.error.code).toBe('INVALID_REQUEST');

    const metadata = await service.fetchRemoteImage({ url: 'http://169.254.169.254/latest/meta-data/' });
    expect(metadata.ok).toBe(false);
    if (!metadata.ok) expect(metadata.error.code).toBe('INVALID_REQUEST');

    const redirectTrap = await service.fetchRemoteImage({ url: 'http://localhost:9/redirect' });
    expect(redirectTrap.ok).toBe(false);
    if (!redirectTrap.ok) expect(redirectTrap.error.code).toBe('INVALID_REQUEST');
  });
});
