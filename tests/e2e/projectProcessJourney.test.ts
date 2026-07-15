import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createAppServices, type AppBootstrap } from '@main/services/createAppServices';
import type { ProcessDefinition } from '@shared/contracts/projects';

let userData: string;
let projectDir: string;
let boot: AppBootstrap;

beforeEach(async () => {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-data-'));
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-e2e-proj-'));
  await fs.writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'demo', scripts: { dev: 'echo hi' } })
  );
  boot = await createAppServices(userData);
});

afterEach(async () => {
  await boot.supervisor.stopAll();
  await fs.rm(userData, { recursive: true, force: true });
  await fs.rm(projectDir, { recursive: true, force: true });
});

function waitFor(check: () => boolean, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (performance.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('waitFor timed out'));
      }
    }, 25);
  });
}

const serverDefinition: ProcessDefinition = {
  id: 'srv',
  label: 'Test server',
  command: process.execPath,
  args: ['-e', "console.log('up http://localhost:9911'); setInterval(() => {}, 1000);"],
  cwd: '.',
  env: {},
  runMode: 'log',
  autoRestart: false,
  runOnOpen: false,
};

describe('project + process journey (headless)', () => {
  it('adds a project, runs a process, streams logs, stops, and removes', async () => {
    const { services, supervisor } = boot;

    // Add project → detection writes .bureau/config.json with the npm script.
    const added = await services.projects.add({ path: projectDir });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const projectId = added.project!.projectId;

    const afterAdd = await services.projects.list();
    expect(afterAdd).toHaveLength(1);
    expect(afterAdd[0].stack).toContain('node');

    // The detected npm script should be present.
    const initial = await services.processes.list({ projectId });
    expect(initial.definitions.map((d) => d.id)).toContain('dev');

    // Add a deterministic node process and run it.
    await services.processes.saveDefinition({ projectId, definition: serverDefinition });
    const started = await services.processes.start({ projectId, processId: 'srv' });
    expect(started.ok).toBe(true);

    await waitFor(
      () =>
        supervisor.listRuntimes(projectId).find((r) => r.processId === 'srv')?.detectedUrl !==
        undefined
    );
    const runtime = supervisor.listRuntimes(projectId).find((r) => r.processId === 'srv');
    expect(runtime?.status).toBe('running');
    expect(runtime?.detectedUrl).toBe('http://localhost:9911');

    const log = await services.processes.getLog({ projectId, processId: 'srv' });
    expect(log.lines.some((l) => l.text.includes('up http://localhost:9911'))).toBe(true);

    await services.processes.stop({ projectId, processId: 'srv' });
    await waitFor(() => supervisor.runningCount() === 0);

    // Persisted config survives across a fresh bootstrap.
    const reboot = await createAppServices(userData);
    const persisted = await reboot.services.processes.list({ projectId });
    expect(persisted.definitions.map((d) => d.id)).toEqual(expect.arrayContaining(['dev', 'srv']));

    await services.projects.remove({ projectId });
    expect(await services.projects.list()).toHaveLength(0);
  });
});
