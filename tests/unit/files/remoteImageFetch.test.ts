import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchPinned, resolvePublicEndpoint } from '@main/files/remoteImageFetch';

describe('resolvePublicEndpoint', () => {
  it('rejects credentialed URLs and private literal destinations', async () => {
    expect(await resolvePublicEndpoint(new URL('http://user:pass@example.com/a.png'))).toMatchObject({
      error: expect.stringContaining('credential-free'),
    });
    expect(await resolvePublicEndpoint(new URL('http://127.0.0.1/meta'))).toMatchObject({
      error: expect.stringContaining('private network'),
    });
    expect(await resolvePublicEndpoint(new URL('http://169.254.169.254/latest/meta-data/'))).toMatchObject({
      error: expect.stringContaining('private network'),
    });
    expect(await resolvePublicEndpoint(new URL('http://localhost/x'))).toMatchObject({
      error: expect.stringContaining('private network'),
    });
  });

  it('pins a public literal address for the subsequent request', async () => {
    const endpoint = await resolvePublicEndpoint(new URL('https://8.8.8.8/'));
    expect(endpoint).toMatchObject({ address: '8.8.8.8', family: 4 });
  });
});

describe('fetchPinned redirect handling', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    })));
  });

  it('follows a Location header while leaving private validation to the caller', async () => {
    const server = http.createServer((request, response) => {
      if (request.url === '/start') {
        response.writeHead(302, { Location: 'http://127.0.0.1/secret' });
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected TCP address');
    // Direct pin to the listening address (caller would have rejected 127.0.0.1 before this in production).
    const endpoint = {
      url: new URL(`http://127.0.0.1:${address.port}/start`),
      address: '127.0.0.1',
      family: 4 as const,
    };
    const response = await fetchPinned(endpoint, { maxBytes: 1024, headers: { Accept: 'image/*' } });
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('http://127.0.0.1/secret');
  });
});
