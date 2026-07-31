#!/usr/bin/env node
/**
 * Loopback-only fixture for manually exercising Bureau's API workspace.
 * It deliberately exposes predictable, non-sensitive data and refuses to proxy non-loopback hosts.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { WebSocketServer } from 'ws';

const HOST = '127.0.0.1';
const HTTP_PORT = Number(process.env.BUREAU_API_HTTP_PORT ?? 4010);
const HTTPS_PORT = Number(process.env.BUREAU_API_HTTPS_PORT ?? 4011);
const PROXY_PORT = Number(process.env.BUREAU_API_PROXY_PORT ?? 4012);
const SOCKS_PORT = Number(process.env.BUREAU_API_SOCKS_PORT ?? 4013);
const AUTH_PROXY_PORT = Number(process.env.BUREAU_API_AUTH_PROXY_PORT ?? 4014);
const AUTH_SOCKS_PORT = Number(process.env.BUREAU_API_AUTH_SOCKS_PORT ?? 4015);
const PROXY_USER = 'proxy-user';
const PROXY_PASSWORD = 'proxy-pass';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(moduleDir, '..', 'tests', 'fixtures', 'tls');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL92wAAAABJRU5ErkJggg==',
  'base64'
);

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  // Deliberately compact: the API tab's Pretty view must visibly differ from the exact Raw body.
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function requestSummary(request, body) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  return {
    method: request.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: request.headers,
    bodyBytes: body.byteLength,
    bodyText: body.toString('utf8'),
    requestId: randomUUID(),
  };
}

function basicAuthorized(value) {
  return value === `Basic ${Buffer.from(`${PROXY_USER}:${PROXY_PASSWORD}`).toString('base64')}`;
}

function isLoopbackHost(host) {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return bare === 'localhost' || bare === '::1' || /^127(?:\.\d{1,3}){3}$/.test(bare);
}

function parseAuthority(authority) {
  try {
    const url = new URL(`http://${authority}`);
    return { host: url.hostname, port: Number(url.port || 80) };
  } catch {
    return null;
  }
}

async function handleApi(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${HTTP_PORT}`}`);
  const body = await readBody(request);
  const pathName = url.pathname;

  if (pathName === '/health') return sendJson(response, 200, { ok: true, service: 'bureau-api-fixture' });
  if (pathName === '/echo' || pathName === '/upload') return sendJson(response, 200, requestSummary(request, body));
  if (pathName === '/json') return sendJson(response, 200, { message: 'Hello from Bureau', nested: { answer: 42 }, items: [1, 2, 3] });
  if (pathName === '/xml') {
    response.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    return response.end('<?xml version="1.0"?><fixture><message>Hello</message></fixture>');
  }
  if (pathName === '/html') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return response.end('<!doctype html><title>Bureau fixture</title><h1>Safe HTML preview</h1><p>Scripts must not run here.</p>');
  }
  if (pathName === '/image') {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.byteLength });
    return response.end(png);
  }
  if (pathName === '/gzip') {
    const compressed = gzipSync(JSON.stringify({ compressed: true, message: 'Bureau decompressed this.' }));
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
    return response.end(compressed);
  }
  if (pathName === '/large') {
    const bytes = Math.min(Math.max(Number(url.searchParams.get('bytes') ?? 2_000_000), 1), 30_000_000);
    response.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': bytes });
    return response.end(Buffer.alloc(bytes, 'x'));
  }
  if (/^\/status\/\d{3}$/.test(pathName)) return sendJson(response, Number(pathName.slice(-3)), { status: Number(pathName.slice(-3)) });
  if (/^\/delay\/\d+$/.test(pathName)) {
    const delay = Math.min(Number(pathName.slice('/delay/'.length)), 60_000);
    return setTimeout(() => sendJson(response, 200, { delayedMs: delay }), delay);
  }
  if (/^\/redirect\/\d+$/.test(pathName)) {
    const remaining = Number(pathName.slice('/redirect/'.length));
    response.writeHead(302, { Location: remaining > 0 ? `/redirect/${remaining - 1}` : '/json' });
    return response.end();
  }
  if (pathName === '/auth/basic') {
    if (!basicAuthorized(request.headers.authorization)) {
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Bureau fixture"' });
      return response.end('Basic authentication required');
    }
    return sendJson(response, 200, { authenticated: 'basic' });
  }
  if (pathName === '/auth/bearer') {
    return request.headers.authorization === 'Bearer local-token'
      ? sendJson(response, 200, { authenticated: 'bearer' })
      : sendJson(response, 401, { error: 'Use Bearer local-token.' });
  }
  if (pathName === '/auth/api-key') {
    const key = request.headers['x-test-key'] ?? url.searchParams.get('api_key');
    return key === 'local-api-key'
      ? sendJson(response, 200, { authenticated: 'api-key' })
      : sendJson(response, 401, { error: 'Use X-Test-Key: local-api-key or ?api_key=local-api-key.' });
  }
  if (pathName === '/cookies/set') {
    return sendJson(
      response,
      200,
      { set: true },
      { 'Set-Cookie': ['bureau_session=cookie-value; Path=/; HttpOnly; SameSite=Lax', 'bureau_theme=graphite; Path=/; SameSite=Strict'] }
    );
  }
  if (pathName === '/cookies/check') return sendJson(response, 200, { cookie: request.headers.cookie ?? '' });
  if (pathName === '/cookies/delete') return sendJson(response, 200, { deleted: true }, { 'Set-Cookie': 'bureau_session=; Path=/; Max-Age=0' });
  if (pathName === '/graphql') return handleGraphql(response, body);
  if (pathName === '/events' || pathName === '/events/finite') return handleSse(request, response, pathName.endsWith('/finite'));
  if (pathName === '/oauth/authorize') return handleAuthorization(url, response);
  if (pathName === '/oauth/token') return handleToken(body, response);
  if (pathName === '/oauth/revoke') return sendJson(response, 200, { revoked: true });
  if (pathName === '/oauth/userinfo') {
    return request.headers.authorization?.startsWith('Bearer fixture-access-')
      ? sendJson(response, 200, { sub: 'local-user', name: 'Bureau fixture user' })
      : sendJson(response, 401, { error: 'OAuth access token required.' });
  }
  return sendJson(response, 404, { error: 'Unknown fixture route', path: pathName });
}

function handleGraphql(response, body) {
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return sendJson(response, 400, { errors: [{ message: 'Expected JSON GraphQL payload.' }] });
  }
  const query = String(payload.query ?? '');
  if (query.includes('__schema')) {
    return sendJson(response, 200, { data: { __schema: { queryType: { name: 'Query' }, types: [{ name: 'Query' }, { name: 'Mutation' }, { name: 'Fixture' }] } } });
  }
  if (query.includes('error')) return sendJson(response, 200, { errors: [{ message: 'Deliberate GraphQL fixture error.' }] });
  if (query.includes('mutation')) return sendJson(response, 200, { data: { updateFixture: { ok: true, input: payload.variables ?? {} } } });
  return sendJson(response, 200, { data: { hello: 'Hello GraphQL', fixture: { id: 'fixture-1', name: 'Bureau API fixture' }, variables: payload.variables ?? {} } });
}

function handleSse(request, response, finite) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  response.write(': Bureau SSE fixture\n\n');
  response.write('id: 1\nevent: ready\ndata: {"ready":true}\n\n');
  let index = 1;
  const timer = setInterval(() => {
    response.write(`id: ${index + 1}\nevent: tick\ndata: {"tick":${index}}\ndata: "second line"\n\n`);
    index += 1;
    if (finite && index > 3) {
      clearInterval(timer);
      response.end();
    }
  }, 1_000);
  request.on('close', () => clearInterval(timer));
}

function handleAuthorization(url, response) {
  const redirect = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  if (!redirect || !state) return sendJson(response, 400, { error: 'redirect_uri and state are required.' });
  const callback = new URL(redirect);
  callback.searchParams.set('code', `fixture-code-${randomUUID()}`);
  callback.searchParams.set('state', state);
  response.writeHead(302, { Location: callback.toString() });
  response.end();
}

function handleToken(body, response) {
  const values = new URLSearchParams(body.toString('utf8'));
  const grant = values.get('grant_type');
  if (grant !== 'authorization_code' && grant !== 'client_credentials' && grant !== 'refresh_token') {
    return sendJson(response, 400, { error: 'unsupported_grant_type' });
  }
  const token = `fixture-access-${createHash('sha256').update(`${grant}:${Date.now()}`).digest('hex').slice(0, 12)}`;
  return sendJson(response, 200, { access_token: token, refresh_token: 'fixture-refresh-token', token_type: 'Bearer', expires_in: 3600, scope: values.get('scope') ?? '' });
}

function attachWebSockets(server) {
  const echo = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has('bureau.v1') ? 'bureau.v1' : false) });
  const graphql = new WebSocketServer({ noServer: true, handleProtocols: (protocols) => (protocols.has('graphql-transport-ws') ? 'graphql-transport-ws' : false) });
  echo.on('connection', (socket) => {
    socket.send('connected to Bureau fixture');
    socket.on('message', (data, binary) => socket.send(data, { binary }));
  });
  graphql.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.close(4400, 'Invalid JSON'); return; }
      if (message.type === 'connection_init') socket.send(JSON.stringify({ type: 'connection_ack' }));
      if (message.type === 'subscribe') {
        socket.send(JSON.stringify({ type: 'next', id: message.id, payload: { data: { ticker: { symbol: 'BUREAU', price: 42 } } } }));
        setTimeout(() => socket.send(JSON.stringify({ type: 'complete', id: message.id })), 1_000).unref();
      }
    });
  });
  server.on('upgrade', (request, socket, head) => {
    const pathName = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`).pathname;
    if (pathName === '/ws') return echo.handleUpgrade(request, socket, head, (client) => echo.emit('connection', client, request));
    if (pathName === '/graphql-ws') return graphql.handleUpgrade(request, socket, head, (client) => graphql.emit('connection', client, request));
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
  });
}

function createProxy({ requireAuth }) {
  const proxy = http.createServer((request, response) => {
    if (requireAuth && !basicAuthorized(request.headers['proxy-authorization'])) {
      response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Bureau fixture proxy"' });
      response.end();
      return;
    }
    let target;
    try { target = new URL(request.url); } catch { response.writeHead(400); response.end('Use an absolute URL.'); return; }
    if (!isLoopbackHost(target.hostname)) { response.writeHead(403); response.end('Fixture proxy permits loopback targets only.'); return; }
    const client = (target.protocol === 'https:' ? https : http).request(target, { method: request.method, headers: { ...request.headers, host: target.host } }, (upstream) => {
      response.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(response);
    });
    client.on('error', () => { response.writeHead(502); response.end('Upstream failed.'); });
    request.pipe(client);
  });
  proxy.on('connect', (request, clientSocket, head) => {
    if (requireAuth && !basicAuthorized(request.headers['proxy-authorization'])) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Bureau fixture proxy"\r\n\r\n');
      return clientSocket.destroy();
    }
    const target = parseAuthority(request.url ?? '');
    if (!target || !isLoopbackHost(target.host)) { clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return clientSocket.destroy(); }
    const upstream = net.connect(target.port, target.host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.byteLength) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  return proxy;
}

function createSocks({ requireAuth }) {
  return net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let stage = 'greeting';
    const consume = () => {
      if (stage === 'greeting') {
        if (buffer.byteLength < 2) return;
        const count = buffer[1];
        if (buffer.byteLength < count + 2 || buffer[0] !== 5) return socket.destroy();
        const methods = buffer.subarray(2, count + 2); buffer = buffer.subarray(count + 2);
        const method = requireAuth ? 2 : 0;
        if (!methods.includes(method)) { socket.write(Buffer.from([5, 255])); return socket.destroy(); }
        socket.write(Buffer.from([5, method])); stage = requireAuth ? 'auth' : 'request'; return consume();
      }
      if (stage === 'auth') {
        if (buffer.byteLength < 2) return;
        const userLength = buffer[1];
        if (buffer.byteLength < userLength + 3) return;
        const username = buffer.subarray(2, userLength + 2).toString(); const passwordLength = buffer[userLength + 2];
        if (buffer.byteLength < userLength + passwordLength + 3) return;
        const password = buffer.subarray(userLength + 3, userLength + passwordLength + 3).toString(); buffer = buffer.subarray(userLength + passwordLength + 3);
        if (username !== PROXY_USER || password !== PROXY_PASSWORD) { socket.write(Buffer.from([1, 1])); return socket.destroy(); }
        socket.write(Buffer.from([1, 0])); stage = 'request'; return consume();
      }
      if (stage !== 'request' || buffer.byteLength < 5 || buffer[0] !== 5 || buffer[1] !== 1) return;
      const atyp = buffer[3]; let offset = 4; let host;
      if (atyp === 1) { if (buffer.byteLength < offset + 6) return; host = Array.from(buffer.subarray(offset, offset + 4)).join('.'); offset += 4; }
      else if (atyp === 3) { const length = buffer[offset]; if (buffer.byteLength < offset + length + 3) return; offset += 1; host = buffer.subarray(offset, offset + length).toString(); offset += length; }
      else { socket.write(Buffer.from([5, 8, 0, 1, 0, 0, 0, 0, 0, 0])); return socket.destroy(); }
      const port = buffer.readUInt16BE(offset); buffer = buffer.subarray(offset + 2);
      if (!isLoopbackHost(host)) { socket.write(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0])); return socket.destroy(); }
      const upstream = net.connect(port, host, () => { socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); if (buffer.byteLength) upstream.write(buffer); upstream.pipe(socket); socket.pipe(upstream); });
      upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy()); stage = 'tunnel';
    };
    socket.on('data', (chunk) => { if (stage === 'tunnel') return; buffer = Buffer.concat([buffer, chunk]); consume(); });
  });
}

function listen(server, port, name) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => { server.off('error', reject); resolve(); console.log(`${name}: ${HOST}:${port}`); });
  });
}

const httpServer = http.createServer(handleApi);
const httpsServer = https.createServer({ cert: fs.readFileSync(path.join(fixturesDir, 'localhost-cert.pem')), key: fs.readFileSync(path.join(fixturesDir, 'localhost-key.pem')) }, handleApi);
attachWebSockets(httpServer);
attachWebSockets(httpsServer);
await Promise.all([
  listen(httpServer, HTTP_PORT, 'HTTP / WebSocket'),
  listen(httpsServer, HTTPS_PORT, 'HTTPS / WSS (self-signed)'),
  listen(createProxy({ requireAuth: false }), PROXY_PORT, 'HTTP proxy'),
  listen(createSocks({ requireAuth: false }), SOCKS_PORT, 'SOCKS5 proxy'),
  listen(createProxy({ requireAuth: true }), AUTH_PROXY_PORT, 'HTTP proxy (Basic auth)'),
  listen(createSocks({ requireAuth: true }), AUTH_SOCKS_PORT, 'SOCKS5 proxy (user/password)'),
]);
console.log(`Credentials for authenticated proxies: ${PROXY_USER} / ${PROXY_PASSWORD}`);
console.log('Press Ctrl+C to stop.');
