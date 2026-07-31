import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApiInterchangeNote, ApiRunDataSummary } from '@shared/contracts/apiWorkbench';
import type { NativeDialogAdapter } from '../../system/dialogAdapter';

/**
 * Iteration data for the collection runner.
 *
 * Rows stay in main: the renderer opens the picker by asking for it, gets a summary back, and
 * passes the `dataSetId` into the run config — the same shape as an import preview, and for the
 * same reason (a filesystem path never crosses IPC, and a large table never round-trips).
 */

export type RunDataSet = {
  summary: ApiRunDataSummary;
  rows: Array<Record<string, string>>;
  loadedAt: number;
};

/** Iteration data is a testing convenience, not a document; the cap is generous but finite. */
const MAX_DATA_BYTES = 16 * 1024 * 1024;
const MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 64 * 1024;
const MAX_SETS = 8;

const VARIABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * RFC 4180 CSV: double quotes, `""` escapes, embedded newlines, CRLF or LF. Written out rather
 * than pulled in because the surface is this small and the input is untrusted.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  // A leading BOM would otherwise become part of the first column name.
  if (text.charCodeAt(0) === 0xfeff) index = 1;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    // A trailing newline must not produce a spurious empty row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === '') {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endField();
      index += 1;
      continue;
    }
    if (char === '\r') {
      if (text[index + 1] === '\n') index += 1;
      endRow();
      index += 1;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

function cell(value: unknown): string | null {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.slice(0, MAX_CELL_LENGTH);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // Objects and arrays have no meaning as a variable value; the caller warns and drops them.
  return null;
}

export type ParsedRunData = {
  columns: string[];
  rows: Array<Record<string, string>>;
  warnings: ApiInterchangeNote[];
};

/**
 * Parses a JSON array-of-objects or a CSV with a header row into variable rows. Column names must
 * be valid variable identifiers — anything else could never be referenced from a template, so it is
 * dropped with a warning rather than silently carried.
 */
export function parseRunData(text: string, rowCap: number): ParsedRunData {
  const warnings: ApiInterchangeNote[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error('The data file is empty.');

  let table: Array<Record<string, string>>;
  let columns: string[];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error('The data file is not valid JSON.');
    }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const names: string[] = [];
    table = [];
    for (const [index, entry] of list.entries()) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        warnings.push({ code: 'row-skipped', message: 'A row that is not an object was skipped.', path: `[${index}]` });
        continue;
      }
      const row: Record<string, string> = {};
      for (const [key, value] of Object.entries(entry)) {
        if (!VARIABLE_NAME_RE.test(key)) {
          if (!warnings.some((note) => note.path === key)) {
            warnings.push({
              code: 'column-dropped',
              message: `\`${key}\` is not a valid variable name, so the column was dropped.`,
              path: key,
            });
          }
          continue;
        }
        const text2 = cell(value);
        if (text2 === null) {
          warnings.push({
            code: 'value-dropped',
            message: `\`${key}\` holds a structured value, which cannot be a variable.`,
            path: key,
          });
          continue;
        }
        if (names.length >= MAX_COLUMNS && !names.includes(key)) continue;
        if (!names.includes(key)) names.push(key);
        row[key] = text2;
      }
      table.push(row);
      if (table.length >= rowCap) break;
    }
    columns = names;
  } else {
    const grid = parseCsv(text);
    if (grid.length === 0) throw new Error('The CSV has no rows.');
    const header = grid[0];
    const keep: Array<{ index: number; name: string }> = [];
    for (const [index, raw] of header.entries()) {
      const name = raw.trim();
      if (!VARIABLE_NAME_RE.test(name)) {
        warnings.push({
          code: 'column-dropped',
          message: `Column \`${name || index + 1}\` is not a valid variable name, so it was dropped.`,
          path: name || String(index + 1),
        });
        continue;
      }
      if (keep.length >= MAX_COLUMNS) continue;
      keep.push({ index, name });
    }
    if (keep.length === 0) throw new Error('The CSV header has no usable variable names.');
    columns = keep.map((entry) => entry.name);
    table = [];
    for (const line of grid.slice(1)) {
      const row: Record<string, string> = {};
      for (const column of keep) row[column.name] = (line[column.index] ?? '').slice(0, MAX_CELL_LENGTH);
      table.push(row);
      if (table.length >= rowCap) break;
    }
  }

  if (table.length === 0) throw new Error('The data file has no usable rows.');
  return { columns, rows: table, warnings };
}

export type RunDataStore = {
  load(rowCap: number): Promise<
    { ok: true; data: RunDataSet | null } | { ok: false; code: string; message: string }
  >;
  get(dataSetId: string): RunDataSet | undefined;
  clear(dataSetId: string): void;
  dispose(): void;
};

export function createRunDataStore(dialog: NativeDialogAdapter): RunDataStore {
  const sets = new Map<string, RunDataSet>();

  return {
    async load(rowCap) {
      // The path comes from a main-owned picker; the renderer never supplies one.
      const chosen = await dialog.showOpenFileDialog({
        title: 'Choose iteration data',
        filters: [
          { name: 'Iteration data', extensions: ['json', 'csv', 'tsv', 'txt'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      // A cancelled picker is a no-op, not a failure.
      if (!chosen) return { ok: true, data: null };

      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(chosen);
      } catch {
        return { ok: false, code: 'API_IMPORT_INVALID', message: 'The data file could not be read.' };
      }
      if (stat.size > MAX_DATA_BYTES) {
        return {
          ok: false,
          code: 'API_IMPORT_LIMIT_EXCEEDED',
          message: `The data file is over the ${Math.round(MAX_DATA_BYTES / 1024 / 1024)} MiB limit.`,
        };
      }

      let content: string;
      try {
        content = await fs.readFile(chosen, 'utf8');
      } catch {
        return {
          ok: false,
          code: 'API_IMPORT_INVALID',
          message: 'The data file could not be read as text.',
        };
      }

      let parsed: ParsedRunData;
      try {
        parsed = parseRunData(content, rowCap);
      } catch (error) {
        return {
          ok: false,
          code: 'API_IMPORT_INVALID',
          message: error instanceof Error ? error.message : 'The data file could not be parsed.',
        };
      }

      const warnings = [...parsed.warnings];
      if (parsed.rows.length >= rowCap) {
        warnings.push({
          code: 'rows-truncated',
          message: `Only the first ${rowCap} rows were loaded.`,
        });
      }

      const dataSet: RunDataSet = {
        summary: {
          dataSetId: randomUUID(),
          // File name only — never the path.
          fileName: path.basename(chosen),
          rowCount: parsed.rows.length,
          columns: parsed.columns,
          warnings,
        },
        rows: parsed.rows,
        loadedAt: Date.now(),
      };

      // Oldest first, so a long session cannot accumulate abandoned tables.
      while (sets.size >= MAX_SETS) {
        const oldest = [...sets.values()].sort((a, b) => a.loadedAt - b.loadedAt)[0];
        sets.delete(oldest.summary.dataSetId);
      }
      sets.set(dataSet.summary.dataSetId, dataSet);
      return { ok: true, data: dataSet };
    },

    get(dataSetId) {
      return sets.get(dataSetId);
    },

    clear(dataSetId) {
      sets.delete(dataSetId);
    },

    dispose() {
      sets.clear();
    },
  };
}
