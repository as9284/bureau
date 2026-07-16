import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import { createAtomicJsonStore } from '../storage/AtomicJsonStore';
import {
  createDefaultProjectConfigs,
  validateProjectConfigs,
  type ProjectConfigsFileV1,
} from '../storage/schemas';
import type { ProcessDefinition, ProjectConfig } from '@shared/contracts/projects';

const EMPTY: ProjectConfig = { processes: [] };

export type ProjectConfigStore = {
  get(projectId: string): ProjectConfig;
  set(projectId: string, config: ProjectConfig): Promise<ProjectConfig>;
  upsertProcess(projectId: string, definition: ProcessDefinition): Promise<ProjectConfig>;
  removeProcess(projectId: string, processId: string): Promise<ProjectConfig>;
  remove(projectId: string): Promise<void>;
};

export function createProjectConfigStoreSource(
  filePath: string
): AtomicJsonStore<ProjectConfigsFileV1> {
  return createAtomicJsonStore<ProjectConfigsFileV1>({
    filePath,
    schemaVersion: 1,
    defaultValue: createDefaultProjectConfigs(),
    validate: validateProjectConfigs,
  });
}

export function createProjectConfigStore(
  store: AtomicJsonStore<ProjectConfigsFileV1>
): ProjectConfigStore {
  function get(projectId: string): ProjectConfig {
    return store.read().configs[projectId] ?? EMPTY;
  }

  async function set(projectId: string, config: ProjectConfig): Promise<ProjectConfig> {
    await store.update((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      configs: { ...current.configs, [projectId]: config },
    }));
    return config;
  }

  async function upsertProcess(
    projectId: string,
    definition: ProcessDefinition
  ): Promise<ProjectConfig> {
    const current = get(projectId);
    const processes = current.processes.filter((p) => p.id !== definition.id);
    processes.push(definition);
    return set(projectId, { ...current, processes });
  }

  async function removeProcess(projectId: string, processId: string): Promise<ProjectConfig> {
    const current = get(projectId);
    return set(projectId, {
      ...current,
      processes: current.processes.filter((p) => p.id !== processId),
    });
  }

  async function remove(projectId: string): Promise<void> {
    await store.update((current) => {
      const { [projectId]: _removed, ...rest } = current.configs;
      return { ...current, updatedAt: new Date().toISOString(), configs: rest };
    });
  }

  return { get, set, upsertProcess, removeProcess, remove };
}
