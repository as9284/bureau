import { z } from 'zod';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- reject header/method injection
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const apiEmptyRequestSchema = z.object({}).strict();

export const apiEntityIdField = z.string().max(64).regex(UUID_RE, 'must be a UUID');
export const apiWorkspaceIdField = apiEntityIdField;

const nameField = z.string().min(1).max(128);
const methodField = z
  .string()
  .min(1)
  .max(32)
  .refine((value) => !CONTROL.test(value), 'method must not contain control characters');
const headerNameField = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !CONTROL.test(value), 'header name must not contain control characters');
const headerValueField = z
  .string()
  .max(8192)
  .refine((value) => !CONTROL.test(value), 'header value must not contain control characters');

export const apiKeyValueSchema = z
  .object({
    id: apiEntityIdField,
    name: z.string().max(256),
    value: z.string().max(1_000_000),
    enabled: z.boolean(),
  })
  .strict();

export const apiAuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit') }).strict(),
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('basic'),
      usernameTemplate: z.string().max(1024),
      passwordSecretId: apiEntityIdField.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('bearer'),
      tokenSecretId: apiEntityIdField.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('api-key'),
      placement: z.enum(['header', 'query']),
      nameTemplate: z.string().max(256),
      valueSecretId: apiEntityIdField.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('oauth2'), profileId: apiEntityIdField }).strict(),
]);

export const apiBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('json'), text: z.string().max(10_000_000) }).strict(),
  z
    .object({
      kind: z.literal('text'),
      text: z.string().max(10_000_000),
      contentType: z.string().max(256).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('xml'), text: z.string().max(10_000_000) }).strict(),
  z.object({ kind: z.literal('html'), text: z.string().max(10_000_000) }).strict(),
  z
    .object({
      kind: z.literal('form-urlencoded'),
      fields: z.array(apiKeyValueSchema).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal('multipart'),
      fields: z.array(apiKeyValueSchema).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal('binary'),
      fileName: z.string().max(512).optional(),
      byteLength: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);

export const apiVariableSchema = z
  .object({
    variableId: apiEntityIdField,
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'variable name must be an identifier'),
    enabled: z.boolean(),
    secret: z.boolean(),
    value: z.string().max(100_000).optional(),
    secretId: apiEntityIdField.optional(),
    hasSecretValue: z.boolean().optional(),
  })
  .strict();

export const apiProtocolField = z.enum(['http', 'graphql', 'websocket', 'sse']);

export const apiProtocolOptionsSchema = z
  .object({
    http: z.object({ http2: z.boolean().optional() }).strict().optional(),
    graphql: z
      .object({
        query: z.string().max(500_000),
        variables: z.string().max(500_000),
        operationName: z.string().max(256).optional(),
        transport: z.enum(['POST', 'GET', 'WS']),
      })
      .strict()
      .optional(),
    websocket: z
      .object({
        subprotocols: z.array(z.string().min(1).max(128)).max(16),
        messageDraft: z.string().max(1_000_000).optional(),
        messageFormat: z.enum(['text', 'json', 'binary-hex']).optional(),
      })
      .strict()
      .optional(),
    sse: z
      .object({
        reconnect: z.boolean(),
        lastEventId: z.string().max(1024).optional(),
      })
      .strict()
      .optional(),
    tlsProfileId: apiEntityIdField.optional(),
    proxyProfileId: apiEntityIdField.optional(),
  })
  .strict();

export const apiRequestSettingsSchema = z
  .object({
    timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    maxRedirects: z.number().int().min(0).max(50).optional(),
    followRedirects: z.boolean().optional(),
    sendUnresolvedLiterals: z.boolean().optional(),
  })
  .strict();

/** Script source bound. The sandbox also refuses anything larger, so this is the outer gate. */
export const apiScriptSourceField = z.string().max(100_000);

export const apiScriptsSchema = z
  .object({
    preRequest: apiScriptSourceField.optional(),
    postResponse: apiScriptSourceField.optional(),
    enabled: z.boolean().optional(),
    origin: z.enum(['authored', 'imported']).optional(),
  })
  .strict();

export const apiWorkspaceIdRequestSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
  })
  .strict();

export const apiCreateWorkspaceSchema = z
  .object({
    name: nameField,
    linkedProjectId: apiEntityIdField.optional(),
  })
  .strict();

export const apiUpdateWorkspaceSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    expectedRevision: z.number().int().nonnegative(),
    name: nameField.optional(),
    linkedProjectId: z.union([apiEntityIdField, z.null()]).optional(),
    activeEnvironmentId: z.union([apiEntityIdField, z.null()]).optional(),
    defaultProxyProfileId: z.union([apiEntityIdField, z.null()]).optional(),
    activeCookieJarId: z.union([z.string().max(64), z.null()]).optional(),
    variables: z.array(apiVariableSchema).max(500).optional(),
    auth: apiAuthSchema.optional(),
  })
  .strict();

export const apiDeleteWorkspaceSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const apiCreateCollectionSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    parentId: z.union([apiEntityIdField, z.null()]),
    kind: z.enum(['folder', 'request']),
    name: nameField,
  })
  .strict();

export const apiUpdateCollectionSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    collectionId: apiEntityIdField,
    expectedRevision: z.number().int().nonnegative(),
    name: nameField.optional(),
    parentId: z.union([apiEntityIdField, z.null()]).optional(),
    order: z.number().int().nonnegative().optional(),
    auth: apiAuthSchema.optional(),
    variables: z.array(apiVariableSchema).max(500).optional(),
    scripts: apiScriptsSchema.optional(),
  })
  .strict();

export const apiDeleteCollectionSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    collectionId: apiEntityIdField,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const apiSaveRequestSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    requestId: apiEntityIdField,
    expectedRevision: z.number().int().nonnegative(),
    patch: z
      .object({
        name: nameField.optional(),
        urlTemplate: z.string().max(8192).optional(),
        method: methodField.optional(),
        query: z.array(apiKeyValueSchema).max(200).optional(),
        headers: z
          .array(
            z
              .object({
                id: apiEntityIdField,
                name: headerNameField,
                value: headerValueField,
                enabled: z.boolean(),
              })
              .strict()
          )
          .max(200)
          .optional(),
        auth: apiAuthSchema.optional(),
        body: apiBodySchema.optional(),
        settings: apiRequestSettingsSchema.optional(),
        variables: z.array(apiVariableSchema).max(200).optional(),
        scripts: apiScriptsSchema.optional(),
        protocol: apiProtocolField.optional(),
        protocolOptions: apiProtocolOptionsSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const apiDeleteRequestSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    requestId: apiEntityIdField,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const apiCreateEnvironmentSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    name: nameField,
  })
  .strict();

export const apiUpdateEnvironmentSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    environmentId: apiEntityIdField,
    expectedRevision: z.number().int().nonnegative(),
    name: nameField.optional(),
    variables: z.array(apiVariableSchema).max(500).optional(),
  })
  .strict();

export const apiDeleteEnvironmentSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    environmentId: apiEntityIdField,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const apiSaveSecretSchema = z
  .object({
    secretId: apiEntityIdField.optional(),
    label: nameField,
    value: z.string().min(1).max(100_000),
    persist: z.boolean(),
  })
  .strict();

export const apiDeleteSecretSchema = z
  .object({
    secretId: apiEntityIdField,
  })
  .strict();

/**
 * Draft headers go straight to the wire, so they carry the same control-character rejection
 * as saved headers. A plain key/value shape here would let a send bypass the CRLF guard.
 */
const apiHeaderRowSchema = z
  .object({
    id: apiEntityIdField,
    name: headerNameField,
    value: headerValueField,
    enabled: z.boolean(),
  })
  .strict();

export const apiDraftSchema = z
  .object({
    urlTemplate: z.string().max(8192).optional(),
    method: methodField.optional(),
    query: z.array(apiKeyValueSchema).max(200).optional(),
    headers: z.array(apiHeaderRowSchema).max(200).optional(),
    auth: apiAuthSchema.optional(),
    body: apiBodySchema.optional(),
    settings: apiRequestSettingsSchema.optional(),
    variables: z.array(apiVariableSchema).max(200).optional(),
    protocol: apiProtocolField.optional(),
    protocolOptions: apiProtocolOptionsSchema.optional(),
    scripts: apiScriptsSchema.optional(),
  })
  .strict();

export const apiSendRequestSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    requestId: apiEntityIdField,
    draft: apiDraftSchema.optional(),
    environmentId: z.union([apiEntityIdField, z.null()]).optional(),
  })
  .strict();

export const apiCancelRequestSchema = z
  .object({
    sessionId: apiEntityIdField,
  })
  .strict();

export const apiHistoryIdRequestSchema = z
  .object({
    historyId: apiEntityIdField,
  })
  .strict();

export const apiDirtyDraftCountSchema = z
  .object({
    count: z.number().int().nonnegative().max(10_000),
  })
  .strict();

/* ------------------------------------------------------------------ Phase 2 */

export const apiOpenStreamSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    requestId: apiEntityIdField,
    draft: apiDraftSchema.optional(),
    environmentId: z.union([apiEntityIdField, z.null()]).optional(),
  })
  .strict();

export const apiSendStreamMessageSchema = z
  .object({
    sessionId: apiEntityIdField,
    format: z.enum(['text', 'json', 'binary-hex']),
    payload: z.string().max(1_000_000),
  })
  .strict();

