import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  detectSimpleRuntimeRows,
  parseComposerPhp,
  parseGemfileRuby,
  parseGlobalJson,
  parseGoMod,
  parseMixExsElixir,
  parsePackageJsonBun,
  parsePlainVersion,
  parseRustToolchain,
  parseSdkmanrc,
  parseSwiftToolsVersion,
  type RuntimeVersionProbe,
} from '@main/toolchains/simpleRuntimes';
import type { ProjectStack } from '@shared/contracts/projects';
import type { RuntimeRow } from '@shared/contracts/toolchains';

describe('simpleRuntimes parsers', () => {
  it('parses the go.mod go directive', () => {
    expect(parseGoMod('module example.com/x\n\ngo 1.22\n')).toBe('1.22');
    expect(parseGoMod('go 1.21.5\n')).toBe('1.21.5');
    expect(parseGoMod('module x\n')).toBeNull();
  });

  it('parses rust-toolchain in TOML and legacy plain forms', () => {
    expect(parseRustToolchain('[toolchain]\nchannel = "1.75.0"\n')).toBe('1.75.0');
    expect(parseRustToolchain('stable\n')).toBe('stable');
    expect(parseRustToolchain('[toolchain]\ncomponents = ["clippy"]\n')).toBeNull();
  });

  it('parses .sdkmanrc entries and drops the vendor suffix', () => {
    expect(parseSdkmanrc('java=21.0.1-tem\ngradle=8.5\n', 'java')).toBe('21.0.1');
    expect(parseSdkmanrc('java=17-open\n', 'java')).toBe('17');
    expect(parseSdkmanrc('gradle=8.5\n', 'java')).toBeNull();
  });

  it('parses global.json .NET SDK pins', () => {
    expect(parseGlobalJson('{"sdk":{"version":"8.0.100"}}')).toBe('8.0.100');
    expect(parseGlobalJson('{"sdk":{}}')).toBeNull();
    expect(parseGlobalJson('not json')).toBeNull();
  });

  it('parses composer require.php constraints', () => {
    expect(parseComposerPhp('{"require":{"php":">=8.1","ext-json":"*"}}')).toBe('>=8.1');
    expect(parseComposerPhp('{"require":{"ext-json":"*"}}')).toBeNull();
  });

  it('parses the Gemfile ruby declaration', () => {
    expect(parseGemfileRuby('source "https://rubygems.org"\nruby "3.2.0"\n')).toBe('3.2.0');
    expect(parseGemfileRuby("ruby '3.1.4'\n")).toBe('3.1.4');
    expect(parseGemfileRuby('gem "rails"\n')).toBeNull();
  });

  it('parses the bun pin from packageManager and engines', () => {
    expect(parsePackageJsonBun('{"packageManager":"bun@1.1.0"}')).toBe('1.1.0');
    expect(parsePackageJsonBun('{"engines":{"bun":">=1.0.0"}}')).toBe('>=1.0.0');
    expect(parsePackageJsonBun('{"packageManager":"pnpm@9"}')).toBeNull();
  });

  it('parses the Package.swift tools version header', () => {
    expect(parseSwiftToolsVersion('// swift-tools-version:5.9\nimport PackageDescription\n')).toBe(
      '5.9'
    );
    expect(parseSwiftToolsVersion('// swift-tools-version: 6.0.0\n')).toBe('6.0.0');
  });

  it('parses the elixir constraint from mix.exs', () => {
    expect(parseMixExsElixir('  def project do\n    [elixir: "~> 1.15",\n')).toBe('~> 1.15');
  });

  it('reads the first non-comment line, stripping a ruby- prefix', () => {
    expect(parsePlainVersion('# comment\n3.2.0\n')).toBe('3.2.0');
    expect(parsePlainVersion('ruby-3.1.4\n')).toBe('3.1.4');
    expect(parsePlainVersion('\n\n')).toBeNull();
  });
});

