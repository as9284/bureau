# Using Bureau's API workspace

This guide lets you practise every main API feature without using a real service or real credentials. The practice server runs only on your computer.

Do the sections in order the first time. You can then return to the feature you need.

## 1. Start the practice server

Open a terminal in the Bureau repository and run:

```powershell
npm run api:test-server
```

Leave that terminal open. It should say `HTTP / WebSocket: 127.0.0.1:4010`.

If the app or server was already open, stop the old server with `Ctrl+C` and start it again. This ensures the Raw and Pretty response examples are different.

## 2. What the screen is for

- **Collections** on the left holds your saved requests. Right-click a request to rename, duplicate, or delete it.
- The middle area is the request editor. Choose the protocol, method, URL, headers, body, and authentication here.
- The lower area is the response. It shows what the server sent back.
- **Save** stores the current request. You can also press `Ctrl+S`.
- **Send** runs an HTTP or GraphQL request. For WebSocket and SSE, it becomes **Connect**.

The response panel has a **Focus response** button after a response arrives. Use it when you want to read a large response without resizing anything. Press `Esc` to return to the request editor.

## 3. Your first HTTP request

1. Click **New request**.
2. Set **Request name** to `Hello test`.
3. Leave the protocol as **HTTP** and the method as **GET**.
4. Set the URL to:

   ```text
   http://127.0.0.1:4010/json
   ```

5. Click **Send**.
6. Confirm the response shows `200 OK` and `Hello from Bureau`.
7. Click **Save** or press `Ctrl+S`.

### Reading the response

- **Pretty** formats JSON to make it easier to read.
- **Raw** shows the exact text the server sent.
- **Headers** shows response headers such as `content-type`.
- **Timeline** shows redirects and timing information.

Try the `Pretty` and `Raw` tabs on `/json`. Pretty is multi-line; Raw is a single compact line.

## 4. Query parameters, headers, and request bodies

### Query parameters

1. Use `GET http://127.0.0.1:4010/echo`.
2. Open **Params**.
3. Click **Add row** and enter `from` as the name and `manual` as the value.
4. Click **Send**.

The response should contain `"query":{"from":"manual"}`.

### Request headers

1. Keep the `/echo` request open.
2. Open **Headers**.
3. Add `X-Example` with the value `Bureau`.
4. Send the request.

The response includes your `x-example` header. Header names are case-insensitive, so the server may show it in lower case.

### JSON body

1. Change the method to **POST**.
2. Use `http://127.0.0.1:4010/echo`.
3. Open **Body** and choose **JSON**.
4. Enter:

   ```json
   {"message":"hello"}
   ```

5. Send the request.

The response should report `POST`, a JSON content type, and the body text you sent.

## 5. Cookies: keeping a session between requests

Cookies are values a server asks Bureau to remember. They are stored in the selected API workspace's cookie jar, not in your browser.

1. Send `GET http://127.0.0.1:4010/cookies/set`.
2. Confirm the response is `200 OK`.
3. In the left sidebar, click **Cookies**. You should see `bureau_session` and `bureau_theme`.
4. Go back to your request and change the URL to:

   ```text
   http://127.0.0.1:4010/cookies/check
   ```

5. Click **Send**.

The response should contain a `cookie` value with `bureau_session=cookie-value`.

To remove cookies, return to **Cookies** and delete one cookie, or use **Clear** to empty the selected jar. Use `GET http://127.0.0.1:4010/cookies/delete` to test a server deleting its own session cookie.

## 6. WebSocket: a live two-way connection

WebSocket is for a connection that stays open so you can send and receive messages repeatedly.

1. Create a new request.
2. Change the first protocol selector from **HTTP** to **WebSocket**.
3. Set the URL to:

   ```text
   ws://127.0.0.1:4010/ws
   ```

4. Click **Connect**.
5. Wait for the stream console to say **Connected** and show `connected to Bureau fixture`.
6. Under the transcript, enter `hello` in **Message**.
7. Click **Send message**.

The transcript should show your outgoing message and an incoming `hello` echo. Use **Pause display** to stop the screen moving while the connection remains open, and **Disconnect** when you are finished.

## 7. Server-sent events (SSE): a live one-way feed

SSE is for a server that continuously sends events to you. Unlike WebSocket, you do not send messages back through it.

1. Create a new request.
2. Change the protocol to **SSE**.
3. Set the URL to:

   ```text
   http://127.0.0.1:4010/events
   ```

4. Click **Connect**.

You should see a `ready` event, then a `tick` event every second. Use **Pause display** to inspect events without closing the connection, then **Disconnect** when finished.

For a short stream that ends by itself, use `http://127.0.0.1:4010/events/finite`.

## 8. GraphQL: a query and variables

GraphQL uses its own request editor instead of the normal HTTP Body tab.

