import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppServices, type AppBootstrap } from '@main/services/createAppServices';
import type { SearchBatch } from '@shared/contracts/files';

describe('Files + Monocle service journey (headless)', () => {
  let userData: string;
  let projectDirectory: string;
  let boot: AppBootstrap;

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-files-e2e-data-'));
    projectDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-files-e2e-project-'));
    await fs.mkdir(path.join(projectDirectory, 'src'));
    await fs.writeFile(path.join(projectDirectory, 'README.md'), '# Bureau\n\nA local mission control.\n');
    await fs.writeFile(path.join(projectDirectory, 'src', 'index.ts'), 'export const bureau = true;\n');
    boot = await createAppServices(userData, {
      async trashItem(targetPath) { await fs.rm(targetPath, { recursive: true, force: true }); },
      documentExport: {
        async exportHtml() { return { ok: true }; },
        async exportPdf() { return { ok: true }; },
        async printDocument() { return { ok: true }; },
        dispose() {},
      },
    });
  });

  afterEach(async () => {
    await boot.services.files.dispose();
    await boot.supervisor.stopAll();
    await fs.rm(userData, { recursive: true, force: true });
    await fs.rm(projectDirectory, { recursive: true, force: true });
  });

  it('reads, edits, searches, mutates, recovers and exports within a tracked project', async () => {
    const added = await boot.services.projects.add({ path: projectDirectory });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const projectId = added.project!.projectId;

    const listed = await boot.services.files.listDirectory({ projectId, relativePath: '' });
    expect(listed.ok && listed.entries.some((entry) => entry.relativePath === 'README.md')).toBe(true);

    const opened = await boot.services.files.readText({ projectId, relativePath: 'README.md' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const saved = await boot.services.files.saveText({
      projectId,
      relativePath: 'README.md',
      content: `${opened.document.content}\nEdited in Bureau.\n`,
      expectedRevision: opened.document.revision,
      encoding: opened.document.encoding,
      lineEnding: 'lf',
    });
    expect(saved.ok).toBe(true);

    const searchId = crypto.randomUUID();
    const completed = new Promise<SearchBatch>((resolve) => {
      const unsubscribe = boot.services.files.onSearchEvents((batch) => {
        if (batch.searchId === searchId && batch.done) { unsubscribe(); resolve(batch); }
      });
    });
    expect((await boot.services.files.startSearch({ projectId, searchId, query: 'Bureau', caseSensitive: false, wholeWord: true })).ok).toBe(true);
    expect((await completed).matches.map((match) => match.relativePath)).toEqual(expect.arrayContaining(['README.md', 'src/index.ts']));

    expect((await boot.services.files.createEntry({ projectId, relativePath: 'docs', kind: 'directory' })).ok).toBe(true);
    expect((await boot.services.files.createEntry({ projectId, relativePath: 'docs/note.md', kind: 'file' })).ok).toBe(true);
    expect((await boot.services.files.renameEntry({ projectId, relativePath: 'docs/note.md', newName: 'guide.md' })).ok).toBe(true);
    expect((await boot.services.files.moveEntry({ projectId, relativePath: 'docs/guide.md', destinationPath: 'guide.md' })).ok).toBe(true);
    expect((await boot.services.files.duplicateEntry({ projectId, relativePath: 'guide.md', destinationPath: 'guide-copy.md' })).ok).toBe(true);
    expect((await boot.services.files.trashEntry({ projectId, relativePath: 'guide-copy.md' })).ok).toBe(true);
    await expect(fs.stat(path.join(projectDirectory, 'guide-copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });

    const draft = {
      projectId,
      relativePath: 'README.md',
      content: 'Recovered buffer',
      baseRevision: saved.ok ? saved.revision : opened.document.revision,
      encoding: opened.document.encoding,
      lineEnding: 'lf' as const,
      updatedAt: new Date().toISOString(),
    };
    expect((await boot.services.files.putDraft({ draft })).ok).toBe(true);
    const drafts = await boot.services.files.listDrafts({ projectId });
    expect(drafts.ok && drafts.drafts[0]?.content).toBe('Recovered buffer');
    expect((await boot.services.files.removeDraft({ projectId, relativePath: 'README.md' })).ok).toBe(true);

    const exported = await boot.services.files.exportHtml({
      projectId,
      relativePath: 'README.md',
      html: '<article><h1>Bureau</h1></article>',
      suggestedName: 'README.md',
    });
    expect(exported.ok).toBe(true);
  });
});
