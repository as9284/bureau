import type { ApiBody, ApiKeyValue } from '@shared/contracts/apiWorkbench';
import {
  ImportError,
  draftRequest,
  keyValue,
  looksSecret,
  newDraft,
  note,
  pushNode,
  tempId,
  type DraftRequest,
  type ImportDraft,
  type ImportLimits,
} from './importSupport';

/**
 * Shell metacharacters that would mean something other than a literal argument. A cURL command
 * is untrusted text — Bureau parses it, and never hands it to a shell — so anything implying
 * command substitution, chaining, or redirection is rejected outright rather than ignored,
 * because silently dropping `$(…)` would change what the user believes the request does.
 */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\$\(/, label: 'command substitution `$(…)`' },
  // `${…}` is unambiguous. A bare `$VAR` is deliberately allowed: `$` appears legitimately in
  // quoted JSON bodies (Mongo operators, JSONPath), so rejecting it would break more real
  // commands than it would protect.
  { re: /\$\{/, label: 'parameter expansion `${…}`' },
  { re: /`/, label: 'backtick command substitution' },
  { re: /(^|[^|])\|(?!\|)/, label: 'a pipe' },
  { re: /\|\|/, label: 'a shell `||` chain' },
  { re: /&&/, label: 'a shell `&&` chain' },
  { re: /(^|\s)>{1,2}(\s|$)/, label: 'output redirection' },
  { re: /(^|\s)<(\s|$)/, label: 'input redirection' },
  { re: /;\s*\w/, label: 'a command separator' },
];

type Token = { value: string };

/**
 * Splits a command line into arguments using POSIX-ish quoting rules: single quotes are fully
 * literal, double quotes process backslash escapes, and a trailing backslash continues the line
 * (which cURL examples use heavily). No shell is ever involved.
 */
export function tokenizeCommand(input: string): Token[] {
  const tokens: Token[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;

  const flush = (): void => {
    if (started) {
      tokens.push({ value: current });
      current = '';
      started = false;
    }
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      // Only double quotes process backslash escapes; single quotes are fully literal.
      if (char === '\\' && quote === '"' && i + 1 < input.length) {
        i += 1;
        current += input[i];
        started = true;
        continue;
      }
      current += char;
      started = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === '\\') {
      // A trailing backslash is a line continuation, which cURL examples use heavily.
      const next = input[i + 1];
      if (next === '\n' || next === '\r' || next === undefined) {
        i += 1;
        if (next === '\r' && input[i + 1] === '\n') i += 1;
        continue;
      }
      i += 1;
      current += input[i];
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
    started = true;
  }

  if (quote) throw new ImportError('API_IMPORT_INVALID', 'The command has an unterminated quote.');
  flush();
  return tokens;
}

/** Options that take a value we deliberately accept but do not model. */
const IGNORED_WITH_VALUE = new Set([
  '--connect-timeout',
  '--retry',
  '--retry-delay',
  '--limit-rate',
  '-w',
  '--write-out',
  '-o',
  '--output',
]);

const IGNORED_FLAGS = new Set([
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-v',
  '--verbose',
  '--fail',
  '-f',
  '--no-progress-meter',
  '-#',
  '--progress-bar',
]);

export function importCurl(source: string, limits: ImportLimits, sourceLabel: string): ImportDraft {
  const draft = newDraft('curl', sourceLabel);

  for (const forbidden of FORBIDDEN_PATTERNS) {
    if (forbidden.re.test(source)) {
      throw new ImportError(
        'API_IMPORT_INVALID',
        `The command contains ${forbidden.label}, which Bureau will not interpret. Remove it and import a plain cURL command.`
      );
    }
  }
  const tokens = tokenizeCommand(source);
  if (tokens.length === 0) throw new ImportError('API_IMPORT_INVALID', 'The command is empty.');

  const [first, ...rest] = tokens;
  if (!/^curl(\.exe)?$/i.test(first.value)) {
    throw new ImportError('API_IMPORT_INVALID', 'The command must start with `curl`.');
  }

  const request = draftRequest({ name: 'Imported request' });
  const headers: ApiKeyValue[] = [];
  const formFields: ApiKeyValue[] = [];
  const urlEncodedFields: ApiKeyValue[] = [];
  const dataParts: string[] = [];
  const secretCandidates: string[] = [];

  let url = '';
  let explicitMethod: string | null = null;
  let useGet = false;
  let isMultipart = false;
  let sawDataUrlEncode = false;

  const takeValue = (index: number, flag: string): { value: string; next: number } => {
    const token = rest[index + 1];
    if (!token) throw new ImportError('API_IMPORT_INVALID', `\`${flag}\` is missing its value.`);
    return { value: token.value, next: index + 1 };
  };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    const arg = token.value;

    if (!arg.startsWith('-')) {
      if (!url) url = arg;
      else draft.warnings.push(note('multiple-urls', `Ignored extra URL \`${arg}\`.`));
      continue;
    }

    // Support `--header=value` as well as `--header value`.
    let flag = arg;
    let inlineValue: string | null = null;
    const equals = arg.indexOf('=');
    if (arg.startsWith('--') && equals > 2) {
      flag = arg.slice(0, equals);
      inlineValue = arg.slice(equals + 1);
    }

    const valueFor = (): string => {
      if (inlineValue !== null) return inlineValue;
      const taken = takeValue(i, flag);
      i = taken.next;
      return taken.value;
    };

    switch (flag) {
      case '-X':
      case '--request':
        explicitMethod = valueFor().toUpperCase();
        break;

      case '-H':
      case '--header': {
        const raw = valueFor();
        const colon = raw.indexOf(':');
        if (colon <= 0) {
          draft.warnings.push(note('bad-header', `Ignored malformed header \`${raw}\`.`));
          break;
        }
        const name = raw.slice(0, colon).trim();
        const value = raw.slice(colon + 1).trim();
        headers.push(keyValue(name, value));
        if (looksSecret(name)) secretCandidates.push(name);
        break;
      }

      case '-u':
      case '--user': {
        const raw = valueFor();
        const colon = raw.indexOf(':');
        const username = colon === -1 ? raw : raw.slice(0, colon);
        // The password is dropped, not persisted: it would otherwise land on disk in plaintext.
        request.auth = { kind: 'basic', usernameTemplate: username };
        draft.warnings.push(
          note(
            'credential-dropped',
            'The password from `-u` was not imported. Add it as a secret and select it on the Auth tab.'
          )
        );
        break;
      }

      case '-b':
      case '--cookie': {
        const raw = valueFor();
        headers.push(keyValue('Cookie', raw));
        secretCandidates.push('Cookie');
        break;
      }

      case '-A':
      case '--user-agent':
        headers.push(keyValue('User-Agent', valueFor()));
        break;

      case '-e':
      case '--referer':
        headers.push(keyValue('Referer', valueFor()));
        break;

      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-ascii':
      case '--data-binary': {
        const raw = valueFor();
        if (raw.startsWith('@')) {
          draft.warnings.push(
            note(
              'file-body-skipped',
              `\`${flag} @file\` was not imported — Bureau does not read files named by an imported command.`
            )
          );
          break;
        }
        dataParts.push(raw);
        break;
      }

      case '--data-urlencode': {
        const raw = valueFor();
        sawDataUrlEncode = true;
        const eq = raw.indexOf('=');
        if (eq === -1) urlEncodedFields.push(keyValue('', raw));
        else urlEncodedFields.push(keyValue(raw.slice(0, eq), raw.slice(eq + 1)));
        break;
      }

      case '-F':
      case '--form':
      case '--form-string': {
        const raw = valueFor();
        isMultipart = true;
        const eq = raw.indexOf('=');
        if (eq === -1) {
          draft.warnings.push(note('bad-form', `Ignored malformed form field \`${raw}\`.`));
          break;
        }
        const name = raw.slice(0, eq);
        const value = raw.slice(eq + 1);
        if (value.startsWith('@') || value.startsWith('<')) {
          draft.warnings.push(
            note('file-upload-skipped', `Form field \`${name}\` referenced a file and was imported empty.`)
          );
          formFields.push(keyValue(name, ''));
          break;
        }
        formFields.push(keyValue(name, value));
        break;
      }

      case '-G':
      case '--get':
        useGet = true;
        break;

      case '-I':
      case '--head':
        explicitMethod = 'HEAD';
        break;

      case '-L':
      case '--location':
        request.settings = { ...request.settings, followRedirects: true };
        break;

      case '--max-redirs': {
        const parsed = Number.parseInt(valueFor(), 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          request.settings = { ...request.settings, maxRedirects: Math.min(parsed, 50) };
        }
        break;
      }

      case '-m':
      case '--max-time': {
        const seconds = Number.parseFloat(valueFor());
        if (Number.isFinite(seconds) && seconds > 0) {
          const ms = Math.round(seconds * 1000);
          request.settings = { ...request.settings, timeoutMs: Math.min(Math.max(ms, 1000), 600_000) };
        }
        break;
      }

      case '-k':
      case '--insecure':
        // Never silently weakened: TLS exceptions are an explicit, host-scoped user decision.
        draft.warnings.push(
          note(
            'insecure-ignored',
            '`--insecure` was not applied. Create a host-scoped TLS profile if you need to accept an invalid certificate.'
          )
        );
        break;

      case '-x':
      case '--proxy':
        valueFor();
        draft.warnings.push(
          note('proxy-ignored', 'The `--proxy` option was not imported. Proxy profiles arrive in a later phase.')
        );
        break;

      case '--compressed':
        headers.push(keyValue('Accept-Encoding', 'gzip, deflate, br'));
        break;

      case '--url':
        url = valueFor();
        break;

      default: {
        if (IGNORED_FLAGS.has(flag)) break;
        if (IGNORED_WITH_VALUE.has(flag)) {
          valueFor();
          break;
        }
        draft.warnings.push(note('unsupported-option', `Ignored unsupported option \`${flag}\`.`));
        if (inlineValue === null && rest[i + 1] && !rest[i + 1].value.startsWith('-')) {
          // Best-effort: skip a value that clearly belongs to the unknown flag.
          i += 1;
        }
      }
    }
  }

  if (!url) throw new ImportError('API_IMPORT_INVALID', 'The command has no URL.');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new ImportError('API_IMPORT_INVALID', `\`${url}\` is not a valid absolute URL.`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ImportError('API_IMPORT_INVALID', 'Only http and https URLs can be imported.');
  }

  // Query parameters become editable rows rather than staying baked into the URL.
  const query: ApiKeyValue[] = [];
  for (const [name, value] of parsedUrl.searchParams) query.push(keyValue(name, value));
  parsedUrl.search = '';

  const body = buildBody({
    dataParts,
    formFields,
    urlEncodedFields,
    isMultipart,
    sawDataUrlEncode,
    useGet,
    headers,
    query,
  });

  const hasPayload = body.kind !== 'none';
  request.method = explicitMethod ?? (hasPayload && !useGet ? 'POST' : 'GET');
  request.urlTemplate = parsedUrl.toString();
  request.query = query;
  request.headers = headers;
  request.body = body;
  request.name = deriveName(parsedUrl, request.method);

  if (secretCandidates.length > 0) {
    draft.warnings.push(
      note(
        'secret-header',
        `Imported header${secretCandidates.length === 1 ? '' : 's'} ${secretCandidates.join(', ')} may carry credentials. Move ${
          secretCandidates.length === 1 ? 'it' : 'them'
        } into the secret vault.`
      )
    );
  }

  const id = tempId();
  pushNode(draft, limits, {
    tempId: id,
    parentTempId: null,
    kind: 'request',
    name: request.name,
    protocol: 'http',
    method: request.method,
    url: request.urlTemplate,
  });
  draft.requests.set(id, request);
  return draft;
}

