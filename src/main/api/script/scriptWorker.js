/*
 * API script sandbox worker.
 *
 * This file is never imported as a module: it is inlined with `?raw` and started with
 * `new Worker(source, { eval: true })`, which is why it is hand-written CommonJS rather than
 * TypeScript. That keeps one main bundle (no second rollup entry, no asset to resolve at runtime)
 * and makes the worker byte-identical in dev, in tests, and in a packaged build.
 *
 * `require` here resolves relative to the *current working directory*, which is not knowable in a
 * packaged app, so the host passes absolute module paths in `workerData`.
 *
 * Two independent limits bound every job:
 *   - a QuickJS interrupt handler aborts the guest once its wall-clock deadline passes;
 *   - the runtime has a hard heap ceiling.
 * The host adds a third (terminate on the hard deadline) in case this worker itself wedges.
 *
 * Nothing from Node reaches the guest. The only values crossing into QuickJS are two JSON strings.
 */

const { parentPort, workerData } = require('node:worker_threads');

const GUEST_PRELUDE = `
(function () {
  var ctx = JSON.parse(globalThis.__bureauContextJson);
  var limits = JSON.parse(globalThis.__bureauLimitsJson);
  delete globalThis.__bureauContextJson;
  delete globalThis.__bureauLimitsJson;

  var MAX_TESTS = 1000;
  var MAX_WRITES = 200;
  var MAX_WRITE_BYTES = 64 * 1024;
  var NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

  var consoleEntries = [];
  var consoleDropped = 0;
  var tests = [];
  var writes = [];
  var vars = {};
  var keys = Object.keys(ctx.variables || {});
  for (var i = 0; i < keys.length; i += 1) vars[keys[i]] = ctx.variables[keys[i]];

  function fmt(value) {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'function') return '[function]';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (error) {
        return '[unserializable]';
      }
    }
    return String(value);
  }

  function record(level, args) {
    if (consoleEntries.length >= limits.consoleEntries) {
      consoleDropped += 1;
      return;
    }
    var parts = [];
    for (var i = 0; i < args.length; i += 1) parts.push(fmt(args[i]));
    var text = parts.join(' ');
    if (text.length > limits.consoleEntryBytes) {
      consoleEntries.push({ level: level, text: text.slice(0, limits.consoleEntryBytes), truncated: true });
      return;
    }
    consoleEntries.push({ level: level, text: text });
  }

  globalThis.console = {
    log: function () { record('log', arguments); },
    info: function () { record('log', arguments); },
    debug: function () { record('log', arguments); },
    warn: function () { record('warn', arguments); },
    error: function () { record('error', arguments); },
  };

  function headerLookup(headers) {
    return function (name) {
      var wanted = String(name).toLowerCase();
      for (var i = 0; i < headers.length; i += 1) {
        if (String(headers[i].name).toLowerCase() === wanted) return headers[i].value;
      }
      return undefined;
    };
  }

  var request = ctx.request;
  request.header = headerLookup(request.headers || []);
  Object.freeze(request);

  var response;
  if (ctx.response) {
    response = ctx.response;
    response.header = headerLookup(response.headers || []);
    response.json = function () {
      if (typeof response.body !== 'string') throw new Error('The response has no text body.');
      return JSON.parse(response.body);
    };
    Object.freeze(response);
  }

  function noteWrite(name, value) {
    for (var i = 0; i < writes.length; i += 1) {
      if (writes[i].name === name) {
        writes[i].value = value;
        return;
      }
    }
    if (writes.length >= MAX_WRITES) throw new Error('Too many variable writes (limit ' + MAX_WRITES + ').');
    writes.push({ name: name, value: value });
  }

  function checkName(name) {
    var text = String(name);
    if (!NAME_RE.test(text)) throw new Error('\\'' + text + '\\' is not a valid variable name.');
    return text;
  }

  var variables = {
    get: function (name) {
      var key = String(name);
      return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : undefined;
    },
    set: function (name, value) {
      var key = checkName(name);
      var text = typeof value === 'string' ? value : fmt(value);
      if (text.length > MAX_WRITE_BYTES) throw new Error('Variable \\'' + key + '\\' is too large to set.');
      vars[key] = text;
      noteWrite(key, text);
      return text;
    },
    unset: function (name) {
      var key = checkName(name);
      delete vars[key];
      noteWrite(key, null);
    },
  };

  function typeName(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeName(a) !== typeName(b)) return false;
    if (typeof a !== 'object' || a === null) return a !== a && b !== b;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    var ak = Object.keys(a);
    var bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (var j = 0; j < ak.length; j += 1) {
      if (!Object.prototype.hasOwnProperty.call(b, ak[j])) return false;
      if (!deepEqual(a[ak[j]], b[ak[j]])) return false;
    }
    return true;
  }

  function show(value) {
    var text = fmt(value);
    return text.length > 200 ? text.slice(0, 200) + '…' : text;
  }

  function makeExpect(actual, negated) {
    function assert(passed, describe) {
      var want = !negated;
      if (passed === want) return;
      throw new Error('Expected ' + show(actual) + (negated ? ' not ' : ' ') + describe);
    }
    var matchers = {
      toBe: function (expected) { assert(actual === expected, 'to be ' + show(expected)); },
      toEqual: function (expected) { assert(deepEqual(actual, expected), 'to equal ' + show(expected)); },
      toBeTruthy: function () { assert(Boolean(actual), 'to be truthy'); },
      toBeFalsy: function () { assert(!actual, 'to be falsy'); },
      toBeNull: function () { assert(actual === null, 'to be null'); },
      toBeUndefined: function () { assert(actual === undefined, 'to be undefined'); },
      toBeDefined: function () { assert(actual !== undefined, 'to be defined'); },
      toContain: function (expected) {
        var passed = Array.isArray(actual)
          ? actual.indexOf(expected) !== -1
          : typeof actual === 'string' && actual.indexOf(String(expected)) !== -1;
        assert(passed, 'to contain ' + show(expected));
      },
      toMatch: function (pattern) {
        var re = pattern instanceof RegExp ? pattern : new RegExp(String(pattern));
        assert(typeof actual === 'string' && re.test(actual), 'to match ' + String(re));
      },
      toHaveLength: function (expected) {
        assert(actual != null && actual.length === expected, 'to have length ' + show(expected));
      },
      toHaveProperty: function (name) {
        var passed = actual != null && Object.prototype.hasOwnProperty.call(actual, String(name));
        assert(passed, 'to have property ' + show(name));
      },
      toBeGreaterThan: function (expected) { assert(actual > expected, 'to be greater than ' + show(expected)); },
      toBeGreaterThanOrEqual: function (expected) { assert(actual >= expected, 'to be at least ' + show(expected)); },
      toBeLessThan: function (expected) { assert(actual < expected, 'to be less than ' + show(expected)); },
      toBeLessThanOrEqual: function (expected) { assert(actual <= expected, 'to be at most ' + show(expected)); },
    };
    if (!negated) matchers.not = makeExpect(actual, true);
    return matchers;
  }

  globalThis.bureau = Object.freeze({
    request: request,
    response: response,
    variables: Object.freeze(variables),
    environment: Object.freeze({ name: ctx.environmentName }),
    expect: function (value) { return makeExpect(value, false); },
    test: function (name, assertion) {
      var label = String(name).slice(0, 200);
      if (tests.length >= MAX_TESTS) throw new Error('Too many tests (limit ' + MAX_TESTS + ').');
      if (typeof assertion !== 'function') {
        tests.push({ name: label, passed: false, message: 'The assertion is not a function.' });
        return;
      }
      try {
        assertion();
        tests.push({ name: label, passed: true });
      } catch (error) {
        var message = error && error.message ? String(error.message) : String(error);
        tests.push({ name: label, passed: false, message: message.slice(0, 2000) });
      }
    },
  });

  globalThis.__bureauCollect = function () {
    return JSON.stringify({
      console: consoleEntries,
      consoleDropped: consoleDropped,
      tests: tests,
      writes: writes,
    });
  };
})();
`;

