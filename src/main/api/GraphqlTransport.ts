import { z } from 'zod';
import type { ApiGraphqlSchemaSummary } from '@shared/contracts/apiWorkbench';
import { executeHttpTransport, type HttpTransportRequest } from './HttpTransport';

/**
 * Bounded introspection query. Deliberately shallower than the reference query: it collects
 * type and field names for the schema browser without walking the full type graph, which keeps
 * both the response size and the parse cost predictable.
 */
export const INTROSPECTION_QUERY = `query BureauIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      fields(includeDeprecated: false) { name }
      inputFields { name }
      enumValues(includeDeprecated: false) { name }
    }
  }
}`;

const MAX_TYPES = 2_000;
const MAX_FIELDS_PER_TYPE = 500;
/** Introspection payloads are far smaller than a data response; cap them hard. */
export const INTROSPECTION_RESPONSE_CAP = 8 * 1024 * 1024;

const introspectionSchema = z.object({
  data: z.object({
    __schema: z.object({
      queryType: z.object({ name: z.string() }).nullish(),
      mutationType: z.object({ name: z.string() }).nullish(),
      subscriptionType: z.object({ name: z.string() }).nullish(),
      types: z.array(
        z.object({
          kind: z.string(),
          name: z.string().nullish(),
          fields: z.array(z.object({ name: z.string() })).nullish(),
          inputFields: z.array(z.object({ name: z.string() })).nullish(),
          enumValues: z.array(z.object({ name: z.string() })).nullish(),
        })
      ),
    }),
  }),
});

export type GraphqlErrorEntry = {
  message: string;
  path?: string;
  line?: number;
  column?: number;
};

const graphqlErrorsSchema = z.object({
  errors: z
    .array(
      z.object({
        message: z.string(),
        path: z.array(z.union([z.string(), z.number()])).nullish(),
        locations: z.array(z.object({ line: z.number(), column: z.number() })).nullish(),
      })
    )
    .nullish(),
});

/**
 * Extracts the GraphQL `errors` array from a response body. GraphQL reports errors with HTTP
 * 200, so the response inspector needs this to show a failure that the status code hides.
 */
export function parseGraphqlErrors(bodyText: string | undefined): GraphqlErrorEntry[] {
  if (!bodyText) return [];
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return [];
  }
  const parsed = graphqlErrorsSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.errors) return [];
  return parsed.data.errors.slice(0, 200).map((error) => ({
    message: error.message.slice(0, 2000),
    path: error.path?.join('.'),
    line: error.locations?.[0]?.line,
    column: error.locations?.[0]?.column,
  }));
}

/**
 * Runs introspection against an endpoint. Never called automatically on URL entry — the caller
 * gates this behind an explicit user action and supplies the request's own auth and headers.
 */
export async function introspectGraphqlSchema(
  request: Omit<HttpTransportRequest, 'body' | 'method' | 'persistResponseBytes' | 'displayResponseBytes'>
): Promise<
  | { ok: true; schema: ApiGraphqlSchemaSummary }
  | { ok: false; code: string; message: string }
> {
  const headers = request.headers.filter(
    (header) => header.name.toLowerCase() !== 'content-type' && header.name.toLowerCase() !== 'accept'
  );
  const response = await executeHttpTransport({
    ...request,
    method: 'POST',
    headers: [
      ...headers,
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Accept', value: 'application/graphql-response+json, application/json' },
    ],
    body: Buffer.from(JSON.stringify({ query: INTROSPECTION_QUERY }), 'utf8'),
    persistResponseBytes: INTROSPECTION_RESPONSE_CAP,
    displayResponseBytes: INTROSPECTION_RESPONSE_CAP,
  });

  if (response.errorCode) {
    return { ok: false, code: response.errorCode, message: response.errorMessage ?? 'Introspection failed.' };
  }
  if (response.truncated) {
    return {
      ok: false,
      code: 'API_RESPONSE_TOO_LARGE',
      message: 'The introspection response exceeded the size limit.',
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body.toString('utf8'));
  } catch {
    return {
      ok: false,
      code: 'API_PROTOCOL_ERROR',
      message: 'The introspection response was not valid JSON.',
    };
  }

  const errors = parseGraphqlErrors(response.body.toString('utf8'));
  const parsed = introspectionSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'API_PROTOCOL_ERROR',
      message: errors[0]
        ? `Introspection was rejected: ${errors[0].message.slice(0, 200)}`
        : 'The endpoint did not return an introspection schema.',
    };
  }

  const schema = parsed.data.data.__schema;
  const types = schema.types
    .filter((type) => Boolean(type.name))
    .slice(0, MAX_TYPES)
    .map((type) => ({
      name: type.name!,
      kind: type.kind,
      fields: [
        ...(type.fields ?? []),
        ...(type.inputFields ?? []),
        ...(type.enumValues ?? []),
      ]
        .slice(0, MAX_FIELDS_PER_TYPE)
        .map((field) => field.name),
    }));

  return {
    ok: true,
    schema: {
      endpoint: response.url,
      fetchedAt: new Date().toISOString(),
      queryTypeName: schema.queryType?.name,
      mutationTypeName: schema.mutationType?.name,
      subscriptionTypeName: schema.subscriptionType?.name,
      types,
    },
  };
}
