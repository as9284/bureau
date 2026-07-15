import { access } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectCatalogue } from './ProjectCatalogue';
import { canonicalizePath } from './pathIdentity';
import { detectStack } from './StackDetector';
import { readProjectConfig, writeProjectConfig } from './BureauConfigStore';
import { toBureauError } from '../ipc/errors';
import type { Result } from '@shared/contracts/errors';
import type {
  BureauProjectConfig,
  StackDetectionResult,
  TrackedProject,
} from '@shared/contracts/projects';

export type ProjectApplicationService = {
  list(): Promise<TrackedProject[]>;
  detect(input: { path: string }): Promise<StackDetectionResult>;
  add(input: { path: string }): Promise<Result<{ project: TrackedProject }>>;
  remove(input: { projectId: string }): Promise<void>;
  touch(input: { projectId: string }): Promise<TrackedProject>;
};

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export function createProjectApplicationService(
  catalogue: ProjectCatalogue
): ProjectApplicationService {
  async function list(): Promise<TrackedProject[]> {
    // Reconcile missing-on-disk state before returning.
    for (const project of catalogue.list()) {
      const present = await pathExists(project.path);
      if (present === Boolean(project.missing)) {
        await catalogue.setMissing(project.projectId, !present);
      }
    }
    return catalogue.list();
  }

  async function detect(input: { path: string }): Promise<StackDetectionResult> {
    return detectStack(input.path);
  }

  async function add(input: { path: string }): Promise<Result<{ project: TrackedProject }>> {
    try {
      if (!(await pathExists(input.path))) {
        return {
          ok: false,
          error: toBureauError({
            code: 'INVALID_PROJECT_PATH',
            message: 'That folder does not exist.',
            operation: 'projects.add',
          }),
        };
      }

      const canonicalPath = await canonicalizePath(input.path);
      const existing = catalogue.findByCanonicalPath(canonicalPath);
      if (existing) {
        const touched = await catalogue.touch(existing.projectId);
        return { ok: true, project: touched };
      }

      const detection = await detectStack(input.path);

      // Respect an existing committable config; otherwise write one from detection.
      const read = await readProjectConfig(input.path);
      if (!read.present) {
        const config: BureauProjectConfig = {
          schemaVersion: 1,
          name: path.basename(input.path) || 'Project',
          stack: detection.stack,
          packageManager: detection.packageManager,
          processes: detection.suggestedProcesses,
        };
        await writeProjectConfig(input.path, config);
      }

      const project = await catalogue.add({
        name: read.present ? read.config.name : path.basename(input.path) || 'Project',
        path: input.path,
        canonicalPath,
        stack: detection.stack,
        addedAt: new Date().toISOString(),
        configPresent: true,
        missing: false,
        nestedRoots: detection.nestedRoots.length > 0 ? detection.nestedRoots : undefined,
      });
      return { ok: true, project };
    } catch (error) {
      return {
        ok: false,
        error: toBureauError({
          code: 'PERMISSION_DENIED',
          message: error instanceof Error ? error.message : 'Could not add the project.',
          operation: 'projects.add',
        }),
      };
    }
  }

  async function remove(input: { projectId: string }): Promise<void> {
    await catalogue.remove(input.projectId);
  }

  async function touch(input: { projectId: string }): Promise<TrackedProject> {
    return catalogue.touch(input.projectId);
  }

  return { list, detect, add, remove, touch };
}
