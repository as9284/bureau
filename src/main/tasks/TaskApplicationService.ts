import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { ProcessApplicationService } from '../processes/ProcessApplicationService';
import type { OkResult } from '@shared/contracts/errors';
import type { ProjectTasks, RunTaskRequest } from '@shared/contracts/tasks';
import { mapUnknownError } from '../ipc/errors';
import { discoverProjectTasks, taskToProcessDefinition } from './taskDiscovery';

export type TaskApplicationService = {
  list(input: { projectId: string }): Promise<ProjectTasks>;
  run(input: RunTaskRequest): Promise<OkResult>;
};

export function createTaskApplicationService(deps: {
  catalogue: ProjectCatalogue;
  processes: ProcessApplicationService;
}): TaskApplicationService {
  function projectRootOf(projectId: string): string {
    const project = deps.catalogue.get(projectId);
    if (!project) {
      throw mapUnknownError(new Error('Project not found'), 'tasks');
    }
    return project.path;
  }

  async function list(input: { projectId: string }): Promise<ProjectTasks> {
    const root = projectRootOf(input.projectId);
    const tasks = await discoverProjectTasks(root);
    return { projectId: input.projectId, tasks };
  }

  async function run(input: RunTaskRequest): Promise<OkResult> {
    try {
      const root = projectRootOf(input.projectId);
      const tasks = await discoverProjectTasks(root);
      const task = tasks.find((t) => t.id === input.taskId);
      if (!task) {
        return {
          ok: false,
          error: mapUnknownError(new Error('Task not found'), 'tasks.run', input.taskId),
        };
      }
      const definition = taskToProcessDefinition(task);
      const saved = await deps.processes.saveDefinition({
        projectId: input.projectId,
        definition,
      });
      const exists = saved.definitions.some((d) => d.id === definition.id);
      if (!exists) {
        return {
          ok: false,
          error: mapUnknownError(new Error('Failed to save task definition'), 'tasks.run', input.taskId),
        };
      }
      return deps.processes.start({ projectId: input.projectId, processId: definition.id });
    } catch (error) {
      return { ok: false, error: mapUnknownError(error, 'tasks.run', input.taskId) };
    }
  }

  return { list, run };
}
