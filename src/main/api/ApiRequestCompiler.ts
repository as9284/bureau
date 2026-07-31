import { randomUUID } from 'node:crypto';
import type {
  ApiAuth,
  ApiKeyValue,
  ApiRequestDefinition,
} from '@shared/contracts/apiWorkbench';
import type { VariableResolverInput } from './VariableResolver';
import { resolveTemplate } from './VariableResolver';
import { toBureauError } from '../ipc/errors';

export type CompiledRequest = {
  url: string;
  method: string;
  headers: Array<{ name: string; value: string }>;
  body?: Buffer;
  contentType?: string;
};

export type CompileRequestInput = {
  request: Pick<
    ApiRequestDefinition,
    | 'urlTemplate'
    | 'method'
    | 'query'
    | 'headers'
    | 'auth'
    | 'body'
    | 'settings'
    | 'variables'
    | 'protocol'
    | 'protocolOptions'
  >;
  workspaceAuth: ApiAuth;
  variableInput: VariableResolverInput;
  getSecretPlaintext: (secretId: string) => string | undefined;
  /**
   * Returns an already-valid access token for an OAuth profile. The caller refreshes before
   * compiling, so compilation stays synchronous and never performs network I/O.
   */
  getOAuthAccessToken?: (profileId: string) => string | undefined;
  operation: string;
};

function resolveField(
  template: string,
  input: VariableResolverInput,
  operation: string
):
  | { ok: true; value: string }
  | { ok: false; error: ReturnType<typeof toBureauError> } {
  const result = resolveTemplate(template, input, operation);
  if (!result.ok) return result;
  return { ok: true, value: result.resolved };
}

function effectiveAuth(requestAuth: ApiAuth, workspaceAuth: ApiAuth): ApiAuth {
  if (requestAuth.kind === 'inherit') return workspaceAuth;
  return requestAuth;
}

/**
 * Multipart part names are placed inside a quoted Content-Disposition value, so a quote or a
 * control character would let a field name forge extra headers or a boundary. Returns null to
 * reject rather than silently mangling the name.
 */
function encodePartName(name: string): string | null {
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return null;
  }
  if (name.includes('"') || name.includes('\\')) return null;
  return name;
}

function encodeForm(fields: ApiKeyValue[]): string {
  const params = new URLSearchParams();
  for (const field of fields) {
    if (!field.enabled) continue;
    params.append(field.name, field.value);
  }
  return params.toString();
}

