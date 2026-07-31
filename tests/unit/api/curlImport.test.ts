import { describe, expect, it } from 'vitest';
import { importCurl, tokenizeCommand } from '@main/api/import/CurlImporter';
import { exportCurl, shellQuote } from '@main/api/export/CurlExporter';
import type { ApiRequestDefinition } from '@shared/contracts/apiWorkbench';

const LIMITS = { maxBytes: 1_000_000, maxNodes: 100, maxDepth: 32 };

function first(source: string) {
  const draft = importCurl(source, LIMITS, 'test');
  const node = draft.nodes[0];
  return { draft, node, request: draft.requests.get(node.tempId)! };
}

describe('cURL tokenizer', () => {
  it('keeps quoted whitespace together', () => {
    expect(tokenizeCommand(`curl -H "X-A: b c" url`).map((t) => t.value)).toEqual([
      'curl',
      '-H',
      'X-A: b c',
      'url',
    ]);
  });

  it('treats single quotes as fully literal', () => {
    expect(tokenizeCommand(`curl -d '{"a":"$b"}'`).map((t) => t.value)).toEqual([
      'curl',
      '-d',
      '{"a":"$b"}',
    ]);
  });

  it('joins backslash line continuations', () => {
    const tokens = tokenizeCommand('curl \\\n  -X POST \\\n  https://x.test');
    expect(tokens.map((t) => t.value)).toEqual(['curl', '-X', 'POST', 'https://x.test']);
  });

  it('rejects an unterminated quote', () => {
    expect(() => tokenizeCommand(`curl -d "oops`)).toThrow(/unterminated quote/i);
  });
});

describe('cURL import — shell safety', () => {
  const hostile = [
    ['command substitution', 'curl https://x.test -H "X: $(whoami)"'],
    ['backticks', 'curl https://x.test -H "X: `id`"'],
    ['parameter expansion', 'curl https://x.test/${HOME}'],
    ['a pipe', 'curl https://x.test | sh'],
    ['an && chain', 'curl https://x.test && rm -rf /'],
    ['output redirection', 'curl https://x.test > /etc/passwd'],
    ['a command separator', 'curl https://x.test ; reboot'],
  ] as const;

  for (const [label, command] of hostile) {
    it(`refuses ${label} rather than silently dropping it`, () => {
      expect(() => importCurl(command, LIMITS, 'test')).toThrow(/will not interpret/i);
    });
  }

  it('refuses a command that is not curl', () => {
    expect(() => importCurl('wget https://x.test', LIMITS, 'test')).toThrow(/must start with/i);
  });

  it('refuses a non-http scheme', () => {
    expect(() => importCurl('curl file:///etc/passwd', LIMITS, 'test')).toThrow(/http and https/i);
  });

  it('refuses a command with no URL', () => {
    expect(() => importCurl('curl -X POST', LIMITS, 'test')).toThrow(/no URL/i);
  });
});

describe('cURL import — request shape', () => {
  it('imports method, headers, and a JSON body', () => {
    const { request } = first(
      `curl -X POST https://api.test/v1/users -H 'Content-Type: application/json' -d '{"name":"ada"}'`
    );
    expect(request.method).toBe('POST');
    expect(request.urlTemplate).toBe('https://api.test/v1/users');
    expect(request.headers.map((h) => [h.name, h.value])).toContainEqual([
      'Content-Type',
      'application/json',
    ]);
    expect(request.body).toEqual({ kind: 'json', text: '{"name":"ada"}' });
  });

  it('infers POST when a body is present without -X', () => {
    const { request } = first(`curl https://api.test/x -d 'a=1'`);
    expect(request.method).toBe('POST');
  });

  it('splits the query string into editable rows', () => {
    const { request } = first('curl "https://api.test/search?q=cats&page=2"');
    expect(request.urlTemplate).toBe('https://api.test/search');
    expect(request.query.map((p) => [p.name, p.value])).toEqual([
      ['q', 'cats'],
      ['page', '2'],
    ]);
  });

  it('does not import the password from -u', () => {
    const { draft, request } = first('curl https://api.test/x -u ada:hunter2');
    expect(request.auth).toEqual({ kind: 'basic', usernameTemplate: 'ada' });
    // The secret must not survive anywhere in the draft.
    expect(JSON.stringify(draft)).not.toContain('hunter2');
    expect(draft.warnings.some((w) => w.code === 'credential-dropped')).toBe(true);
  });

  it('warns rather than silently applying --insecure', () => {
    const { draft } = first('curl https://api.test/x -k');
    expect(draft.warnings.some((w) => w.code === 'insecure-ignored')).toBe(true);
  });

  it('does not read a file named by @', () => {
    const { draft, request } = first('curl https://api.test/x -d @/etc/passwd');
    expect(request.body.kind).toBe('none');
    expect(draft.warnings.some((w) => w.code === 'file-body-skipped')).toBe(true);
  });

  it('imports multipart form fields', () => {
    const { request } = first(`curl https://api.test/upload -F 'name=ada' -F 'role=eng'`);
    expect(request.body).toMatchObject({ kind: 'multipart' });
    if (request.body.kind === 'multipart') {
      expect(request.body.fields.map((f) => [f.name, f.value])).toEqual([
        ['name', 'ada'],
        ['role', 'eng'],
      ]);
    }
  });

  it('turns -G data into query parameters', () => {
    const { request } = first(`curl -G https://api.test/x --data-urlencode 'q=a b'`);
    expect(request.body.kind).toBe('none');
    expect(request.query.map((p) => [p.name, p.value])).toContainEqual(['q', 'a b']);
  });

  it('maps timeout and redirect options', () => {
    const { request } = first('curl https://api.test/x -L --max-redirs 3 -m 12');
    expect(request.settings.followRedirects).toBe(true);
    expect(request.settings.maxRedirects).toBe(3);
    expect(request.settings.timeoutMs).toBe(12_000);
  });

  it('flags a credential-looking header without dropping it', () => {
    const { draft, request } = first(`curl https://api.test/x -H 'Authorization: Bearer abc'`);
    expect(request.headers[0].value).toBe('Bearer abc');
    expect(draft.warnings.some((w) => w.code === 'secret-header')).toBe(true);
  });
});

