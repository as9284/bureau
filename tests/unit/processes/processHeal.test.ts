import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProcessApplicationService } from '@main/processes/ProcessApplicationService';
import {
  createProjectConfigStore,
  createProjectConfigStoreSource,
} from '@main/projects/ProjectConfigStore';
import type { ProcessSupervisor } from '@main/processes/ProcessSupervisor';
import type { ProjectCatalogue } from '@main/projects/ProjectCatalogue';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

let dir: string;
let storePath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-heal-'));
  storePath = path.join(dir, 'userData', 'projectConfigs.v1.json');
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function makeService() {
  const catalogue = {
    get: (id: string) =>
      id === PROJECT_ID ? { projectId: PROJECT_ID, path: dir, stack: [] } : undefined,
    setStack: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProjectCatalogue;
  const supervisor = { listRuntimes: vi.fn(() => []) } as unknown as ProcessSupervisor;
  const source = createProjectConfigStoreSource(storePath);
  await source.load();
  const configStore = createProjectConfigStore(source);
  return {
    service: createProcessApplicationService(catalogue, supervisor, configStore),
    catalogue,
    configStore,
  };
}

describe('ProcessApplicationService self-heal', () => {
  it('populates and persists detected commands when nothing is stored yet', async () => {
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } })
    );
    const { service, catalogue, configStore } = await makeService();

    const first = await service.list({ projectId: PROJECT_ID });
    expect(first.definitions.map((d) => d.id)).toEqual(expect.arrayContaining(['dev', 'build']));

    // Held in the store, keyed by projectId, so the commands are startable next time.
    expect(configStore.get(PROJECT_ID).processes.map((p) => p.id)).toContain('dev');

    // ...and durably written to Bureau's own app storage, never into the project directory.
    const written = JSON.parse(await fs.readFile(storePath, 'utf8'));
    expect(written.configs[PROJECT_ID].processes.map((p: { id: string }) => p.id)).toContain('dev');
    await expect(fs.access(path.join(dir, '.bureau'))).rejects.toThrow();

    // The catalogue stack is synced so the sidebar/overview badges reflect detection.
    expect(catalogue.setStack).toHaveBeenCalledWith(PROJECT_ID, expect.arrayContaining(['node']));
  });

  it('leaves projects with no detectable commands empty (no crash, no write)', async () => {
    const { service, configStore } = await makeService();
    const result = await service.list({ projectId: PROJECT_ID });
    expect(result.definitions).toEqual([]);
    expect(configStore.get(PROJECT_ID).processes).toEqual([]);
  });
});
