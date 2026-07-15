// App window close / graceful shutdown IPC payloads (Bureau-specific).

export type ShutdownProcess = {
  projectId: string;
  processId: string;
  label: string;
};

export type CloseRequestedEvent = {
  processes: ShutdownProcess[];
  dirtyFiles?: number;
};

export type ShutdownBeginEvent = {
  processes: ShutdownProcess[];
};

export type ShutdownProgressEvent = {
  projectId: string;
  processId: string;
};
