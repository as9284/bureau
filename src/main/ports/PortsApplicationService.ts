import type { KillPortRequest, ProjectPorts } from '@shared/contracts/ports';
import type { OkResult } from '@shared/contracts/errors';
import { mapUnknownError } from '../ipc/errors';
import type { PortScanner } from './PortScanner';

export type PortsApplicationService = {
  list(input: { projectId: string }): Promise<ProjectPorts>;
  kill(input: KillPortRequest): Promise<OkResult>;
};

export function createPortsApplicationService(scanner: PortScanner): PortsApplicationService {
  async function list(input: { projectId: string }): Promise<ProjectPorts> {
    return scanner.listForProject(input.projectId);
  }

  async function kill(input: KillPortRequest): Promise<OkResult> {
    try {
      await scanner.kill(input);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mapUnknownError(error, 'ports.kill', String(input.pid)) };
    }
  }

  return { list, kill };
}
