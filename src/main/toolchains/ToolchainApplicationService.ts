import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import { readProjectConfig, writeProjectConfig } from '../projects/BureauConfigStore';
import { mapUnknownError } from '../ipc/errors';
import type { OkResult } from '@shared/contracts/errors';
import type {
  ProjectToolchains,
  RuntimeKind,
  SetActiveVersionRequest,
} from '@shared/contracts/toolchains';
import type { SettingsStore } from '../settings/SettingsStore';
import type { ProjectStack } from '@shared/contracts/projects';
import { buildProjectToolchains } from './RuntimeDetector';

export type ToolchainApplicationService = {
  getProjectToolchains(input: { projectId: string }): Promise<ProjectToolchains>;
  setActiveVersion(input: SetActiveVersionRequest): Promise<OkResult & { toolchains: ProjectToolchains }>;
};

export function createToolchainApplicationService(deps: {
  catalogue: ProjectCatalogue;
  settingsStore: SettingsStore;
}): ToolchainApplicationService {
  function projectOf(projectId: string): { path: string; stack: ProjectStack[] } {
    const project = deps.catalogue.get(projectId);
    if (!project) {
      throw mapUnknownError(new Error('Project not found'), 'toolchains');
    }
    return { path: project.path, stack: project.stack };
  }

  async function getProjectToolchains(input: { projectId: string }): Promise<ProjectToolchains> {
    const project = projectOf(input.projectId);
    const { config } = await readProjectConfig(project.path);
    return buildProjectToolchains(
      input.projectId,
      project.path,
      config,
      deps.settingsStore.get().toolchains ?? {},
      project.stack
    );
  }

  async function setActiveVersion(
    input: SetActiveVersionRequest
  ): Promise<OkResult & { toolchains: ProjectToolchains }> {
    try {
      const project = projectOf(input.projectId);
      const { config } = await readProjectConfig(project.path);
      const next = {
        ...config,
        toolchains: {
          ...config.toolchains,
          [input.kind]: {
            ...config.toolchains?.[input.kind],
            version: input.version,
          },
        },
      };
      await writeProjectConfig(project.path, next);
      const toolchains = await buildProjectToolchains(
        input.projectId,
        project.path,
        next,
        deps.settingsStore.get().toolchains ?? {},
        project.stack
      );
      return { ok: true, toolchains };
    } catch (error) {
      return {
        ok: false,
        error: mapUnknownError(error, 'toolchains.setActiveVersion', input.kind),
        toolchains: await getProjectToolchains({ projectId: input.projectId }),
      };
    }
  }

  return { getProjectToolchains, setActiveVersion };
}

export type { RuntimeKind };