function definition(overrides: Partial<ApiRequestDefinition> = {}): ApiRequestDefinition {
  return {
    requestId: 'r1',
    workspaceId: 'w1',
    name: 'Create user',
    protocol: 'http',
    urlTemplate: 'https://api.test/v1/users',
    method: 'POST',
    query: [],
    headers: [],
    auth: { kind: 'none' },
    body: { kind: 'none' },
    protocolOptions: {},
    scripts: {},
    settings: {},
    variables: [],
    revision: 1,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('cURL export', () => {
  it('quotes values so nothing is expanded by a shell', () => {
    expect(shellQuote(`{"a":"$HOME"}`)).toBe(`'{"a":"$HOME"}'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
    expect(shellQuote('https://api.test/x')).toBe('https://api.test/x');
  });

  it('renders method, headers, and body', () => {
    const result = exportCurl(
      definition({
        headers: [{ id: 'h1', name: 'Accept', value: 'application/json', enabled: true }],
        body: { kind: 'json', text: '{"name":"ada"}' },
      })
    );
    expect(result.content).toContain('curl --request POST');
    expect(result.content).toContain("--url https://api.test/v1/users");
    expect(result.content).toContain("--header 'Accept: application/json'");
    expect(result.content).toContain(`--data '{"name":"ada"}'`);
  });

  it('never emits a secret, only a placeholder', () => {
    const result = exportCurl(definition({ auth: { kind: 'bearer', tokenSecretId: 'sec-1' } }));
    expect(result.content).toContain('{{bearer_token}}');
    expect(result.content).not.toContain('sec-1');
    expect(result.omissions.some((o) => o.code === 'secret-placeholder')).toBe(true);
  });

  it('omits a stream request and says why', () => {
    const result = exportCurl(definition({ protocol: 'websocket' }));
    expect(result.content).toBe('');
    expect(result.omissions.some((o) => o.code === 'protocol-unsupported')).toBe(true);
  });

  it('round-trips a request through export and re-import', () => {
    const original = definition({
      method: 'PUT',
      urlTemplate: 'https://api.test/v1/users/7',
      headers: [
        { id: 'h1', name: 'Accept', value: 'application/json', enabled: true },
        { id: 'h2', name: 'X-Trace', value: 'abc 123', enabled: true },
      ],
      query: [{ id: 'q1', name: 'dry', value: 'true', enabled: true }],
      body: { kind: 'json', text: '{"name":"ada"}' },
    });

    const exported = exportCurl(original);
    const { request } = first(exported.content);

    expect(request.method).toBe('PUT');
    expect(request.urlTemplate).toBe('https://api.test/v1/users/7');
    expect(request.query.map((p) => [p.name, p.value])).toEqual([['dry', 'true']]);
    expect(request.headers.map((h) => [h.name, h.value])).toEqual(
      expect.arrayContaining([
        ['Accept', 'application/json'],
        ['X-Trace', 'abc 123'],
      ])
    );
    expect(request.body).toEqual({ kind: 'json', text: '{"name":"ada"}' });
  });
});
