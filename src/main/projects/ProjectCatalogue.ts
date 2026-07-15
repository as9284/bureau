import type { AtomicJsonStore } from '../storage/AtomicJsonStore';
import { createAtomicJsonStore } from '../storage/AtomicJsonStore';
import {
  createDefaultProjectCatalogue,
  makeProjectRecord,
  validateProjectCatalogue,
  type ProjectCatalogueFileV1,
} from '../storage/schemas';
import type { ProjectStack, TrackedProject } from '@shared/contracts/projects';
import { pathsEqual } from './pathIdentity';

export type ProjectCatalogue = {
  list(): TrackedProject[];
  get(projectId: string): TrackedProject | undefined;
  findByCanonicalPath(canonicalPath: string): TrackedProject | undefined;
  add(record: Omit<TrackedProject, 'projectId'>): Promise<TrackedProject>;
  remove(projectId: string): Promise<void>;
  touch(projectId: string): Promise<TrackedProject>;
  setMissing(projectId: string, missing: boolean): Promise<void>;
  setStack(projectId: string, stack: ProjectStack[]): Promise<void>;
};

export function createProjectCatalogue(
  store: AtomicJsonStore<ProjectCatalogueFileV1>
): ProjectCatalogue {
  function list(): TrackedProject[] {
    return store.read().projects;
  }

  function get(projectId: string): TrackedProject | undefined {
    return store.read().projects.find((p) => p.projectId === projectId);
  }

  function findByCanonicalPath(canonicalPath: string): TrackedProject | undefined {
    return store.read().projects.find((p) => pathsEqual(p.canonicalPath, canonicalPath));
  }

  async function add(record: Omit<TrackedProject, 'projectId'>): Promise<TrackedProject> {
    const full = makeProjectRecord(record);
    await store.update((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      projects: [...current.projects, full],
    }));
    return full;
  }

  async function remove(projectId: string): Promise<void> {
    await store.update((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      projects: current.projects.filter((p) => p.projectId !== projectId),
    }));
  }

  async function touch(projectId: string): Promise<TrackedProject> {
    const now = new Date().toISOString();
    await store.update((current) => ({
      ...current,
      updatedAt: now,
      projects: current.projects.map((p) =>
        p.projectId === projectId ? { ...p, lastOpenedAt: now } : p
      ),
    }));
    const updated = get(projectId);
    if (!updated) throw new Error(`Project ${projectId} not found`);
    return updated;
  }

  async function setMissing(projectId: string, missing: boolean): Promise<void> {
    await store.update((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      projects: current.projects.map((p) => (p.projectId === projectId ? { ...p, missing } : p)),
    }));
  }

  async function setStack(projectId: string, stack: ProjectStack[]): Promise<void> {
    await store.update((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      projects: current.projects.map((p) => (p.projectId === projectId ? { ...p, stack } : p)),
    }));
  }

  return { list, get, findByCanonicalPath, add, remove, touch, setMissing, setStack };
}

export function createProjectCatalogueStore(
  filePath: string
): AtomicJsonStore<ProjectCatalogueFileV1> {
  return createAtomicJsonStore<ProjectCatalogueFileV1>({
    filePath,
    schemaVersion: 1,
    defaultValue: createDefaultProjectCatalogue(),
    validate: validateProjectCatalogue,
  });
}
