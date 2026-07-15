export type AppUpdateState =
  | { kind: 'disabled'; currentVersion: string }
  | { kind: 'idle'; currentVersion: string }
  | { kind: 'checking'; currentVersion: string }
  | { kind: 'available'; currentVersion: string }
  | { kind: 'downloaded'; currentVersion: string; availableVersion: string }
  | { kind: 'error'; currentVersion: string };
