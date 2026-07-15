import { randomUUID } from 'node:crypto';
import type {
  OperationCancelResult,
  OperationKind,
  OperationListResult,
  OperationOutputEntry,
  OperationRecord,
  OperationState,
} from '@shared/contracts/operationLog';
import type { BureauError } from '@shared/contracts/errors';
import { redactUrlCredentials } from '@shared/git/refChecks';
import { toBureauError } from '../ipc/errors';

const MAX_OPERATIONS = 200;
const MAX_OUTPUT_ENTRIES = 100;
const MAX_OUTPUT_TEXT_LENGTH = 4000;

export type OperationRegistryOptions = {
  onTerminal?: (record: OperationRecord) => void;
  onCancel?: (operationId: string) => boolean;
};

export type OperationRegistry = {
  start(input: {
    kind: OperationKind;
    summary: string;
    projectId?: string;
    cancellable?: boolean;
  }): string;
  appendOutput(operationId: string, entry: Omit<OperationOutputEntry, 'at'>): void;
  setProgress(
    operationId: string,
    progress: { phase?: string; percent?: number; message?: string }
  ): void;
  succeed(operationId: string): void;
  fail(operationId: string, error: BureauError): void;
  cancel(operationId: string): OperationCancelResult;
  list(): OperationListResult;
  get(operationId: string): OperationRecord | undefined;
  runTracked<T>(input: {
    kind: OperationKind;
    summary: string;
    projectId?: string;
    cancellable?: boolean;
    fn: (ctx: { operationId: string }) => Promise<T>;
  }): Promise<T>;
};

export function createOperationRegistry(options?: OperationRegistryOptions): OperationRegistry {
  const operations = new Map<string, OperationRecord>();
  const order: string[] = [];

  function redactText(text: string): string {
    return redactUrlCredentials(text.slice(0, MAX_OUTPUT_TEXT_LENGTH));
  }

  function trimOperations(): void {
    while (order.length > MAX_OPERATIONS) {
      const oldest = order.shift();
      if (oldest) operations.delete(oldest);
    }
  }

  function getRecord(operationId: string): OperationRecord | undefined {
    return operations.get(operationId);
  }

  function notifyTerminal(operationId: string): void {
    const record = getRecord(operationId);
    if (record && options?.onTerminal) {
      options.onTerminal(record);
    }
  }

  function start(input: {
    kind: OperationKind;
    summary: string;
    projectId?: string;
    cancellable?: boolean;
  }): string {
    const id = randomUUID();
    const record: OperationRecord = {
      id,
      projectId: input.projectId,
      kind: input.kind,
      state: 'running',
      summary: redactText(input.summary),
      startedAt: new Date().toISOString(),
      cancellable: input.cancellable ?? false,
      output: [],
    };
    operations.set(id, record);
    order.push(id);
    trimOperations();
    return id;
  }

  function appendOutput(operationId: string, entry: Omit<OperationOutputEntry, 'at'>): void {
    const record = operations.get(operationId);
    if (!record) return;
    const next: OperationOutputEntry = {
      at: new Date().toISOString(),
      stream: entry.stream,
      text: redactText(entry.text),
    };
    record.output = [...record.output, next].slice(-MAX_OUTPUT_ENTRIES);
  }

  function setProgress(
    operationId: string,
    progress: { phase?: string; percent?: number; message?: string }
  ): void {
    const record = operations.get(operationId);
    if (!record) return;
    record.progress = {
      phase: progress.phase,
      percent: progress.percent,
      message: progress.message ? redactText(progress.message) : undefined,
    };
  }

  function setState(operationId: string, state: OperationState, endedAt?: string): void {
    const record = operations.get(operationId);
    if (!record) return;
    record.state = state;
    if (endedAt) record.endedAt = endedAt;
  }

  function succeed(operationId: string): void {
    setState(operationId, 'succeeded', new Date().toISOString());
    notifyTerminal(operationId);
  }

  function fail(operationId: string, error: BureauError): void {
    const record = operations.get(operationId);
    if (!record) return;
    if (record.state === 'cancelled') return;
    record.state = 'failed';
    record.endedAt = new Date().toISOString();
    record.error = error;
    notifyTerminal(operationId);
  }

  function cancel(operationId: string): OperationCancelResult {
    const record = operations.get(operationId);
    if (!record) {
      return {
        ok: false,
        error: toBureauError({
          code: 'INVALID_REQUEST',
          message: 'Operation not found.',
          operation: 'operations.cancel',
          retryable: false,
        }),
      };
    }
    if (!record.cancellable || record.state !== 'running') {
      return {
        ok: false,
        error: toBureauError({
          code: 'INVALID_REQUEST',
          message: 'Operation cannot be cancelled.',
          operation: 'operations.cancel',
          retryable: false,
        }),
      };
    }
    if (!options?.onCancel?.(operationId)) {
      return {
        ok: false,
        error: toBureauError({
          code: 'OPERATION_BUSY',
          message: 'Operation is no longer running and could not be cancelled.',
          operation: 'operations.cancel',
          retryable: true,
        }),
      };
    }
    record.state = 'cancelled';
    record.endedAt = new Date().toISOString();
    notifyTerminal(operationId);
    return { ok: true };
  }

  function list(): OperationListResult {
    const items = order
      .map((id) => operations.get(id))
      .filter((r): r is OperationRecord => r !== undefined)
      .reverse();
    return { operations: items };
  }

  async function runTracked<T>(input: {
    kind: OperationKind;
    summary: string;
    projectId?: string;
    cancellable?: boolean;
    fn: (ctx: { operationId: string }) => Promise<T>;
  }): Promise<T> {
    const operationId = start({
      kind: input.kind,
      summary: input.summary,
      projectId: input.projectId,
      cancellable: input.cancellable,
    });
    try {
      const result = await input.fn({ operationId });
      const record = getRecord(operationId);
      if (record?.state !== 'cancelled') {
        succeed(operationId);
      }
      return result;
    } catch (error) {
      const record = getRecord(operationId);
      if (record?.state === 'cancelled') {
        throw error;
      }
      const starError =
        error && typeof error === 'object' && 'code' in error
          ? (error as BureauError)
          : toBureauError({
              code: 'COMMAND_FAILED',
              message: error instanceof Error ? error.message : String(error),
              operation: input.kind,
              subjectId: input.projectId,
              retryable: true,
            });
      fail(operationId, starError);
      throw starError;
    }
  }

  return {
    start,
    appendOutput,
    setProgress,
    succeed,
    fail,
    cancel,
    list,
    get: getRecord,
    runTracked,
  };
}
