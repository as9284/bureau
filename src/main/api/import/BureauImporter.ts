import { z } from 'zod';
import {
  ImportError,
  draftRequest,
  isRecord,
  newDraft,
  note,
  parseStructured,
  pushNode,
  tempId,
  type ImportDraft,
  type ImportLimits,
} from './importSupport';
import {
  apiAuthSchema,
  apiBodySchema,
  apiKeyValueSchema,
  apiProtocolField,
  apiProtocolOptionsSchema,
  apiRequestSettingsSchema,
  apiScriptsSchema,
} from '@shared/validation/apiWorkbench';

/** Current version of Bureau's own interchange format. */
export const BUREAU_FORMAT = 'bureau-api';
export const BUREAU_FORMAT_VERSION = 1;

/**
 * The native export shape. Validated with the same field schemas the IPC boundary uses, so a
 * hand-edited or hostile file cannot smuggle a value the rest of the app would reject.
 */
const bureauNodeSchema = z.object({
  tempId: z.string().min(1).max(128),
  parentTempId: z.union([z.string().min(1).max(128), z.null()]),
  kind: z.enum(['folder', 'request']),
  name: z.string().min(1).max(128),
  request: z
    .object({
      protocol: apiProtocolField,
      urlTemplate: z.string().max(8192),
      method: z.string().min(1).max(32),
      query: z.array(apiKeyValueSchema).max(200),
      headers: z.array(apiKeyValueSchema).max(200),
      auth: apiAuthSchema,
      body: apiBodySchema,
      protocolOptions: apiProtocolOptionsSchema,
      settings: apiRequestSettingsSchema,
      // Accepts the `enabled`/`origin` fields a Bureau export carries, so a round-trip validates.
      // Their values are discarded: `ImportService` forces every imported script disabled and
      // untrusted regardless of what the file claims.
      scripts: apiScriptsSchema.optional(),
    })
    .optional(),
});

const bureauFileSchema = z.object({
  format: z.literal(BUREAU_FORMAT),
  version: z.number().int().positive(),
  exportedAt: z.string().max(64).optional(),
  workspace: z.object({ name: z.string().min(1).max(128) }).optional(),
  nodes: z.array(bureauNodeSchema).max(20_000),
  environments: z
    .array(
      z.object({
        name: z.string().min(1).max(128),
        variables: z
          .array(
            z.object({
              name: z.string().min(1).max(128),
              value: z.string().max(100_000).optional(),
              enabled: z.boolean(),
              secret: z.boolean(),
            })
          )
          .max(500),
      })
    )
    .max(200),
  secretPolicy: z.enum(['omitted']).optional(),
});

export function importBureau(
  source: string,
  limits: ImportLimits,
  sourceLabel: string
): ImportDraft {
  const document = parseStructured(source, limits);
  if (!isRecord(document)) {
    throw new ImportError('API_IMPORT_INVALID', 'The Bureau export is not an object.');
  }

  const parsed = bureauFileSchema.safeParse(document);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ImportError(
      'API_IMPORT_INVALID',
      `The Bureau export is not valid${first ? `: ${first.path.join('.')} ${first.message.toLowerCase()}` : '.'}`
    );
  }
  const file = parsed.data;

  // A newer file is preserved and reported, never silently downgraded.
  if (file.version > BUREAU_FORMAT_VERSION) {
    throw new ImportError(
      'API_IMPORT_INVALID',
      `This export is version ${file.version}, newer than this build understands (${BUREAU_FORMAT_VERSION}). Update Bureau to import it.`
    );
  }

  const draft = newDraft('bureau', sourceLabel);

  // Remap the file's ids so a re-import into the same workspace cannot collide with itself.
  const idMap = new Map<string, string>();
  for (const node of file.nodes) idMap.set(node.tempId, tempId());

  let scriptCount = 0;
  for (const node of file.nodes) {
    const mappedId = idMap.get(node.tempId)!;
    const parent = node.parentTempId === null ? null : (idMap.get(node.parentTempId) ?? null);
    if (node.parentTempId !== null && parent === null) {
      draft.warnings.push(
        note('orphan-node', `\`${node.name}\` referenced a missing parent and was placed at the root.`)
      );
    }

    const hasScripts = Boolean(node.request?.scripts?.preRequest ?? node.request?.scripts?.postResponse);
    if (hasScripts) scriptCount += 1;

    if (
      !pushNode(draft, limits, {
        tempId: mappedId,
        parentTempId: parent,
        kind: node.kind,
        name: node.name,
        protocol: node.request?.protocol,
        method: node.request?.method,
        url: node.request?.urlTemplate,
        hasScripts,
      })
    ) {
      break;
    }

    if (node.kind === 'request' && node.request) {
      draft.requests.set(
        mappedId,
        draftRequest({
          name: node.name,
          protocol: node.request.protocol,
          urlTemplate: node.request.urlTemplate,
          method: node.request.method,
          query: node.request.query,
          headers: node.request.headers,
          auth: node.request.auth,
          body: node.request.body,
          protocolOptions: node.request.protocolOptions,
          settings: node.request.settings,
          scripts: node.request.scripts ?? {},
          variables: [],
        })
      );
    }
  }

  for (const environment of file.environments) {
    draft.environments.push({
      tempId: tempId(),
      name: environment.name,
      variables: environment.variables.map((variable) => ({
        name: variable.name,
        // Secret values are never present in an export; the handle is re-bound by the user.
        value: variable.secret ? '' : (variable.value ?? ''),
        enabled: variable.enabled,
        secret: variable.secret,
      })),
    });
  }

  if (scriptCount > 0) {
    draft.warnings.push(
      note(
        'script-disabled',
        `${scriptCount} request${scriptCount === 1 ? '' : 's'} carr${scriptCount === 1 ? 'ies' : 'y'} a script. Scripts are always imported disabled.`
      )
    );
  }
  const secretVariables = file.environments.reduce(
    (total, environment) => total + environment.variables.filter((variable) => variable.secret).length,
    0
  );
  if (secretVariables > 0) {
    draft.warnings.push(
      note(
        'secret-variable',
        `${secretVariables} secret variable${secretVariables === 1 ? '' : 's'} came in without ${
          secretVariables === 1 ? 'a value' : 'values'
        } — exports never contain secrets. Re-add ${secretVariables === 1 ? 'it' : 'them'} in the vault.`
      )
    );
  }

  return draft;
}
