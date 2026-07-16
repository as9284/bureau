import type { ProcessSupervisor, StartInput } from './ProcessSupervisor';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import type { ProjectConfigStore } from '../projects/ProjectConfigStore';
import { detectStack } from '../projects/StackDetector';
import { mapUnknownError } from '../ipc/errors';
import type { OkResult } from '@shared/contracts/errors';
import type { LogSnapshot, ProjectProcesses } from '@shared/contracts/processes';
import type { ProcessDefinition } from '@shared/contracts/projects';

type Target = { projectId: string; processId: string };
type Ok = OkResult;

export type ProcessApplicationService = {
  list(input: { projectId: string }): Promise<ProjectProcesses>;
  start(input: Target): Promise<Ok>;
  stop(input: Target): Promise<Ok>;
  restart(input: Target): Promise<Ok>;
  stopAll(input: { projectId: string }): Promise<void>;
  getLog(input: Target): Promise<LogSnapshot>;
  saveDefinition(input: {
    projectId: string;
    definition: ProcessDefinition;
  }): Promise<ProjectProcesses>;
  removeDefinition(input: { projectId: string; processId: string }): Promise<ProjectProcesses>;
  writePty(input: { projectId: string; processId: string; data: string }): Promise<void>;
  resizePty(input: {
    projectId: string;
    processId: string;
    cols: number;
    rows: number;
  }): Promise<void>;
};

function sameStack(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag) => b.includes(tag));
}

export function createProcessApplicationService(
  catalogue: ProjectCatalogue,
  supervisor: ProcessSupervisor,
  configStore: ProjectConfigStore
): ProcessApplicationService {
  function projectRootOf(projectId: string): string {
    const project = catalogue.get(projectId);
    if (!project) {
      throw mapUnknownError(new Error('Project not found'), 'processes');
    }
    return project.path;
  }

  async function processesFor(projectId: string): Promise<ProjectProcesses> {
    const root = projectRootOf(projectId);
    let config = configStore.get(projectId);
    // Seed projects that have no stored commands yet — a project added before its commands were
    // detectable (e.g. native Android), or one whose stored config was never written. Re-run
    // detection and persist the suggestions so they become startable.
    if (config.processes.length === 0) {
      const detection = await detectStack(root).catch(() => null);
      if (detection && detection.suggestedProcesses.length > 0) {
        config = {
          ...config,
          packageManager: detection.packageManager ?? config.packageManager,
          processes: detection.suggestedProcesses,
        };
        await configStore.set(projectId, config).catch(() => undefined);
        // Keep the catalogue's stack (which drives the sidebar/overview badges) in sync
        // with what detection just found, so a healed project badges correctly.
        const current = catalogue.get(projectId);
        if (detection.stack.length > 0 && current && !sameStack(current.stack, detection.stack)) {
          await catalogue.setStack(projectId, detection.stack).catch(() => undefined);
        }
      }
    }
    return { definitions: config.processes, runtimes: supervisor.listRuntimes(projectId) };
  }

  async function resolveStartInput(target: Target): Promise<StartInput> {
    const root = projectRootOf(target.projectId);
    const definition = configStore.get(target.projectId).processes.find(
      (p) => p.id === target.processId
    );
    if (!definition) {
      throw {
        code: 'PROCESS_NOT_FOUND',
        message: 'No such process in this project.',
        operation: 'processes.start',
        retryable: false,
      };
    }
    return { projectId: target.projectId, projectRoot: root, definition };
  }

  async function start(input: Target): Promise<Ok> {
    try {
      await supervisor.start(await resolveStartInput(input));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mapUnknownError(error, 'processes.start', input.processId) };
    }
  }

  async function stop(input: Target): Promise<Ok> {
    try {
      await supervisor.stop(input.projectId, input.processId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mapUnknownError(error, 'processes.stop', input.processId) };
    }
  }

  async function restart(input: Target): Promise<Ok> {
    try {
      await supervisor.restart(await resolveStartInput(input));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mapUnknownError(error, 'processes.restart', input.processId) };
    }
  }

  async function stopAll(input: { projectId: string }): Promise<void> {
    await supervisor.stopAllForProject(input.projectId);
  }

  async function getLog(input: Target): Promise<LogSnapshot> {
    return supervisor.getLog(input.projectId, input.processId);
  }

  async function saveDefinition(input: {
    projectId: string;
    definition: ProcessDefinition;
  }): Promise<ProjectProcesses> {
    await configStore.upsertProcess(input.projectId, input.definition);
    return processesFor(input.projectId);
  }

  async function removeDefinition(input: {
    projectId: string;
    processId: string;
  }): Promise<ProjectProcesses> {
    await supervisor.stop(input.projectId, input.processId);
    await configStore.removeProcess(input.projectId, input.processId);
    return processesFor(input.projectId);
  }

  async function writePty(input: {
    projectId: string;
    processId: string;
    data: string;
  }): Promise<void> {
    supervisor.writePty(input.projectId, input.processId, input.data);
  }

  async function resizePty(input: {
    projectId: string;
    processId: string;
    cols: number;
    rows: number;
  }): Promise<void> {
    supervisor.resizePty(input.projectId, input.processId, input.cols, input.rows);
  }

  return {
    list: (input) => processesFor(input.projectId),
    start,
    stop,
    restart,
    stopAll,
    getLog,
    saveDefinition,
    removeDefinition,
    writePty,
    resizePty,
  };
}
