import type { ApiResponsePreview } from '@shared/contracts/apiWorkbench';
import { omission, safeFileStem, type ExportResult } from './exportSupport';

/** One history entry, already loaded by the caller. */
export type HarHistoryEntry = {
  historyId: string;
  name: string;
  method: string;
  url: string;
  createdAt: string;
  response: ApiResponsePreview | null;
};

/**
 * Headers redacted by default. A HAR is routinely attached to bug reports and support tickets,
 * so credentials are replaced with a marker rather than exported and hoped about.
 */
const REDACTED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

const REDACTION = '[redacted by Bureau]';

/**
 * Exports selected history as HAR 1.2.
 *
 * `redactSecrets` defaults to true and the caller surfaces a mandatory privacy warning; the
 * unredacted form exists only because a HAR with every credential stripped is sometimes not
 * reproducible, and that has to be a deliberate, informed choice.
 */
export function exportHar(
  entries: HarHistoryEntry[],
  workspaceName: string,
  options: { redactSecrets: boolean }
): ExportResult {
  const omissions: ReturnType<typeof omission>[] = [];
  let redactedCount = 0;
  let missingResponses = 0;

  const harEntries = entries.map((entry) => {
    const response = entry.response;
    if (!response) missingResponses += 1;

    const requestHeaders: Array<{ name: string; value: string }> = [];
    const responseHeaders = (response?.headers ?? []).map((header) => {
      if (options.redactSecrets && REDACTED_HEADERS.has(header.name.toLowerCase())) {
        redactedCount += 1;
        return { name: header.name, value: REDACTION };
      }
      return { name: header.name, value: header.value };
    });

    let queryString: Array<{ name: string; value: string }> = [];
    try {
      const parsed = new URL(entry.url);
      queryString = [...parsed.searchParams].map(([name, value]) => ({ name, value }));
    } catch {
      queryString = [];
    }

    const timings = response?.timings;
    // HAR requires every timing key; -1 means "not applicable/unknown".
    const harTimings = {
      blocked: -1,
      dns: timings?.dnsMs ?? -1,
      connect: timings?.connectMs ?? -1,
      send: 0,
      wait: timings?.firstByteMs ?? -1,
      receive: timings?.downloadMs ?? -1,
      ssl: timings?.tlsMs ?? -1,
    };

    const bodyText = response?.bodyIsBinary ? '' : (response?.bodyText ?? '');

    return {
      startedDateTime: entry.createdAt,
      time: timings?.totalMs ?? 0,
      request: {
        method: entry.method,
        url: entry.url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: requestHeaders,
        queryString,
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: response?.status ?? 0,
        statusText: response?.statusText ?? '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: responseHeaders,
        content: {
          size: response?.decodedBytes ?? 0,
          mimeType: response?.contentType ?? '',
          text: bodyText,
        },
        redirectURL: response?.redirects.at(-1)?.url ?? '',
        headersSize: -1,
        bodySize: response?.wireBytes ?? -1,
      },
      cache: {},
      timings: harTimings,
    };
  });

  omissions.push(
    omission(
      'har-privacy',
      options.redactSecrets
        ? 'Authorization, cookie, and API-key headers were replaced with a redaction marker. Response bodies are still included and may contain personal data.'
        : 'This export is UNREDACTED. It contains live credentials and response bodies exactly as captured.'
    )
  );
  omissions.push(
    omission(
      'request-headers-omitted',
      'Bureau stores response headers in history, not the exact request headers that were sent, so request headers are exported empty.'
    )
  );
  if (redactedCount > 0) {
    omissions.push(
      omission('headers-redacted', `${redactedCount} credential header${redactedCount === 1 ? '' : 's'} redacted.`)
    );
  }
  if (missingResponses > 0) {
    omissions.push(
      omission(
        'body-unavailable',
        `${missingResponses} entr${missingResponses === 1 ? 'y' : 'ies'} had no stored response and ${
          missingResponses === 1 ? 'was' : 'were'
        } exported as a bare request.`
      )
    );
  }

  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Bureau', version: '1' },
      entries: harEntries,
    },
  };

  return {
    content: JSON.stringify(har, null, 2),
    omissions,
    suggestedFileName: `${safeFileStem(workspaceName, 'history')}.har`,
  };
}
