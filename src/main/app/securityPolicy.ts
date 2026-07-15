import { BrowserWindow, session } from 'electron';

export function configureSecurityPolicy(mainWindow: BrowserWindow, devServerUrl?: string): void {
  // Deny all unexpected navigation inside the window.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isApplicationUrl(url, devServerUrl)) {
      event.preventDefault();
    }
  });

  // Deny all new-window creation.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Restrictive CSP for renderer content. Development needs Vite's inline
  // React-refresh preamble and websocket connection.
  const csp = createContentSecurityPolicy(devServerUrl);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function createContentSecurityPolicy(devServerUrl?: string): string {
  if (process.env.NODE_ENV === 'development') {
    const devOrigin = devServerUrl ? new URL(devServerUrl).origin : 'http://localhost:5173';
    const wsOrigin = devOrigin.replace(/^http/, 'ws');
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      `connect-src 'self' ${devOrigin} ${wsOrigin}`,
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ');
  }

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function isApplicationUrl(url: string, devServerUrl?: string): boolean {
  if (process.env.NODE_ENV === 'development') {
    return url.startsWith(devServerUrl ?? 'http://localhost:5173');
  }
  return url.startsWith('file://');
}