export const apiCloseStreamSchema = z
  .object({
    sessionId: apiEntityIdField,
    // RFC 6455 reserves 1000 and the 3000-4999 application range for close codes.
    code: z
      .number()
      .int()
      .refine((value) => value === 1000 || (value >= 3000 && value <= 4999), 'invalid close code')
      .optional(),
    reason: z.string().max(123).optional(),
  })
  .strict();

export const apiSetStreamPausedSchema = z
  .object({
    sessionId: apiEntityIdField,
    paused: z.boolean(),
  })
  .strict();

export const apiStreamIdSchema = z.object({ sessionId: apiEntityIdField }).strict();

export const apiIntrospectGraphqlSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    requestId: apiEntityIdField,
    draft: apiDraftSchema.optional(),
    environmentId: z.union([apiEntityIdField, z.null()]).optional(),
  })
  .strict();

/**
 * A weakened-TLS entry is an exact `host` or `host:port`. Wildcards and paths are rejected
 * here as well as in the TLS policy, so an exception can never widen beyond one host.
 */
const exactHostField = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !CONTROL.test(value), 'host must not contain control characters')
  .refine(
    (value) => !/[*/\s]/.test(value),
    'host must be an exact host or host:port'
  );

const pemField = z
  .string()
  .max(200_000)
  .refine((value) => !CONTROL.test(value), 'certificate must not contain control characters');

export const apiSaveTlsProfileSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    profileId: apiEntityIdField.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    name: nameField,
    caPem: pemField.optional(),
    clientCertPem: pemField.optional(),
    clientKeySecretId: z.union([apiEntityIdField, z.null()]).optional(),
    passphraseSecretId: z.union([apiEntityIdField, z.null()]).optional(),
    minVersion: z.union([z.enum(['TLSv1.2', 'TLSv1.3']), z.null()]).optional(),
    allowInvalidCertificateHosts: z.array(exactHostField).max(50),
    enabled: z.boolean(),
  })
  .strict();

export const apiDeleteTlsProfileSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    profileId: apiEntityIdField,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

/** OAuth endpoints must be absolute https (or loopback http) URLs, never a template. */
const oauthEndpointField = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (url.protocol === 'https:') return true;
    // Plain http is tolerated only for a local development authorization server.
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    );
  }, 'must be an https URL (or a loopback http URL)');

export const apiSaveOAuthProfileSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    profileId: apiEntityIdField.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    name: nameField,
    grant: z.enum(['authorization_code', 'client_credentials']),
    authorizationUrl: oauthEndpointField.optional(),
    tokenUrl: oauthEndpointField,
    clientId: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => !CONTROL.test(value), 'client id must not contain control characters'),
    clientSecretId: z.union([apiEntityIdField, z.null()]).optional(),
    scope: z.string().max(2048).optional(),
    audience: z.string().max(2048).optional(),
    // 0 means "pick an ephemeral port", which is the preferred configuration.
    redirectPort: z.union([z.number().int().min(0).max(65535), z.null()]).optional(),
  })
  .strict()
  .refine(
    (value) => value.grant !== 'authorization_code' || Boolean(value.authorizationUrl),
    'the authorization code grant needs an authorization URL'
  );

export const apiDeleteOAuthProfileSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    profileId: apiEntityIdField,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const apiOAuthProfileRefSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    profileId: apiEntityIdField,
  })
  .strict();

/* ------------------------------------------------------------------ Phase 3 */

export const apiInterchangeFormatField = z.enum(['curl', 'postman', 'openapi', 'har', 'bureau']);

export const apiInspectImportSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    format: z.union([apiInterchangeFormatField, z.literal('auto')]),
    // Bounded here as well as in main: the renderer must not be able to hand over an
    // unbounded string, and the file path never crosses IPC at all.
    text: z.string().max(50_000_000).optional(),
    fromFile: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.fromFile) !== (value.text !== undefined),
    'provide either pasted text or fromFile, not both'
  );

export const apiCommitImportSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    previewId: apiEntityIdField,
    parentId: z.union([apiEntityIdField, z.null()]),
    conflictStrategy: z.enum(['rename', 'replace', 'skip']),
    acknowledgeScripts: z.boolean(),
  })
  .strict();

export const apiDiscardImportSchema = z.object({ previewId: apiEntityIdField }).strict();

export const apiExportScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }).strict(),
  z.object({ kind: z.literal('collection'), collectionId: apiEntityIdField }).strict(),
  z.object({ kind: z.literal('request'), requestId: apiEntityIdField }).strict(),
  z
    .object({ kind: z.literal('history'), historyIds: z.array(apiEntityIdField).max(1000) })
    .strict(),
]);

export const apiExportSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    format: apiInterchangeFormatField,
    scope: apiExportScopeSchema,
  })
  .strict();

/* ------------------------------------------------------------------ Phase 4 */

