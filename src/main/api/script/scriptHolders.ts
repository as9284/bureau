import type {
  ApiCollectionNode,
  ApiRequestDefinition,
  ApiScriptHolder,
  ApiScriptLocation,
  ApiScriptPhase,
  ApiScripts,
} from '@shared/contracts/apiWorkbench';

/**
 * Which scripts run for a request, and in what order.
 *
 * A request inherits the scripts of every folder above it. Both phases run outermost-folder first,
 * so a collection-level setup script observes the same ordering as a collection-level teardown —
 * anything else would make a folder script's relationship to its children depend on the phase.
 *
 * Every holder is a separate sandbox job with its own limits. Variable writes accumulate across
 * holders, which is how a folder script hands a value to the requests beneath it.
 */

export type ScriptTree = {
  collections: ApiCollectionNode[];
};

/** Folder chain from the workspace root down to (and excluding) the request's own node. */
export function folderChain(
  file: ScriptTree,
  collectionId: string | null
): ApiCollectionNode[] {
  const chain: ApiCollectionNode[] = [];
  let currentId = collectionId;
  // Bounded by the collection depth; a corrupt parent cycle would otherwise spin here.
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const node = file.collections.find((entry) => entry.collectionId === currentId);
    if (!node) break;
    chain.unshift(node);
    currentId = node.parentId;
  }
  return chain;
}

export type ResolvedScript = {
  holder: ApiScriptHolder;
  source: string;
};

function sourceFor(scripts: ApiScripts | undefined, phase: ApiScriptPhase): string | undefined {
  if (!scripts?.enabled) return undefined;
  const source = phase === 'pre-request' ? scripts.preRequest : scripts.postResponse;
  if (!source || source.trim().length === 0) return undefined;
  return source;
}

/**
 * Resolves the scripts to run for one request and phase. `scripts.enabled` is checked here and
 * nowhere else, so a disabled — or imported and not yet approved — script simply never appears.
 */
export function scriptsForRequest(
  file: ScriptTree,
  request: ApiRequestDefinition,
  ownNode: ApiCollectionNode | undefined,
  phase: ApiScriptPhase
): ResolvedScript[] {
  const resolved: ResolvedScript[] = [];
  for (const folder of folderChain(file, ownNode?.parentId ?? null)) {
    const source = sourceFor(folder.scripts, phase);
    if (source) {
      resolved.push({
        holder: { kind: 'folder', id: folder.collectionId, name: folder.name },
        source,
      });
    }
  }
  const own = sourceFor(request.scripts, phase);
  if (own) {
    resolved.push({
      holder: { kind: 'request', id: request.requestId, name: request.name },
      source: own,
    });
  }
  return resolved;
}

/** Every script under a subtree, for the approval dialog. Enabling is never a blind toggle. */
export function scriptLocations(
  file: { collections: ApiCollectionNode[]; requests: ApiRequestDefinition[] },
  rootId: string | null
): ApiScriptLocation[] {
  const locations: ApiScriptLocation[] = [];
  const childrenOf = (parentId: string | null): ApiCollectionNode[] =>
    file.collections
      .filter((node) => node.parentId === parentId)
      .sort((a, b) => a.order - b.order);

  const visit = (node: ApiCollectionNode, path: string[]): void => {
    const nextPath = [...path, node.name];
    if (node.kind === 'folder') {
      collect(node.scripts, { kind: 'folder', id: node.collectionId, name: node.name }, nextPath);
      for (const child of childrenOf(node.collectionId)) visit(child, nextPath);
      return;
    }
    const request = file.requests.find((entry) => entry.requestId === node.requestId);
    if (!request) return;
    collect(request.scripts, { kind: 'request', id: request.requestId, name: request.name }, nextPath);
  };

  function collect(
    scripts: ApiScripts | undefined,
    holder: ApiScriptHolder,
    path: string[]
  ): void {
    if (!scripts) return;
    const phases: ApiScriptPhase[] = [];
    if (scripts.preRequest?.trim()) phases.push('pre-request');
    if (scripts.postResponse?.trim()) phases.push('post-response');
    if (phases.length === 0) return;
    locations.push({
      holder,
      phases,
      enabled: scripts.enabled === true,
      origin: scripts.origin === 'imported' ? 'imported' : 'authored',
      path: path.join(' / '),
    });
  }

  if (rootId === null) {
    for (const node of childrenOf(null)) visit(node, []);
    return locations;
  }
  const root = file.collections.find((node) => node.collectionId === rootId);
  if (root) visit(root, []);
  return locations;
}
