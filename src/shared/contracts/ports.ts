export type PortOwner = 'bureau' | 'system' | 'unknown';

export type ListeningPort = {
  port: number;
  protocol: 'tcp' | 'udp';
  address: string;
  pid: number | null;
  processName: string | null;
  owner: PortOwner;
  conflict: boolean;
};

export type ProjectPorts = {
  projectId: string;
  ports: ListeningPort[];
  scannedAt: string;
};

export type KillPortRequest = {
  pid: number;
  port: number;
};
