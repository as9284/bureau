import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProcessApplicationService } from '@main/processes/ProcessApplicationService';
import type { ProcessSupervisor } from '@main/processes/ProcessSupervisor';
import type { ProjectCatalogue } from '@main/projects/ProjectCatalogue';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-heal-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function makeService() {
  const catalogue = {
    get: (id: string) => (id === 'p1' ? { projectId: 'p1', path: dir, stack: [] } : undefined),
    setStack: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProjectCatalogue;
  const supervisor = { listRuntimes: vi.fn(() => []) } as unknown as ProcessSupervisor;
  return { service: createProcessApplicationService(catalogue, supervisor), catalogue };
}

describe('ProcessApplicationService self-heal', () => {
  it('populates and persists detected commands when the config has none', async () => {
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } })
    );
    const { service, catalogue } = makeService();

    const first = await service.list({ projectId: 'p1' });
    expect(first.definitions.map((d) => d.id)).toEqual(expect.arrayContaining(['dev', 'build']));

    // The healed config is written to disk so the commands are startable next time.
    const written = JSON.parse(
      await fs.readFile(path.join(dir, '.bureau', 'config.json'), 'utf8')
    );
    expect(written.processes.map((p: { id: string }) => p.id)).toContain('dev');

    // The catalogue stack is synced so the sidebar/overview badges reflect detection.
    expect(catalogue.setStack).toHaveBeenCalledWith('p1', expect.arrayContaining(['node']));
  });

  it('leaves projects with no detectable commands empty (no crash, no write)', async () => {
    const { service } = makeService();
    const result = await service.list({ projectId: 'p1' });
    expect(result.definitions).toEqual([]);
    await expect(fs.access(path.join(dir, '.bureau', 'config.json'))).rejects.toThrow();
  });
});