function buildBody(input: {
  dataParts: string[];
  formFields: ApiKeyValue[];
  urlEncodedFields: ApiKeyValue[];
  isMultipart: boolean;
  sawDataUrlEncode: boolean;
  useGet: boolean;
  headers: ApiKeyValue[];
  query: ApiKeyValue[];
}): ApiBody {
  const contentType = input.headers
    .find((header) => header.name.toLowerCase() === 'content-type')
    ?.value.toLowerCase();

  if (input.isMultipart) return { kind: 'multipart', fields: input.formFields };

  if (input.sawDataUrlEncode) {
    // `-G` turns --data-urlencode into query parameters instead of a body.
    if (input.useGet) {
      for (const field of input.urlEncodedFields) input.query.push(field);
      return { kind: 'none' };
    }
    return { kind: 'form-urlencoded', fields: input.urlEncodedFields };
  }

  if (input.dataParts.length === 0) return { kind: 'none' };
  const joined = input.dataParts.join('&');

  if (input.useGet) {
    for (const pair of joined.split('&')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      input.query.push(keyValue(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1))));
    }
    return { kind: 'none' };
  }

  if (contentType?.includes('application/json')) return { kind: 'json', text: joined };
  if (contentType?.includes('application/xml') || contentType?.includes('text/xml')) {
    return { kind: 'xml', text: joined };
  }
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    const fields: ApiKeyValue[] = [];
    for (const pair of joined.split('&')) {
      const eq = pair.indexOf('=');
      if (eq === -1) {
        fields.push(keyValue(decodeURIComponent(pair), ''));
        continue;
      }
      fields.push(
        keyValue(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1)))
      );
    }
    return { kind: 'form-urlencoded', fields };
  }

  // cURL defaults to form encoding, but a JSON-looking payload is far more likely intended as JSON.
  const trimmed = joined.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return { kind: 'json', text: joined };
  if (!contentType) return { kind: 'text', text: joined };
  return { kind: 'text', text: joined, contentType };
}

function deriveName(url: URL, method: string): string {
  const segments = url.pathname.split('/').filter(Boolean);
  const last = segments.at(-1);
  return last ? `${method} /${last}` : `${method} ${url.hostname}`;
}

export type { DraftRequest };