let modulePromise = null;

function loadModule() {
  if (!modulePromise) {
    const { newQuickJSWASMModuleFromVariant } = require(workerData.quickjsPath);
    const imported = require(workerData.variantPath);
    const variant = imported && imported.default ? imported.default : imported;
    modulePromise = newQuickJSWASMModuleFromVariant(variant);
  }
  return modulePromise;
}

/** Pulls the guest line number out of a QuickJS stack so an error points at the user's script. */
function guestLine(stack) {
  if (typeof stack !== 'string') return undefined;
  const match = /script\.js:(\d+)/.exec(stack);
  return match ? Number(match[1]) : undefined;
}

function describeError(dumped) {
  if (dumped && typeof dumped === 'object') {
    const name = typeof dumped.name === 'string' ? dumped.name : 'Error';
    const message = typeof dumped.message === 'string' ? dumped.message : '';
    return {
      message: message ? `${name}: ${message}` : name,
      line: guestLine(dumped.stack),
      interrupted: message === 'interrupted',
      outOfMemory: message === 'out of memory',
    };
  }
  return { message: String(dumped), interrupted: false, outOfMemory: false };
}

function runJob(mod, job) {
  const limits = job.limits;
  const runtime = mod.newRuntime();
  let context = null;
  try {
    runtime.setMemoryLimit(limits.heapBytes);
    const startedAt = Date.now();
    // Called by QuickJS periodically during evaluation, so a `while (true) {}` still aborts.
    runtime.setInterruptHandler(() => Date.now() - startedAt > limits.deadlineMs);
    context = runtime.newContext();

    const inject = (name, value) => {
      const handle = context.newString(value);
      context.setProp(context.global, name, handle);
      handle.dispose();
    };
    inject('__bureauContextJson', JSON.stringify(job.context));
    inject('__bureauLimitsJson', JSON.stringify(limits));

    const prelude = context.evalCode(GUEST_PRELUDE, 'bureau-prelude.js');
    if (prelude.error) {
      const detail = describeError(context.dump(prelude.error));
      prelude.error.dispose();
      // The prelude is Bureau's own code, so this is a bug rather than a user-script failure.
      return { ok: false, error: { kind: 'protocol', message: detail.message } };
    }
    prelude.value.dispose();

    const evaluated = context.evalCode(job.source, 'script.js');
    let scriptError = null;
    if (evaluated.error) {
      scriptError = describeError(context.dump(evaluated.error));
      evaluated.error.dispose();
    } else {
      evaluated.value.dispose();
      // The guest API is entirely synchronous, but a script may still have created promises.
      // Draining once keeps a stray `.then()` from silently disappearing without allowing the
      // script to schedule unbounded work.
      runtime.executePendingJobs(1000);
    }

    // The script's deadline has already passed if it was interrupted, and the interrupt handler
    // would abort collection too — so collection gets its own small budget.
    const collectStartedAt = Date.now();
    runtime.setInterruptHandler(() => Date.now() - collectStartedAt > 200);

    const collected = context.evalCode('__bureauCollect()', 'bureau-collect.js');
    if (collected.error) {
      const detail = describeError(context.dump(collected.error));
      collected.error.dispose();
      // Collection itself was interrupted or ran out of memory: report the limit, not the payload.
      return {
        ok: false,
        error: {
          kind: detail.interrupted || detail.outOfMemory ? 'limit' : 'protocol',
          message: detail.interrupted
            ? `The script exceeded its ${limits.deadlineMs} ms deadline.`
            : detail.outOfMemory
              ? 'The script exceeded its memory limit.'
              : detail.message,
        },
      };
    }
    const json = context.getString(collected.value);
    collected.value.dispose();

    if (json.length > limits.returnBytes) {
      return {
        ok: false,
        error: { kind: 'limit', message: 'The script returned more data than the sandbox allows.' },
      };
    }
    const payload = JSON.parse(json);

    if (scriptError) {
      return {
        ok: false,
        console: payload.console,
        consoleDropped: payload.consoleDropped,
        tests: payload.tests,
        writes: payload.writes,
        error: {
          kind: scriptError.interrupted || scriptError.outOfMemory ? 'limit' : 'script',
          message: scriptError.interrupted
            ? `The script exceeded its ${limits.deadlineMs} ms deadline.`
            : scriptError.outOfMemory
              ? 'The script exceeded its memory limit.'
              : scriptError.message,
          line: scriptError.line,
        },
      };
    }

    return {
      ok: payload.tests.every((test) => test.passed),
      console: payload.console,
      consoleDropped: payload.consoleDropped,
      tests: payload.tests,
      writes: payload.writes,
    };
  } finally {
    // A runtime per job is what isolates one script from the next: nothing survives disposal.
    if (context) context.dispose();
    runtime.dispose();
  }
}

parentPort.on('message', (job) => {
  if (!job || job.type !== 'run') {
    parentPort.postMessage({ type: 'fatal', message: 'Unknown sandbox message.' });
    return;
  }
  loadModule().then(
    (mod) => {
      let outcome;
      try {
        outcome = runJob(mod, job);
      } catch (error) {
        outcome = {
          ok: false,
          error: { kind: 'protocol', message: error && error.message ? error.message : String(error) },
        };
      }
      parentPort.postMessage({
        type: 'result',
        jobId: job.jobId,
        ok: Boolean(outcome.ok),
        console: outcome.console || [],
        consoleDropped: outcome.consoleDropped || 0,
        tests: outcome.tests || [],
        writes: outcome.writes || [],
        error: outcome.error,
      });
    },
    (error) => {
      parentPort.postMessage({
        type: 'fatal',
        jobId: job.jobId,
        message: `The script sandbox could not start: ${error && error.message ? error.message : String(error)}`,
      });
    }
  );
});
