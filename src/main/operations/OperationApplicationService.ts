import type { OperationRegistry } from './OperationRegistry';
import type {
  OperationCancelRequest,
  OperationCancelResult,
  OperationListResult,
} from '@shared/contracts/operationLog';

export type OperationApplicationService = {
  list(): Promise<OperationListResult>;
  cancel(input: OperationCancelRequest): Promise<OperationCancelResult>;
};

export function createOperationApplicationService(
  registry: OperationRegistry
): OperationApplicationService {
  return {
    list: async () => registry.list(),
    cancel: async (input) => registry.cancel(input.operationId),
  };
}
