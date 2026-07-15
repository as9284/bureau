import { describe, it, expect } from 'vitest';
import {
  parseJsonObjectKeys,
  parseJustfileRecipes,
  parseMakefileTargets,
  parseProcfileEntries,
} from '@main/projects/commandParsers';

describe('parseMakefileTargets', () => {
  it('extracts targets and ignores variables, patterns, and phony declarations', () => {
    const make = [
      'CC = gcc',
      'CFLAGS := -O2',
      '.PHONY: build test',
      'build: deps',
      '\tgo build',
      'test:',
      '\tgo test',
      '%.o: %.c',
      'run: build',
    ].join('\n');
    expect(parseMakefileTargets(make)).toEqual(['build', 'test', 'run']);
  });
});

describe('parseJustfileRecipes', () => {
  it('extracts recipe names, ignoring assignments, settings, and bodies', () => {
    const just = [
      'set shell := ["bash", "-c"]',
      'version := "1.0"',
      'dev:',
      '    cargo watch',
      'build target="debug":',
      '    cargo build',
      '# a comment',
      'test:',
      '    cargo test',
    ].join('\n');
    expect(parseJustfileRecipes(just)).toEqual(['dev', 'build', 'test']);
  });
});

describe('parseProcfileEntries', () => {
  it('splits simple entries and skips shell-requiring ones', () => {
    const proc = [
      'web: node server.js --port 3000',
      'worker: python worker.py',
      'release: RAILS_ENV=production rake db:migrate', // env-prefixed → skip
      'logs: tail -f log | grep ERROR', // pipe → skip
    ].join('\n');
    expect(parseProcfileEntries(proc)).toEqual([
      { name: 'web', command: 'node', args: ['server.js', '--port', '3000'] },
      { name: 'worker', command: 'python', args: ['worker.py'] },
    ]);
  });
});

describe('parseJsonObjectKeys', () => {
  it('returns object keys of a field, or empty on missing/invalid', () => {
    expect(parseJsonObjectKeys('{"tasks":{"dev":"x","build":"y"}}', 'tasks')).toEqual([
      'dev',
      'build',
    ]);
    expect(parseJsonObjectKeys('{"tasks":[]}', 'tasks')).toEqual([]);
    expect(parseJsonObjectKeys('not json', 'tasks')).toEqual([]);
    expect(parseJsonObjectKeys('{}', 'scripts')).toEqual([]);
  });
});