export const apiScriptPhaseField = z.enum(['pre-request', 'post-response']);

export const apiValidateScriptSchema = z
  .object({
    source: apiScriptSourceField,
    phase: apiScriptPhaseField,
  })
  .strict();

export const apiApproveScriptsSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    collectionId: z.union([apiEntityIdField, z.null()]),
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const apiListScriptLocationsSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    collectionId: z.union([apiEntityIdField, z.null()]),
  })
  .strict();

export const apiRunTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }).strict(),
  z.object({ kind: z.literal('collection'), collectionId: apiEntityIdField }).strict(),
  z.object({ kind: z.literal('request'), requestId: apiEntityIdField }).strict(),
]);

export const apiStartRunSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    target: apiRunTargetSchema,
    environmentId: z.union([apiEntityIdField, z.null()]).optional(),
    iterations: z.number().int().min(1).max(1_000),
    delayMs: z.number().int().min(0).max(60_000),
    stopOnFailure: z.boolean(),
    perRequestTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    dataSetId: apiEntityIdField.optional(),
  })
  .strict();

export const apiRunIdSchema = z.object({ runId: apiEntityIdField }).strict();

export const apiExportRunReportSchema = z
  .object({
    runId: apiEntityIdField,
    format: z.enum(['json', 'junit']),
  })
  .strict();

export const apiRunDataIdSchema = z.object({ dataSetId: apiEntityIdField }).strict();

/* ------------------------------------------------------------------ Phase 5 */

/** A bypass entry is an exact host, a leading-dot suffix, or `*`. Never a glob. */
const proxyBypassField = z
  .string()
  .max(255)
  .refine((value) => !CONTROL.test(value) && !value.includes('/'), 'invalid bypass entry');

export const apiSaveProxyProfileSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    profileId: apiEntityIdField.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    name: nameField,
      mode: z.enum(['direct', 'system', 'http', 'https', 'socks5']),
    host: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !CONTROL.test(value), 'host must not contain control characters')
      .optional(),
    port: z.number().int().min(1).max(65535).optional(),
    username: z
      .string()
      .max(255)
      .refine((value) => !CONTROL.test(value), 'username must not contain control characters')
      .optional(),
    passwordSecretId: z.union([apiEntityIdField, z.null()]).optional(),
    bypass: z.array(proxyBypassField).max(200),
    enabled: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.mode !== 'http' || Boolean(value.host && value.port),
    'an HTTP proxy needs a host and a port'
  )
  .refine(
      (value) =>
        !(['https', 'socks5'] as const).includes(value.mode as 'https' | 'socks5') ||
        Boolean(value.host && value.port),
      'an HTTPS or SOCKS5 proxy needs a host and a port'
  );

export const apiDeleteProxyProfileSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    profileId: apiEntityIdField,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

/** Jar ids are Bureau-generated names, bounded so a jar key cannot become unbounded. */
const cookieJarIdField = z.string().max(64).optional();

export const apiListCookiesSchema = z
  .object({ workspaceId: apiWorkspaceIdField, jarId: cookieJarIdField })
  .strict();

export const apiDeleteCookieSchema = z
  .object({
    workspaceId: apiWorkspaceIdField,
    jarId: cookieJarIdField,
    name: z.string().min(1).max(256),
    domain: z.string().max(255).optional(),
    path: z.string().min(1).max(1024),
  })
  .strict();

export const apiClearCookiesSchema = z
  .object({ workspaceId: apiWorkspaceIdField, jarId: cookieJarIdField })
  .strict();

const apiCookieSchema = z
  .object({
    name: z.string().min(1).max(256).refine((value) => !CONTROL.test(value) && !value.includes('='), 'invalid cookie name'),
    value: z.string().max(8192).refine((value) => !CONTROL.test(value), 'invalid cookie value'),
    domain: z.string().min(1).max(255).refine((value) => !CONTROL.test(value) && !value.includes('/'), 'invalid cookie domain'),
    path: z.string().min(1).max(1024).refine((value) => !CONTROL.test(value) && value.startsWith('/'), 'invalid cookie path'),
    secure: z.boolean(),
    httpOnly: z.boolean(),
    hostOnly: z.boolean(),
    sameSite: z.enum(['strict', 'lax', 'none']),
    expiresAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((value) => value.sameSite !== 'none' || value.secure, 'SameSite=None cookies require Secure');

export const apiSaveCookieSchema = z
  .object({ workspaceId: apiWorkspaceIdField, jarId: cookieJarIdField, cookie: apiCookieSchema })
  .strict();

export const apiBackupSchema = z.object({}).strict();

export const apiRestorePlanSchema = z.object({}).strict();

export const apiCommitRestoreSchema = z
  .object({ restoreId: apiEntityIdField, mode: z.enum(['merge', 'replace']) })
  .strict();
