import { omission, orderedTree, safeFileStem, type ExportResult, type ExportSource } from './exportSupport';
import { BUREAU_FORMAT, BUREAU_FORMAT_VERSION } from '../import/BureauImporter';

/**
 * Bureau's own interchange format — the only lossless export for Bureau concepts (all four
 * protocols, protocol options, per-request settings, and script source).
 *
 * Secrets are still omitted: an export is a plain file, and there is no password-based
 * encryption design yet. Secret *variables* keep their name and secret flag so the user can
 * re-bind them, but never a value.
 */
export function exportBureau(source: ExportSource, rootId: string | null): ExportResult {
  const omissions: ReturnType<typeof omission>[] = [];
  const ordered = orderedTree(source.nodes, rootId);

  const nodes = ordered.map((node) => {
    const request = node.requestId ? source.requests.get(node.requestId) : undefined;
    return {
      tempId: node.collectionId,
      // The export root is re-parented to null so it can be imported anywhere.
      parentTempId: node.parentId === rootId ? null : node.parentId,
      kind: node.kind,
      name: node.name,
      request:
        node.kind === 'request' && request
          ? {
              protocol: request.protocol,
              urlTemplate: request.urlTemplate,
              method: request.method,
              query: request.query,
              headers: request.headers,
              auth: request.auth,
              body: request.body,
              protocolOptions: stripLocalReferences(request.protocolOptions),
              settings: request.settings,
              scripts: request.scripts,
            }
          : undefined,
    };
  });

  let secretVariables = 0;
  const environments = source.environments.map((environment) => ({
    name: environment.name,
    variables: environment.variables.map((variable) => {
      if (variable.secret) secretVariables += 1;
      return {
        name: variable.name,
        value: variable.secret ? undefined : variable.value,
        enabled: variable.enabled,
        secret: variable.secret,
      };
    }),
  }));

  if (secretVariables > 0) {
    omissions.push(
      omission(
        'secrets-omitted',
        `${secretVariables} secret variable${secretVariables === 1 ? '' : 's'} exported without ${
          secretVariables === 1 ? 'its value' : 'their values'
        }. Bureau exports never contain secrets.`
      )
    );
  }
  if (nodes.some((node) => node.request?.auth.kind === 'oauth2')) {
    omissions.push(
      omission('oauth-omitted', 'OAuth profiles and their tokens were not exported; recreate them after importing.')
    );
  }
  if (nodes.some((node) => node.request?.scripts.preRequest ?? node.request?.scripts.postResponse)) {
    omissions.push(
      omission('scripts-disabled-on-import', 'Script source is included, but importing always leaves scripts disabled.')
    );
  }

  const document = {
    format: BUREAU_FORMAT,
    version: BUREAU_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: { name: source.workspaceName },
    nodes,
    environments,
    secretPolicy: 'omitted' as const,
  };

  return {
    content: JSON.stringify(document, null, 2),
    omissions,
    suggestedFileName: `${safeFileStem(source.workspaceName, 'workspace')}.bureau-api.json`,
  };
}

/**
 * Drops references that only mean something in the exporting installation — a TLS profile id
 * would otherwise point at nothing after import.
 */
function stripLocalReferences<T extends { tlsProfileId?: string }>(options: T): Omit<T, 'tlsProfileId'> {
  const { tlsProfileId: _dropped, ...rest } = options;
  return rest;
}
