import type { ApiRequestDefinition } from '@shared/contracts/apiWorkbench';
import {
  noteUnsupported,
  omission,
  redactAuthForExport,
  safeFileStem,
  type ExportResult,
} from './exportSupport';

/**
 * Quotes an argument for a POSIX shell using single quotes.
 *
 * Single quotes are chosen deliberately: nothing inside them is expanded, so a URL or JSON body
 * containing `$`, backticks, or `!` stays literal. The only character needing care is the single
 * quote itself, which is closed, escaped, and reopened.
 */
export function shellQuote(value: string): string {
  if (value === '') return "''";
  // Unreserved characters can be emitted bare, which keeps common commands readable.
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Renders one request as a readable cURL command.
 *
 * Line continuations use a trailing backslash, which is POSIX. On PowerShell the caller is
 * warned rather than silently emitting a different dialect, because a half-translated command
 * is worse than one the user knowingly adapts.
 */
export function exportCurl(request: ApiRequestDefinition): ExportResult {
  const omissions = noteUnsupported(request, 'curl');
  if (request.protocol === 'websocket' || request.protocol === 'sse') {
    return {
      content: '',
      omissions,
      suggestedFileName: `${safeFileStem(request.name, 'request')}.sh`,
    };
  }

  // Each entry is one argument group; continuations are added once when joining.
  const lines: string[] = [];
  const url = buildUrl(request);
  const method = request.protocol === 'graphql' ? 'POST' : request.method.toUpperCase();

  lines.push(`curl --request ${method}`);
  lines.push(`--url ${shellQuote(url)}`);

  const { headers: authHeaders, notes } = redactAuthForExport(request);
  omissions.push(...notes);

  for (const header of request.headers) {
    if (!header.enabled || !header.name) continue;
    lines.push(`  --header ${shellQuote(`${header.name}: ${header.value}`)}`);
  }
  for (const header of authHeaders) {
    lines.push(`  --header ${shellQuote(`${header.name}: ${header.value}`)}`);
  }

  const body = renderBody(request);
  if (body.contentType && !hasHeader(request, 'content-type')) {
    lines.push(`  --header ${shellQuote(`Content-Type: ${body.contentType}`)}`);
  }
  for (const argument of body.arguments) lines.push(`  ${argument}`);
  if (body.note) omissions.push(body.note);

  if (request.settings.followRedirects) lines.push('  --location');
  if (request.settings.maxRedirects !== undefined) {
    lines.push(`  --max-redirs ${request.settings.maxRedirects}`);
  }
  if (request.settings.timeoutMs !== undefined) {
    lines.push(`  --max-time ${Math.round(request.settings.timeoutMs / 1000)}`);
  }

  // Join with continuations, making sure only the final line has no trailing backslash.
  const body_ = lines
    .map((line, index) => (index === 0 ? line : line))
    .join('\n')
    .replace(/\\\n/g, '\\\n');
  const joined = lines
    .map((line, index) => (index === lines.length - 1 ? line.replace(/ \\$/, '') : line.endsWith('\\') ? line : `${line} \\`))
    .join('\n');
  void body_;

  omissions.push(
    omission(
      'shell-dialect',
      'The command uses POSIX quoting (bash, zsh, Git Bash). PowerShell and cmd.exe need different quoting.'
    )
  );

  return {
    content: joined,
    omissions,
    suggestedFileName: `${safeFileStem(request.name, 'request')}.sh`,
  };
}

function hasHeader(request: ApiRequestDefinition, name: string): boolean {
  return request.headers.some(
    (header) => header.enabled && header.name.toLowerCase() === name.toLowerCase()
  );
}

function buildUrl(request: ApiRequestDefinition): string {
  const enabled = request.query.filter((param) => param.enabled && param.name);
  if (enabled.length === 0) return request.urlTemplate;

  // Built textually rather than through `URL`, so `{{templates}}` survive unencoded.
  const separator = request.urlTemplate.includes('?') ? '&' : '?';
  const query = enabled
    .map((param) => `${encodeTemplateAware(param.name)}=${encodeTemplateAware(param.value)}`)
    .join('&');
  return `${request.urlTemplate}${separator}${query}`;
}

/** Percent-encodes a value while leaving `{{var}}` placeholders intact. */
function encodeTemplateAware(value: string): string {
  return value
    .split(/(\{\{[^}]+\}\})/g)
    .map((part) => (part.startsWith('{{') ? part : encodeURIComponent(part)))
    .join('');
}

function renderBody(request: ApiRequestDefinition): {
  arguments: string[];
  contentType?: string;
  note?: ReturnType<typeof omission>;
} {
  if (request.protocol === 'graphql') {
    const graphql = request.protocolOptions.graphql;
    const payload = JSON.stringify({
      query: graphql?.query ?? '',
      variables: safeParse(graphql?.variables ?? '{}'),
      ...(graphql?.operationName ? { operationName: graphql.operationName } : {}),
    });
    return { arguments: [`--data ${shellQuote(payload)}`], contentType: 'application/json' };
  }

  const body = request.body;
  switch (body.kind) {
    case 'none':
      return { arguments: [] };
    case 'json':
      return { arguments: [`--data ${shellQuote(body.text)}`], contentType: 'application/json' };
    case 'xml':
      return { arguments: [`--data ${shellQuote(body.text)}`], contentType: 'application/xml' };
    case 'html':
      return { arguments: [`--data ${shellQuote(body.text)}`], contentType: 'text/html' };
    case 'text':
      return {
        arguments: [`--data ${shellQuote(body.text)}`],
        contentType: body.contentType ?? 'text/plain',
      };
    case 'form-urlencoded':
      return {
        arguments: body.fields
          .filter((field) => field.enabled && field.name)
          .map((field) => `--data-urlencode ${shellQuote(`${field.name}=${field.value}`)}`),
      };
    case 'multipart':
      return {
        arguments: body.fields
          .filter((field) => field.enabled && field.name)
          .map((field) => `--form ${shellQuote(`${field.name}=${field.value}`)}`),
      };
    case 'binary':
      return {
        arguments: [],
        note: omission(
          'binary-body-omitted',
          `The binary body of \`${request.name}\` was not exported; add \`--data-binary @file\` yourself.`
        ),
      };
  }
}

function safeParse(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text.trim() || '{}');
    return value;
  } catch {
    return {};
  }
}