1. Create a new request.
2. Change the protocol to **GraphQL**.
3. Set the URL to:

   ```text
   http://127.0.0.1:4010/graphql
   ```

4. Leave **Transport** as **POST**.
5. In **Query or mutation**, enter:

   ```graphql
   query GetFixture {
     hello
     fixture {
       id
       name
     }
   }
   ```

6. Click **Send**.

The response should contain `Hello GraphQL` and a fixture named `Bureau API fixture`.

### GraphQL variables

1. Replace the query with:

   ```graphql
   query WithVariables {
     hello
   }
   ```

2. In **Variables (JSON)**, enter:

   ```json
   {"example":"from Bureau"}
   ```

3. Send it.

The fixture returns the variables it received. You can also click **Introspect schema** to confirm Bureau can read the service's GraphQL schema. To see how GraphQL errors are displayed, use a query containing the word `error`.

## 9. Environments: reuse a base URL

Environments are named sets of values, useful when the same request must run against local, test, and production servers.

1. In the left sidebar, click **Environments**, then **New**.
2. Name it `Local fixture`.
3. Add a variable named `baseUrl` with this value:

   ```text
   http://127.0.0.1:4010
   ```

4. Select `Local fixture` from the environment selector at the top of the API screen.
5. In a request URL, use:

   ```text
   {{baseUrl}}/json
   ```

6. Send the request.

It should succeed exactly like the earlier `/json` request. Later, you can create another environment with the same variable name but a different value.

## 10. Authentication

Open the request's **Auth** tab, choose the authentication type, enter the values below, and send the request.

| Type | URL | Values | Success looks like |
| --- | --- | --- | --- |
| Basic | `http://127.0.0.1:4010/auth/basic` | username `fixture`, password `password` | `authenticated: "basic"` |
| Bearer token | `http://127.0.0.1:4010/auth/bearer` | token `local-token` | `authenticated: "bearer"` |
| API key | `http://127.0.0.1:4010/auth/api-key` | Header name `X-Test-Key`, value `local-api-key` | `authenticated: "api-key"` |

Use **Secrets** in the left sidebar for values you do not want to type into each request. The secret value is deliberately not shown again after saving it.

## 11. TLS and proxies

These are advanced features. They deliberately require a profile, so a request cannot silently bypass security or use a proxy.

### Self-signed HTTPS certificate

1. Send `GET https://127.0.0.1:4011/json`. It should fail first because the practice certificate is self-signed.
2. Open **Settings** in that request and create/select a TLS profile that permits `127.0.0.1`.
3. Acknowledge the warning and send again.

The response should work and Bureau should show a certificate-warning banner. Do not use this exception for a real public API unless you understand why its certificate cannot be verified.

### Proxy

1. Create a proxy profile from request **Settings**.
2. Use host `127.0.0.1` and port `4012` for HTTP proxy testing.
3. Select that profile for `http://127.0.0.1:4010/json` and send.

The response should identify that a proxy was used. SOCKS5 uses port `4013`. Authenticated proxy variants are `4014` and `4015`, with username `proxy-user` and password `proxy-pass`.

## 12. Other useful tests

| Feature | URL / action | Expected result |
| --- | --- | --- |
| Error response | `GET http://127.0.0.1:4010/status/418` | Bureau shows `418` and the response body. |
| Redirect timeline | `GET http://127.0.0.1:4010/redirect/2` | Final `200`; Timeline lists two redirects. |
| Cancel | Send `GET http://127.0.0.1:4010/delay/30000`, then click **Cancel** | The request stops. |
| Gzip | `GET http://127.0.0.1:4010/gzip` | A normal readable JSON response. |
| Binary response | `GET http://127.0.0.1:4010/image` | Binary metadata/preview rather than text. |
| Large response | `GET http://127.0.0.1:4010/large?bytes=3000000` | A bounded response view that explains what is shown. |

## 13. Saving, scripts, import, and backup

- **Save / Ctrl+S** stores your current request. The sidebar name updates after saving.
- **Scripts** lets you write a pre-request script and post-response tests. Imported scripts are disabled until you explicitly review and approve them.
- **Run** executes saved requests in a collection. Use this after you have at least two saved requests.
- **Import** always shows a preview before it changes your workspace.
- **Export** tells you what will be omitted. Secret values are never exported.
- **Backup** creates a portable local workspace backup; restoring shows a plan before it writes anything.

## Practice server addresses

| Service | Address |
| --- | --- |
| HTTP, WebSocket, SSE, GraphQL, OAuth | `127.0.0.1:4010` |
| HTTPS and secure WebSocket | `127.0.0.1:4011` |
| HTTP proxy / SOCKS5 proxy | `4012` / `4013` |
| Authenticated HTTP proxy / SOCKS5 proxy | `4014` / `4015` |

Stop the practice server with `Ctrl+C` in its terminal when you are finished.
