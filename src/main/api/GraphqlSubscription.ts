import type { ApiStreamEntry } from '@shared/contracts/apiWorkbench';

/**
 * The `graphql-transport-ws` protocol, as a pure state machine over the existing WebSocket engine.
 *
 * Kept separate from `WebSocketTransport` on purpose: the transport owns sockets and destination
 * policy, this owns one protocol's message grammar, and neither needs to know about the other's
 * failure modes. It is also what makes the protocol testable without opening a socket.
 *
 * Only `graphql-transport-ws` is implemented. The older `subscriptions-transport-ws` ("graphql-ws")
 * is deprecated and unmaintained, and supporting both means guessing which one a server speaks from
 * a subprotocol string the server may not send.
 */

export const GRAPHQL_WS_SUBPROTOCOL = 'graphql-transport-ws';

/** Servers commonly idle-close a connection that never acknowledges; this bounds our wait. */
export const CONNECTION_ACK_TIMEOUT_MS = 10_000;

export type GraphqlSubscriptionOutgoing =
  | { type: 'connection_init'; payload?: Record<string, unknown> }
  | { type: 'subscribe'; id: string; payload: { query: string; variables?: unknown; operationName?: string } }
  | { type: 'complete'; id: string }
  | { type: 'pong'; payload?: unknown };

export type GraphqlSubscriptionEvent =
  | { kind: 'ack' }
  | { kind: 'next'; data: unknown }
  | { kind: 'errors'; errors: unknown }
  | { kind: 'complete' }
  | { kind: 'ping'; payload?: unknown }
  | { kind: 'pong' }
  | { kind: 'protocol-error'; message: string };

export function connectionInit(payload?: Record<string, unknown>): GraphqlSubscriptionOutgoing {
  return payload ? { type: 'connection_init', payload } : { type: 'connection_init' };
}

export function subscribeMessage(
  id: string,
  query: string,
  variables: unknown,
  operationName?: string
): GraphqlSubscriptionOutgoing {
  const payload: { query: string; variables?: unknown; operationName?: string } = { query };
  if (variables !== undefined) payload.variables = variables;
  if (operationName) payload.operationName = operationName;
  return { type: 'subscribe', id, payload };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses one server frame. `subscriptionId` filters to the active operation: a server may still be
 * draining a previous subscription's frames when a new one starts, and applying those to the new
 * operation would misreport it.
 */
export function parseGraphqlWsMessage(
  text: string,
  subscriptionId: string
): GraphqlSubscriptionEvent | null {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return { kind: 'protocol-error', message: 'The server sent a frame that is not JSON.' };
  }
  if (!isRecord(message) || typeof message.type !== 'string') {
    return { kind: 'protocol-error', message: 'The server sent a frame with no type.' };
  }

  switch (message.type) {
    case 'connection_ack':
      return { kind: 'ack' };
    case 'ping':
      return { kind: 'ping', payload: message.payload };
    case 'pong':
      return { kind: 'pong' };
    case 'next': {
      if (message.id !== subscriptionId) return null;
      return { kind: 'next', data: isRecord(message.payload) ? message.payload : message.payload };
    }
    case 'error': {
      if (message.id !== subscriptionId) return null;
      return { kind: 'errors', errors: message.payload };
    }
    case 'complete': {
      if (message.id !== subscriptionId) return null;
      return { kind: 'complete' };
    }
    default:
      return {
        kind: 'protocol-error',
        message: `The server sent an unknown frame type \`${message.type}\`.`,
      };
  }
}

/** Renders a parsed event as a transcript row, so subscriptions read like any other stream. */
export function graphqlEventToEntry(
  event: GraphqlSubscriptionEvent,
  displayBytes: number
): Pick<ApiStreamEntry, 'direction' | 'kind' | 'text' | 'truncated' | 'eventName'> | null {
  const bound = (value: unknown): { text: string; truncated?: boolean } => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
    if (text.length <= displayBytes) return { text };
    return { text: text.slice(0, displayBytes), truncated: true };
  };

  switch (event.kind) {
    case 'ack':
      return { direction: 'system', kind: 'open', text: 'connection_ack' };
    case 'next': {
      const { text, truncated } = bound(event.data);
      return { direction: 'in', kind: 'sse-event', eventName: 'next', text, truncated };
    }
    case 'errors': {
      const { text, truncated } = bound(event.errors);
      return { direction: 'in', kind: 'error', text, truncated };
    }
    case 'complete':
      return { direction: 'system', kind: 'close', text: 'The subscription completed.' };
    case 'protocol-error':
      return { direction: 'system', kind: 'error', text: event.message };
    // Keep-alives are protocol noise; showing every one would bury the payloads.
    case 'ping':
    case 'pong':
      return null;
  }
}