export function compileApiRequest(
  input: CompileRequestInput
): { ok: true; compiled: CompiledRequest } | { ok: false; error: ReturnType<typeof toBureauError> } {
  const operation = input.operation;
  const variableInput = input.variableInput;
  const sendUnresolved = input.request.settings.sendUnresolvedLiterals ?? false;
  const resolverInput = { ...variableInput, sendUnresolvedLiterals: sendUnresolved };

  const urlResult = resolveField(input.request.urlTemplate, resolverInput, operation);
  if (!urlResult.ok) return urlResult;

  let url: URL;
  try {
    url = new URL(urlResult.value);
  } catch {
    return {
      ok: false,
      error: toBureauError({
        code: 'INVALID_REQUEST',
        message: 'The request URL is not valid.',
        operation,
        retryable: false,
      }),
    };
  }

  for (const param of input.request.query) {
    if (!param.enabled) continue;
    const nameResult = resolveField(param.name, resolverInput, operation);
    if (!nameResult.ok) return nameResult;
    const valueResult = resolveField(param.value, resolverInput, operation);
    if (!valueResult.ok) return valueResult;
    url.searchParams.append(nameResult.value, valueResult.value);
  }

  const headers: Array<{ name: string; value: string }> = [];
  for (const header of input.request.headers) {
    if (!header.enabled) continue;
    const nameResult = resolveField(header.name, resolverInput, operation);
    if (!nameResult.ok) return nameResult;
    const valueResult = resolveField(header.value, resolverInput, operation);
    if (!valueResult.ok) return valueResult;
    headers.push({ name: nameResult.value, value: valueResult.value });
  }

  const auth = effectiveAuth(input.request.auth, input.workspaceAuth);
  if (auth.kind === 'basic') {
    const usernameResult = resolveField(auth.usernameTemplate, resolverInput, operation);
    if (!usernameResult.ok) return usernameResult;
    const password = auth.passwordSecretId
      ? input.getSecretPlaintext(auth.passwordSecretId) ?? ''
      : '';
    const token = Buffer.from(`${usernameResult.value}:${password}`).toString('base64');
    headers.push({ name: 'Authorization', value: `Basic ${token}` });
  } else if (auth.kind === 'bearer') {
    const token = auth.tokenSecretId ? input.getSecretPlaintext(auth.tokenSecretId) : undefined;
    if (token) headers.push({ name: 'Authorization', value: `Bearer ${token}` });
  } else if (auth.kind === 'api-key') {
    const nameResult = resolveField(auth.nameTemplate, resolverInput, operation);
    if (!nameResult.ok) return nameResult;
    const value = auth.valueSecretId ? input.getSecretPlaintext(auth.valueSecretId) : undefined;
    if (value) {
      if (auth.placement === 'header') {
        headers.push({ name: nameResult.value, value });
      } else {
        url.searchParams.append(nameResult.value, value);
      }
    }
  } else if (auth.kind === 'oauth2') {
    const token = input.getOAuthAccessToken?.(auth.profileId);
    if (!token) {
      return {
        ok: false,
        error: toBureauError({
          code: 'API_OAUTH_FAILED',
          message: 'No valid OAuth access token. Authorize the profile and try again.',
          operation,
          subjectId: auth.profileId,
          retryable: false,
        }),
      };
    }
    headers.push({ name: 'Authorization', value: `Bearer ${token}` });
  }

  let body: Buffer | undefined;
  let contentType: string | undefined;

  // GraphQL owns its payload: the declarative body editor does not apply.
  if (input.request.protocol === 'graphql') {
    const graphql = input.request.protocolOptions.graphql;
    if (!graphql || !graphql.query.trim()) {
      return {
        ok: false,
        error: toBureauError({
          code: 'INVALID_REQUEST',
          message: 'A GraphQL request needs a query or mutation document.',
          operation,
          retryable: false,
        }),
      };
    }
    const queryResult = resolveField(graphql.query, resolverInput, operation);
    if (!queryResult.ok) return queryResult;
    const variablesResult = resolveField(graphql.variables || '{}', resolverInput, operation);
    if (!variablesResult.ok) return variablesResult;

    let variables: unknown;
    const rawVariables = variablesResult.value.trim() || '{}';
    try {
      variables = JSON.parse(rawVariables);
    } catch {
      return {
        ok: false,
        error: toBureauError({
          code: 'INVALID_REQUEST',
          message: 'GraphQL variables must be a JSON object.',
          operation,
          retryable: false,
        }),
      };
    }
    if (variables === null || typeof variables !== 'object' || Array.isArray(variables)) {
      return {
        ok: false,
        error: toBureauError({
          code: 'INVALID_REQUEST',
          message: 'GraphQL variables must be a JSON object.',
          operation,
          retryable: false,
        }),
      };
    }

    const payload: Record<string, unknown> = { query: queryResult.value, variables };
    if (graphql.operationName) payload.operationName = graphql.operationName;

    if (graphql.transport === 'GET') {
      // GraphQL over HTTP GET: the document travels as query parameters, with no body.
      url.searchParams.set('query', queryResult.value);
      url.searchParams.set('variables', JSON.stringify(variables));
      if (graphql.operationName) url.searchParams.set('operationName', graphql.operationName);
    } else {
      body = Buffer.from(JSON.stringify(payload), 'utf8');
      contentType = 'application/json';
    }
    if (!headers.some((header) => header.name.toLowerCase() === 'accept')) {
      headers.push({ name: 'Accept', value: 'application/graphql-response+json, application/json' });
    }
    if (contentType && !headers.some((header) => header.name.toLowerCase() === 'content-type')) {
      headers.push({ name: 'Content-Type', value: contentType });
    }
    return {
      ok: true,
      compiled: {
        url: url.toString(),
        method: graphql.transport,
        headers,
        body,
        contentType,
      },
    };
  }

  const requestBody = input.request.body;
  if (requestBody.kind === 'json') {
    const textResult = resolveField(requestBody.text, resolverInput, operation);
    if (!textResult.ok) return textResult;
    body = Buffer.from(textResult.value, 'utf8');
    contentType = 'application/json';
  } else if (requestBody.kind === 'text') {
    const textResult = resolveField(requestBody.text, resolverInput, operation);
    if (!textResult.ok) return textResult;
    body = Buffer.from(textResult.value, 'utf8');
    contentType = requestBody.contentType ?? 'text/plain';
  } else if (requestBody.kind === 'xml') {
    const textResult = resolveField(requestBody.text, resolverInput, operation);
    if (!textResult.ok) return textResult;
    body = Buffer.from(textResult.value, 'utf8');
    contentType = 'application/xml';
  } else if (requestBody.kind === 'html') {
    const textResult = resolveField(requestBody.text, resolverInput, operation);
    if (!textResult.ok) return textResult;
    body = Buffer.from(textResult.value, 'utf8');
    contentType = 'text/html';
  } else if (requestBody.kind === 'form-urlencoded') {
    const fields: ApiKeyValue[] = [];
    for (const field of requestBody.fields) {
      if (!field.enabled) continue;
      const nameResult = resolveField(field.name, resolverInput, operation);
      if (!nameResult.ok) return nameResult;
      const valueResult = resolveField(field.value, resolverInput, operation);
      if (!valueResult.ok) return valueResult;
      fields.push({ ...field, name: nameResult.value, value: valueResult.value });
    }
    body = Buffer.from(encodeForm(fields), 'utf8');
    contentType = 'application/x-www-form-urlencoded';
  } else if (requestBody.kind === 'multipart') {
    // Random, not time-derived: a predictable boundary can be reproduced inside a field value.
    const boundary = `----BureauForm${randomUUID().replace(/-/g, '')}`;
    const chunks: Buffer[] = [];
    for (const field of requestBody.fields) {
      if (!field.enabled) continue;
      const nameResult = resolveField(field.name, resolverInput, operation);
      if (!nameResult.ok) return nameResult;
      const valueResult = resolveField(field.value, resolverInput, operation);
      if (!valueResult.ok) return valueResult;
      const partName = encodePartName(nameResult.value);
      if (partName === null) {
        return {
          ok: false,
          error: toBureauError({
            code: 'INVALID_REQUEST',
            message: 'A multipart field name must not contain CR, LF, NUL, or quote characters.',
            operation,
            retryable: false,
          }),
        };
      }
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${partName}"\r\n\r\n${valueResult.value}\r\n`
        )
      );
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    body = Buffer.concat(chunks);
    contentType = `multipart/form-data; boundary=${boundary}`;
  }

  if (contentType && !headers.some((header) => header.name.toLowerCase() === 'content-type')) {
    headers.push({ name: 'Content-Type', value: contentType });
  }

  return {
    ok: true,
    compiled: {
      url: url.toString(),
      method: input.request.method.toUpperCase(),
      headers,
      body,
      contentType,
    },
  };
}
