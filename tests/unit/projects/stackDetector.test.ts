import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectStack } from '@main/projects/StackDetector';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bureau-detect-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, name), content);
}

describe('detectStack', () => {
  it('detects a Node project with scripts and package manager', async () => {
    await write('package.json', JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }));
    await write('pnpm-lock.yaml', '');
    const result = await detectStack(dir);
    expect(result.stack).toContain('node');
    expect(result.packageManager).toBe('pnpm');
    const ids = result.suggestedProcesses.map((p) => p.id);
    expect(ids).toContain('dev');
    expect(ids).toContain('build');
    const dev = result.suggestedProcesses.find((p) => p.id === 'dev');
    expect(dev?.command).toBe('pnpm');
    expect(dev?.args).toEqual(['run', 'dev']);
  });

  it('surfaces a release script ahead of lower-priority ones, and never auto-runs it', async () => {
    // Ordered so `release` would fall outside the cap on package.json order alone; it must be
    // pulled in by NODE_SCRIPT_PRIORITY rather than by where the key happens to sit.
    const scripts: Record<string, string> = { start: 'x', lint: 'x' };
    for (let i = 0; i < 12; i += 1) scripts[`filler${i}`] = 'x';
    scripts.release = 'npm run release:patch && git push origin main --follow-tags';
    await write('package.json', JSON.stringify({ scripts }));

    const result = await detectStack(dir);
    const release = result.suggestedProcesses.find((p) => p.id === 'release');
    expect(release).toBeDefined();
    expect(release?.args).toEqual(['run', 'release']);
    // A release pushes to a remote — it must never fire on open or restart itself.
    expect(release?.runOnOpen).toBe(false);
    expect(release?.autoRestart).toBe(false);
  });

  it('defaults package manager to npm without a lockfile', async () => {
    await write('package.json', JSON.stringify({ scripts: { start: 'node .' } }));
    const result = await detectStack(dir);
    expect(result.packageManager).toBe('npm');
  });

  it('warns on malformed package.json but still marks node', async () => {
    await write('package.json', '{ not valid json');
    const result = await detectStack(dir);
    expect(result.stack).toContain('node');
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.suggestedProcesses).toHaveLength(0);
  });

  it('detects React Native from declared dependencies', async () => {
    await write(
      'package.json',
      JSON.stringify({
        dependencies: { 'react-native': '0.84.0' },
        scripts: { start: 'react-native start', android: 'react-native run-android' },
      })
    );
    const result = await detectStack(dir);
    expect(result.stack).toEqual(['node', 'react-native']);
    expect(result.suggestedProcesses.map((process) => process.id)).toEqual(['start', 'android']);
  });

  it('detects Flutter and Python and Django', async () => {
    await write('pubspec.yaml', 'name: app');
    const flutter = await detectStack(dir);
    expect(flutter.stack).toContain('flutter');
    expect(flutter.suggestedProcesses.map((p) => p.id)).toContain('flutter-run');

    await fs.rm(path.join(dir, 'pubspec.yaml'));
    await write('manage.py', '');
    await write('requirements.txt', '');
    const python = await detectStack(dir);
    expect(python.stack).toContain('python');
    expect(python.suggestedProcesses.map((p) => p.id)).toContain('django-runserver');
  });

  it('detects a native Android project from a root Gradle wrapper and manifest', async () => {
    await write('gradlew', '#!/bin/sh');
    await write('gradlew.bat', '@echo off');
    await write('settings.gradle.kts', 'rootProject.name = "app"');
    await fs.mkdir(path.join(dir, 'app', 'src', 'main'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'),
      '<manifest/>'
    );
    const result = await detectStack(dir);
    expect(result.stack).toContain('android');
    const ids = result.suggestedProcesses.map((p) => p.id);
    expect(ids).toContain('android-install-debug');
    expect(ids).toContain('android-assemble-debug');
    const install = result.suggestedProcesses.find((p) => p.id === 'android-install-debug');
    expect(install?.args).toEqual(['installDebug']);
  });

  it('does not tag a React Native project (nested android/) as native Android', async () => {
    await write(
      'package.json',
      JSON.stringify({ dependencies: { 'react-native': '0.84.0' }, scripts: { start: 'rn' } })
    );
    // RN keeps its Gradle wrapper under android/, not at the project root.
    await fs.mkdir(path.join(dir, 'android', 'app', 'src', 'main'), { recursive: true });
    await fs.writeFile(path.join(dir, 'android', 'gradlew'), '#!/bin/sh');
    await fs.writeFile(
      path.join(dir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      '<manifest/>'
    );
    const result = await detectStack(dir);
    expect(result.stack).toContain('react-native');
    expect(result.stack).not.toContain('android');
  });

  it('detects Rust, Go, and .NET with standard run/build/test commands', async () => {
    await write('Cargo.toml', '[package]\nname = "x"');
    const rust = await detectStack(dir);
    expect(rust.stack).toContain('rust');
    expect(rust.suggestedProcesses.map((p) => p.id)).toEqual(
      expect.arrayContaining(['cargo-run', 'cargo-build', 'cargo-test'])
    );

    await fs.rm(path.join(dir, 'Cargo.toml'));
    await write('go.mod', 'module x');
    const go = await detectStack(dir);
    expect(go.stack).toContain('go');
    expect(go.suggestedProcesses.find((p) => p.id === 'go-run')?.args).toEqual(['run', '.']);

    await fs.rm(path.join(dir, 'go.mod'));
    await write('App.csproj', '<Project/>');
    const dotnet = await detectStack(dir);
    expect(dotnet.stack).toContain('dotnet');
    expect(dotnet.suggestedProcesses.map((p) => p.id)).toContain('dotnet-run');
  });

  it('detects a non-Android Gradle project as JVM, not android', async () => {
    await write('build.gradle.kts', 'plugins { id("java") }');
    await write('gradlew', '#!/bin/sh');
    const result = await detectStack(dir);
    expect(result.stack).toContain('java');
    expect(result.stack).not.toContain('android');
    expect(result.suggestedProcesses.map((p) => p.id)).toEqual(
      expect.arrayContaining(['gradle-build', 'gradle-test'])
    );
  });

  it('detects task runners: Docker Compose, Makefile, and justfile targets', async () => {
    await write('compose.yaml', 'services: {}');
    await write('Makefile', 'build:\n\tgo build\ndeploy:\n\techo hi\ntest:\n\tgo test\n');
    await write('justfile', 'dev:\n    echo dev\n');
    const result = await detectStack(dir);
    expect(result.stack).toContain('docker');
    const ids = result.suggestedProcesses.map((p) => p.id);
    expect(ids).toContain('docker-compose-up');
    // Only the common targets are surfaced (deploy is not in the conservative set).
    expect(ids).toContain('make-build');
    expect(ids).toContain('make-test');
    expect(ids).not.toContain('make-deploy');
    expect(ids).toContain('just-dev');
  });

  it('treats a bare index.html as a static site', async () => {
    await write('index.html', '<!doctype html>');
    const result = await detectStack(dir);
    expect(result.stack).toEqual(['static']);
  });

  it('returns an empty stack for an unrecognized folder', async () => {
    const result = await detectStack(dir);
    expect(result.stack).toEqual([]);
    expect(result.suggestedProcesses).toEqual([]);
  });
});
