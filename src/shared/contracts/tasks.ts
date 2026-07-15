import type { PackageManager } from './projects';

export type TaskKind = 'long-running' | 'one-shot';

export type DiscoveredTask = {
  id: string;
  name: string;
  label: string;
  command: string;
  args: string[];
  kind: TaskKind;
  packageManager?: PackageManager;
};

export type ProjectTasks = {
  projectId: string;
  tasks: DiscoveredTask[];
};

export type RunTaskRequest = {
  projectId: string;
  taskId: string;
};
