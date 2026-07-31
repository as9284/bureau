import type { ApiBody, ApiKeyValue } from '@shared/contracts/apiWorkbench';
import {
  ImportError,
  asString,
  draftRequest,
  isRecord,
  keyValue,
  looksSecret,
  newDraft,
  note,
  parseStructured,
  pushNode,
  tempId,
  type ImportDraft,
  type ImportLimits,
} from './importSupport';

/** Headers a HAR capture records but that describe the capture, not the request. */
const CAPTURE_ONLY_HEADERS = new Set([
  ':method',
  ':path',
  ':scheme',
  ':authority',
  'content-length',
  'host',
  'connection',
]);

/**
 * HAR 1.2 importer.
 *
 * A HAR is a recording of real traffic, so it is the most privacy-sensitive format Bureau
 * accepts: it routinely contains live session cookies and Authorization headers. Those are
 * imported *disabled* and flagged, so a captured credential is never replayed by accident.
 */
export function importHar(source: string, limits: ImportLimits, sourceLabel: string): ImportDraft {
  const document = parseStructured(source, limits);
  if (!isRecord(document) || !isRecord(document.log)) {
    throw new ImportError('API_IMPORT_INVALID', 'The file does not look like a HAR (missing `log`).');
  }
  const log = document.log;
  const version = asString(log.version, '1.2');
  if (!version.startsWith('1.')) {
    throw new ImportError('API_IMPORT_INVALID', `HAR version \`${version}\` is not supported.`);
  }
  if (!Array.isArray(log.entries)) {
    throw new ImportError('API_IMPORT_INVALID', 'The HAR has no `log.entries` array.');
  }

  const draft = newDraft('har', sourceLabel);
  draft.warnings.push(
    note(
      'har-privacy',
      'HAR captures record real traffic. Review the imported requests for cookies, tokens, and personal data before sharing this workspace.'
    )
  );

  const rootId = tempId();
  pushNode(draft, limits, {
    tempId: rootId,
    parentTempId: null,
    kind: 'folder',
    name: asString(isRecord(log.creator) ? log.creator.name : '', 'HAR capture'),
  });

  let disabledCredentials = 0;
  let skippedNonHttp = 0;

  for (const rawEntry of log.entries) {
    if (!isRecord(rawEntry)) continue;
    const requestNode = isRecord(rawEntry.request) ? rawEntry.request : null;
    if (!requestNode) continue;

    const rawUrl = asString(requestNode.url);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      continue;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      skippedNonHttp += 1;
      continue;
    }

    const method = asString(requestNode.method, 'GET').toUpperCase();

    // Duplicate headers and query parameters are preserved — a HAR is evidence, not a summary.
    const headers: ApiKeyValue[] = [];
    if (Array.isArray(requestNode.headers)) {
      for (const rawHeader of requestNode.headers) {
        if (!isRecord(rawHeader)) continue;
        const name = asString(rawHeader.name);
        if (!name || CAPTURE_ONLY_HEADERS.has(name.toLowerCase())) continue;
        const sensitive = looksSecret(name);
        if (sensitive) disabledCredentials += 1;
        headers.push(keyValue(name, asString(rawHeader.value), !sensitive));
      }
    }

    const query: ApiKeyValue[] = [];
    if (Array.isArray(requestNode.queryString)) {
      for (const rawQuery of requestNode.queryString) {
        if (!isRecord(rawQuery)) continue;
        const name = asString(rawQuery.name);
        if (!name) continue;
        query.push(keyValue(name, asString(rawQuery.value)));
      }
      parsedUrl.search = '';
    } else {
      for (const [name, value] of parsedUrl.searchParams) query.push(keyValue(name, value));
      parsedUrl.search = '';
    }

    const body = readPostData(rawEntry.request, draft, rawUrl);

    const name = `${method} ${parsedUrl.pathname || '/'}`;
    const request = draftRequest({
      name,
      method,
      urlTemplate: parsedUrl.toString(),
      query,
      headers,
      body,
      auth: { kind: 'none' },
    });

    const nodeId = tempId();
    if (
      !pushNode(draft, limits, {
        tempId: nodeId,
        parentTempId: rootId,
        kind: 'request',
        name,
        protocol: 'http',
        method,
        url: request.urlTemplate,
      })
    ) {
      return draft;
    }
    draft.requests.set(nodeId, request);
  }

  if (disabledCredentials > 0) {
    draft.warnings.push(
      note(
        'credential-disabled',
        `${disabledCredentials} captured credential header${disabledCredentials === 1 ? '' : 's'} (cookies, tokens) ${
          disabledCredentials === 1 ? 'was' : 'were'
        } imported disabled so ${disabledCredentials === 1 ? 'it is' : 'they are'} not replayed by accident.`
      )
    );
  }
  if (skippedNonHttp > 0) {
    draft.warnings.push(
      note('non-http-skipped', `${skippedNonHttp} non-HTTP entr${skippedNonHttp === 1 ? 'y was' : 'ies were'} skipped.`)
    );
  }
  if (draft.requests.size === 0) {
    draft.warnings.push(note('no-entries', 'The HAR contained no importable HTTP requests.'));
  }
  return draft;
}

function readPostData(request: unknown, draft: ImportDraft, where: string): ApiBody {
  if (!isRecord(request) || !isRecord(request.postData)) return { kind: 'none' };
  const postData = request.postData;
  const mimeType = asString(postData.mimeType).toLowerCase();

  if (Array.isArray(postData.params) && postData.params.length > 0) {
    const fields: ApiKeyValue[] = [];
    for (const rawParam of postData.params) {
      if (!isRecord(rawParam)) continue;
      const name = asString(rawParam.name);
      if (!name) continue;
      if (asString(rawParam.fileName)) {
        draft.warnings.push(
          note('file-upload-skipped', `A file upload in \`${where}\` was imported empty.`, where)
        );
        fields.push(keyValue(name, ''));
        continue;
      }
      fields.push(keyValue(name, asString(rawParam.value)));
    }
    return mimeType.includes('multipart')
      ? { kind: 'multipart', fields }
      : { kind: 'form-urlencoded', fields };
  }

  let text = asString(postData.text);
  if (!text) return { kind: 'none' };

  // HAR allows a base64 body via the `encoding` field.
  if (asString(postData.encoding).toLowerCase() === 'base64') {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      draft.warnings.push(
        note('base64-body-skipped', `A base64 body in \`${where}\` could not be decoded.`, where)
      );
      return { kind: 'none' };
    }
  }

  if (mimeType.includes('json')) return { kind: 'json', text };
  if (mimeType.includes('xml')) return { kind: 'xml', text };
  if (mimeType.includes('html')) return { kind: 'html', text };
  if (mimeType.includes('x-www-form-urlencoded')) {
    const fields: ApiKeyValue[] = [];
    for (const pair of text.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const name = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? '' : pair.slice(eq + 1);
      try {
        fields.push(keyValue(decodeURIComponent(name), decodeURIComponent(value)));
      } catch {
        fields.push(keyValue(name, value));
      }
    }
    return { kind: 'form-urlencoded', fields };
  }
  return { kind: 'text', text, contentType: mimeType || undefined };
}
