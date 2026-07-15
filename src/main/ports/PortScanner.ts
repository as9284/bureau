import { spawn } from 'node:child_process';
import type { ListeningPort, PortOwner, ProjectPorts } from '@shared/contracts/ports';
import type { ProcessSupervisor } from '../processes/ProcessSupervisor';
import type { ProcessApplicationService } from '../processes/ProcessApplicationService';
import type { ProjectCatalogue } from '../projects/ProjectCatalogue';
import { parseLsofOutput, parseNetstatOutput, extractPortFromUrl } from './portParsers';
import { killPid } from './portKill';

export type PortScanner = {
  listForProject(projectId: string): Promise<ProjectPorts>;
  kill(input: { pid: number; port: number }): Promise<void>;
};

type RawPortRow = { protocol: 'tcp' | 'udp'; address: string; port: number; pid: number | null };

function ownerOf(pid: number | null, bureauPids: Set<number>): PortOwner {
  if (pid && bureauPids.has(pid)) return 'bureau';
  return pid ? 'system' : 'unknown';
}

/**
 * A row is a **conflict** when it holds a port this project expects to use (from a process's
 * configured `urlPattern` or a detected URL) but is owned by a non-Bureau process — i.e. a
 * foreign squatter on a port the project wants. Bureau's own healthy bound port is never a conflict.
 */
export function classifyPorts(
  raw: RawPortRow[],
  expectedPorts: Set<number>,
  bureauPids: Set<number>
): ListeningPort[] {
  return raw.map((row) => {
    const owner = ownerOf(row.pid, bureauPids);
    return {
      protocol: row.protocol,
      address: row.address,
      port: row.port,
      pid: row.pid,
      processName: null,
      owner,
      conflict: expectedPorts.has(row.port) && owner !== 'bureau',
    };
  });
}

export function createPortScanner(deps: {
  catalogue: ProjectCatalogue;
  supervisor: ProcessSupervisor;
  processes: ProcessApplicationService;
}): PortScanner {
  async function listRaw(): Promise<Array<{ protocol: 'tcp' | 'udp'; address: string; port: number; pid: number | null }>> {
    if (process.platform === 'win32') {
      const stdout = await runCommand('netstat', ['-ano']);
      return parseNetstatOutput(stdout);
    }
    const stdout = await runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
    return parseLsofOutput(stdout);
  }

  async function listForProject(projectId: string): Promise<ProjectPorts> {
    const bureauPids = new Set(deps.supervisor.listRunningPids());

    // Ports this project expects to use: configured `urlPattern`s plus URLs already detected
    // from its running processes. A non-Bureau owner on one of these is a real conflict.
    const expectedPorts = new Set<number>();
    for (const runtime of deps.supervisor.listRuntimes(projectId)) {
      const port = extractPortFromUrl(runtime.detectedUrl);
      if (port) expectedPorts.add(port);
    }
    try {
      const { definitions } = await deps.processes.list({ projectId });
      for (const definition of definitions) {
        const port = extractPortFromUrl(definition.urlPattern);
        if (port) expectedPorts.add(port);
      }
    } catch {
      // No config/definitions available — fall back to detected URLs only.
    }

    const raw = await listRaw();
    return {
      projectId,
      ports: classifyPorts(raw, expectedPorts, bureauPids),
      scannedAt: new Date().toISOString(),
    };
  }

  async function kill(input: { pid: number; port: number }): Promise<void> {
    const bureauPids = new Set(deps.supervisor.listRunningPids());
    if (bureauPids.has(input.pid)) {
      const running = deps.supervisor.listRunning().find((r) => {
        const runtime = deps.supervisor.listRuntimes(r.projectId).find((rt) => rt.processId === r.processId);
        return runtime?.pid === input.pid;
      });
      if (running) {
        await deps.supervisor.stop(running.projectId, running.processId);
        return;
      }
    }
    await killPid(input.pid);
  }

  return { listForProject, kill };
}

function runCommand(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, { shell: false, windowsHide: true });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${executable} failed with code ${code}`));
    });
  });
}
