import { useCallback, useEffect, useState } from 'react';
import type { GiteaStatus } from '@shared/contracts/gitea';

export type GiteaConnection = {
  /** Undefined until the first status lands — render a loading state. */
  status?: GiteaStatus;
  hostUrl: string;
  setHostUrl: (value: string) => void;
  token: string;
  setToken: (value: string) => void;
  busy: boolean;
  error?: string;
  setError: (value?: string) => void;
  connected: boolean;
  canConnect: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};

/**
 * Shared by the publish dialog and the Git settings section — both need the same
 * connect/disconnect flow against the single stored Gitea connection.
 *
 * `active` gates the status request so a mounted-but-closed dialog does not hit
 * the instance on every render of its parent.
 */
export function useGiteaConnection(active: boolean): GiteaConnection {
  const [status, setStatus] = useState<GiteaStatus>();
  const [hostUrl, setHostUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!active) return;
    let live = true;
    setStatus(undefined);
    setToken('');
    setError(undefined);
    window.bureau.gitea
      .getStatus()
      .then((next) => {
        if (!live) return;
        setStatus(next);
        setHostUrl(next.hostUrl ?? '');
        // A stored-but-unusable connection (revoked token, host down) explains
        // itself here rather than failing later at publish time.
        if (next.configured && !next.authenticated && next.error) setError(next.error);
      })
      .catch((cause) => live && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      live = false;
    };
  }, [active]);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await window.bureau.gitea.connect({
        hostUrl: hostUrl.trim(),
        token: token.trim(),
      });
      setStatus(next);
      setHostUrl(next.hostUrl ?? hostUrl.trim());
      // Main holds the encrypted copy; drop the renderer's plaintext immediately.
      setToken('');
      if (!next.authenticated) setError(next.error ?? 'Could not connect to Gitea.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [hostUrl, token]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      setStatus(await window.bureau.gitea.disconnect());
      setToken('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    hostUrl,
    setHostUrl,
    token,
    setToken,
    busy,
    error,
    setError,
    connected: Boolean(status?.authenticated),
    canConnect: Boolean(hostUrl.trim() && token.trim() && !busy),
    connect,
    disconnect,
  };
}
