import { afterAll, describe, expect, it } from 'vitest';
import { createScriptSandbox } from '@main/api/script/ScriptSandbox';
import type { ScriptContext } from '@main/api/script/protocol';
import type { ApiScriptHolder } from '@shared/contracts/apiWorkbench';

/**
 * Release Gate B. Every test here is an escape attempt or a limit: the sandbox is the only place
 * in Bureau where third-party code executes, so its boundary is asserted directly rather than
 * inferred from the features built on top of it.
 */
describe('API script sandbox', () => {
  const sandbox = createScriptSandbox();
  const holder: ApiScriptHolder = { kind: 'request', id: 'r1', name: 'Test request' };

  afterAll(() => {
    sandbox.dispose();
  });

  function context(patch: Partial<ScriptContext> = {}): ScriptContext {
    return {
      request: {
        name: 'Test request',
        protocol: 'http',
        method: 'GET',
        url: 'https://api.test/users',
        headers: [{ name: 'Accept', value: 'application/json' }],
      },
      variables: {},
      secretNames: [],
      ...patch,
    };
  }

  const run = (source: string, patch: Partial<ScriptContext> = {}, secretValues: string[] = []) =>
    sandbox.run({
      phase: 'post-response',
      holder,
      source,
      context: context(patch),
      secretValues,
    });

  it('runs a script and reports assertions', async () => {
    const result = await run(`
      bureau.test('status is ok', () => bureau.expect(bureau.response.status).toBe(200));
      bureau.test('body has id', () => bureau.expect(bureau.response.json()).toHaveProperty('id'));
      bureau.test('this one fails', () => bureau.expect(1).toBe(2));
    `, {
      response: {
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://api.test/users',
        headers: [{ name: 'content-type', value: 'application/json' }],
        body: '{"id":7}',
        totalMs: 12,
      },
    });

    expect(result.outcome.ran).toBe(true);
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.tests.map((test) => [test.name, test.passed])).toEqual([
      ['status is ok', true],
      ['body has id', true],
      ['this one fails', false],
    ]);
    expect(result.outcome.tests[2].message).toContain('to be 2');
  });

  it('collects console output and reports the writes a script made', async () => {
    const result = await run(`
      console.log('hello', { a: 1 });
      console.warn('careful');
      bureau.variables.set('token', 'abc');
      bureau.variables.unset('stale');
    `);
    expect(result.outcome.console).toEqual([
      { level: 'log', text: 'hello {"a":1}' },
      { level: 'warn', text: 'careful' },
    ]);
    expect(result.writes).toEqual([
      { name: 'token', value: 'abc' },
      { name: 'stale', value: null },
    ]);
    expect(result.outcome.variableWrites).toEqual(['token', 'stale']);
  });

  it('cannot reach Node, Electron, the filesystem, or the network', async () => {
    const result = await run(`
      const reached = [];
      for (const name of ['require', 'process', 'Buffer', 'fetch', 'setTimeout', 'WebAssembly', 'XMLHttpRequest']) {
        if (typeof globalThis[name] !== 'undefined') reached.push(name);
      }
      bureau.test('no host globals', () => bureau.expect(reached).toEqual([]));
    `);
    expect(result.outcome.tests[0].passed).toBe(true);
    expect(result.outcome.ok).toBe(true);
  });

  it('cannot escape to the host through the Function constructor or a prototype chain', async () => {
    const result = await run(`
      const escapes = [];
      try {
        const host = Function('return this')();
        if (host.process || host.require) escapes.push('function-constructor');
      } catch (error) { /* also acceptable */ }
      try {
        const ctor = Object.getPrototypeOf(bureau.request).constructor.constructor;
        if (ctor('return typeof process')() !== 'undefined') escapes.push('prototype-chain');
      } catch (error) { /* also acceptable */ }
      try {
        Object.prototype.polluted = 'yes';
        if (({}).polluted !== 'yes') escapes.push('unexpected');
      } catch (error) { /* frozen is fine too */ }
      bureau.test('no escape', () => bureau.expect(escapes).toEqual([]));
    `);
    expect(result.outcome.tests[0].passed).toBe(true);
  });

  it('guest prototype pollution does not leak into the next script', async () => {
    await run(`Object.prototype.leaked = 'first'; Array.prototype.push = function () { throw new Error('hijacked'); };`);
    const second = await run(`
      bureau.test('clean realm', () => bureau.expect(({}).leaked).toBeUndefined());
      bureau.test('array still works', () => bureau.expect([1].concat(2)).toEqual([1, 2]));
    `);
    expect(second.outcome.tests.every((test) => test.passed)).toBe(true);
  });

  it('stops an infinite loop at the deadline instead of hanging', async () => {
    const startedAt = Date.now();
    const result = await run('while (true) {}');
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.errorCode).toBe('API_SCRIPT_LIMIT_EXCEEDED');
    // The post-response deadline is 2s; the host's hard deadline is 5s.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it('stops a runaway allocation at the heap limit', async () => {
    const result = await run(`
      const held = [];
      while (true) held.push(new Array(100000).fill('x'));
    `);
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.errorCode).toBe('API_SCRIPT_LIMIT_EXCEEDED');
    // Distinguishes the heap ceiling from the deadline, which reports the same code.
    expect(result.outcome.errorMessage).toContain('memory');
  });

  it('caps a console flood and reports how much it dropped', async () => {
    const result = await run(`for (let i = 0; i < 5000; i += 1) console.log('line ' + i);`);
    // 200 entries for the post-response phase.
    expect(result.outcome.console).toHaveLength(200);
    expect(result.outcome.consoleDropped).toBe(4_800);
  });

  it('truncates an oversized console entry rather than shipping it', async () => {
    const result = await run(`console.log('x'.repeat(50000));`);
    expect(result.outcome.console[0].truncated).toBe(true);
    expect(result.outcome.console[0].text).toHaveLength(8 * 1024);
  });

  it('redacts a secret a script echoes into console output, an assertion, or an error', async () => {
    const secret = 'super-secret-token-value';
    const result = await run(
      `
        console.log('token is ' + bureau.variables.get('token'));
        bureau.test('leaks in message', () => bureau.expect(bureau.variables.get('token')).toBe('nope'));
        throw new Error('failing with ' + bureau.variables.get('token'));
      `,
      { variables: { token: secret }, secretNames: ['token'] },
      [secret]
    );
    const serialised = JSON.stringify(result.outcome);
    expect(serialised).not.toContain(secret);
    expect(result.outcome.console[0].text).toBe('token is «redacted»');
    expect(result.outcome.tests[0].message).toContain('«redacted»');
    expect(result.outcome.errorMessage).toContain('«redacted»');
  });

  it('reports a guest error with its line number and keeps its console output', async () => {
    const result = await run(`console.log('before');\nnotDefined();`);
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.errorCode).toBe('API_SCRIPT_FAILED');
    expect(result.outcome.errorMessage).toContain('notDefined');
    expect(result.outcome.errorLine).toBe(2);
    expect(result.outcome.console[0].text).toBe('before');
  });

  it('discards variable writes from a script that failed', async () => {
    const result = await run(`bureau.variables.set('half', 'written'); throw new Error('nope');`);
    expect(result.writes).toEqual([]);
    expect(result.outcome.variableWrites).toEqual(['half']);
  });

  it('recovers after the worker is terminated mid-job', async () => {
    // The deadline path terminates and retires the worker; the next job must still run.
    await run('while (true) {}');
    const after = await run(`bureau.test('still alive', () => bureau.expect(1).toBe(1));`);
    expect(after.outcome.tests[0].passed).toBe(true);
  });

  it('cancels a queued script when the signal aborts', async () => {
    const controller = new AbortController();
    const pending = sandbox.run({
      phase: 'post-response',
      holder,
      source: 'while (true) {}',
      context: context(),
      secretValues: [],
      signal: controller.signal,
    });
    controller.abort();
    const result = await pending;
    expect(result.outcome.ok).toBe(false);
    expect(result.outcome.errorCode).toBe('API_CANCELLED');
  });

  it('validates syntax without executing the script', async () => {
    const bad = await sandbox.validate('const = 1;', 'pre-request');
    expect(bad.ok).toBe(false);

    const sideEffect = await sandbox.validate(
      `bureau.variables.set('nope', 'should not run');`,
      'pre-request'
    );
    expect(sideEffect).toEqual({ ok: true });
  });

  it('refuses a script larger than the sandbox allows', async () => {
    const result = await run(`// ${'x'.repeat(100_001)}`);
    expect(result.outcome.ran).toBe(false);
    expect(result.outcome.errorCode).toBe('API_SCRIPT_LIMIT_EXCEEDED');
  });
});