describe('detectSimpleRuntimeRows', () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // A probe that reports a fixed installed version for whichever executable is asked.
  const probeReturning =
    (output: string | null): RuntimeVersionProbe =>
    async () =>
      output;

  const rowFor = (rows: RuntimeRow[], kind: string) => rows.find((r) => r.kind === kind);

  it('surfaces a Go row when go.mod is present and reports the installed version', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bureau-sr-'));
    await writeFile(path.join(dir, 'go.mod'), 'module x\n\ngo 1.22\n');
    const rows = await detectSimpleRuntimeRows(
      dir,
      ['go'],
      {},
      probeReturning('go version go1.22.1 windows/amd64')
    );
    const go = rowFor(rows, 'go');
    expect(go).toBeDefined();
    expect(go?.expectedVersion).toBe('1.22');
    expect(go?.activeVersion).toBe('1.22.1');
    expect(go?.switchable).toBe(false);
    expect(go?.mismatch).toBe(false);
    expect(go?.missing).toBe(false);
  });

  it('is relevant via .tool-versions even without a marker file', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bureau-sr-'));
    const rows = await detectSimpleRuntimeRows(
      dir,
      [],
      { rust: '1.75.0' },
      probeReturning('rustc 1.75.0 (82e1608df 2023-12-21)')
    );
    const rust = rowFor(rows, 'rust');
    expect(rust?.expectedVersion).toBe('1.75.0');
    expect(rust?.activeVersion).toBe('1.75.0');
  });

  it('is relevant via a marker file (bun.lockb) with no stack tag', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bureau-sr-'));
    await writeFile(path.join(dir, 'bun.lockb'), '');
    const rows = await detectSimpleRuntimeRows(dir, [], {}, probeReturning('1.1.30'));
    expect(rowFor(rows, 'bun')?.activeVersion).toBe('1.1.30');
  });

  it('flags a mismatch when the installed version does not satisfy the pin', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bureau-sr-'));
    await writeFile(path.join(dir, 'go.mod'), 'module x\ngo 1.22\n');
    const rows = await detectSimpleRuntimeRows(dir, ['go'], {}, probeReturning('go version go1.20.0'));
    const go = rowFor(rows, 'go');
    expect(go?.mismatch).toBe(true);
    expect(go?.missing).toBe(false);
  });

  it('flags missing (with an install hint) when pinned but not installed', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bureau-sr-'));
    await writeFile(path.join(dir, 'go.mod'), 'module x\ngo 1.22\n');
    const rows = await detectSimpleRuntimeRows(dir, ['go'], {}, probeReturning(null));
    const go = rowFor(rows, 'go');
    expect(go?.missing).toBe(true);
    expect(go?.activeVersion).toBeNull();
    expect(go?.installHint).toBe('Install Go 1.22');
  });

  it('shows Dart for a pure-Dart pubspec but not for a Flutter one', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bureau-sr-'));
    await writeFile(
      path.join(dir, 'pubspec.yaml'),
      'environment:\n  sdk: ">=3.0.0 <4.0.0"\n'
    );
    const dartRows = await detectSimpleRuntimeRows(
      dir,
      ['flutter'],
      {},
      probeReturning('Dart SDK version: 3.4.1 (stable)')
    );
    expect(rowFor(dartRows, 'dart')?.activeVersion).toBe('3.4.1');

    await writeFile(
      path.join(dir, 'pubspec.yaml'),
      'environment:\n  sdk: ">=3.0.0 <4.0.0"\n  flutter: ">=3.13.0"\n'
    );
    const flutterRows = await detectSimpleRuntimeRows(dir, ['flutter'], {}, probeReturning('x'));
    expect(rowFor(flutterRows, 'dart')).toBeUndefined();
  });

  it('returns no rows when the project uses none of the runtimes', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bureau-sr-'));
    const stack: ProjectStack[] = ['node'];
    const rows = await detectSimpleRuntimeRows(dir, stack, {}, probeReturning('should-not-run'));
    expect(rows).toHaveLength(0);
  });
});
