import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { OkResult } from '@shared/contracts/errors';
import { toBureauError } from '../ipc/errors';

const CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;";

function resultError(operation: string, message: string): OkResult {
  return { ok: false, error: toBureauError({ code: 'FILE_MUTATION_FAILED', message, operation }) };
}

/** Visible for unit tests — wraps rendered Markdown in a CSP-locked document shell. */
export function wrapExportDocumentHtml(html: string): string {
  if (/<!doctype\s+html/i.test(html)) {
    const csp = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
    return /<head(?:\s[^>]*)?>/i.test(html)
      ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${csp}`)
      : html.replace(/<html(?:\s[^>]*)?>/i, (root) => `${root}<head><meta charset="utf-8">${csp}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"></head><body>${html}</body></html>`;
}

export function createDocumentExportService(dataPath: string) {
  const windows = new Set<BrowserWindow>();

  async function withWindow<T>(html: string, run: (window: BrowserWindow) => Promise<T>): Promise<T> {
    const temporaryPath = path.join(dataPath, `files-export-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
    await fs.writeFile(temporaryPath, wrapExportDocumentHtml(html), { encoding: 'utf8', mode: 0o600 });
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        webSecurity: true,
      },
    });
    windows.add(window);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    try {
      await window.loadFile(temporaryPath);
      return await run(window);
    } finally {
      windows.delete(window);
      if (!window.isDestroyed()) window.destroy();
      await fs.rm(temporaryPath, { force: true });
    }
  }

  async function exportHtml(html: string, suggestedName: string): Promise<OkResult> {
    const choice = await dialog.showSaveDialog({
      title: 'Export rendered Markdown as HTML',
      defaultPath: suggestedName.replace(/\.[^.]+$/, '') + '.html',
      filters: [{ name: 'HTML document', extensions: ['html'] }],
    });
    if (choice.canceled || !choice.filePath) return { ok: true };
    try {
      await fs.writeFile(choice.filePath, wrapExportDocumentHtml(html), 'utf8');
      return { ok: true };
    } catch { return resultError('files.exportHtml', 'The HTML export could not be written.'); }
  }

  async function exportPdf(html: string, suggestedName: string): Promise<OkResult> {
    const choice = await dialog.showSaveDialog({
      title: 'Export rendered Markdown as PDF',
      defaultPath: suggestedName.replace(/\.[^.]+$/, '') + '.pdf',
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    });
    if (choice.canceled || !choice.filePath) return { ok: true };
    try {
      const bytes = await withWindow(html, (window) => window.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true }));
      await fs.writeFile(choice.filePath, bytes);
      return { ok: true };
    } catch { return resultError('files.exportPdf', 'The PDF export could not be created.'); }
  }

  async function printDocument(html: string): Promise<OkResult> {
    try {
      return await withWindow(html, (window) => new Promise<OkResult>((resolve) => {
        window.webContents.print({ printBackground: true }, (success) => resolve(success ? { ok: true } : resultError('files.printDocument', 'The document was not printed.')));
      }));
    } catch { return resultError('files.printDocument', 'The print window could not be created.'); }
  }

  function dispose(): void {
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    windows.clear();
  }

  return { exportHtml, exportPdf, printDocument, dispose };
}
