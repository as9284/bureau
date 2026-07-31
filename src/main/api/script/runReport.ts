import type { ApiRunReport } from '@shared/contracts/apiWorkbench';

/**
 * Run report serialisation.
 *
 * Both formats are built from the in-memory report, which has already been through the sandbox's
 * redactor — so a report cannot reintroduce a secret that the console and assertion messages had
 * stripped. Neither format carries request or response bodies: a run report is a test result, not
 * a capture (HAR export is the tool for that, and it says so before writing).
 */

export function runReportToJson(report: ApiRunReport): string {
  return `${JSON.stringify(
    {
      format: 'bureau-api-run',
      version: 1,
      runId: report.runId,
      status: report.status,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      environment: report.environmentName,
      dataFile: report.dataFileName,
      iterations: report.iterations,
      plannedItems: report.plannedItems,
      scriptsEnabled: report.scriptsEnabled,
      stoppedOnFailure: report.stoppedOnFailure,
      totals: report.totals,
      items: report.items.map((item) => ({
        name: item.name,
        iteration: item.iteration,
        method: item.method,
        url: item.url,
        status: item.status,
        ok: item.ok,
        totalMs: item.totalMs,
        errorCode: item.errorCode,
        errorMessage: item.errorMessage,
        tests: item.tests,
        scripts: item.scripts.map((outcome) => ({
          phase: outcome.phase,
          holder: outcome.holder.name,
          ok: outcome.ok,
          durationMs: outcome.durationMs,
          consoleDropped: outcome.consoleDropped,
          console: outcome.console,
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
        })),
      })),
    },
    null,
    2
  )}\n`;
}

/**
 * A control character other than tab, newline, or carriage return is not representable in XML
 * 1.0, and one stray byte makes CI reject the whole file — so they are stripped, not escaped.
 */
function stripControlCharacters(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) {
      out += value[i];
      continue;
    }
    if (code <= 0x1f || code === 0x7f) continue;
    out += value[i];
  }
  return out;
}

function xmlEscape(value: string): string {
  return stripControlCharacters(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * JUnit-style XML, the format CI systems already read. One `<testsuite>` per run item so a failed
 * request and its failed assertions stay attributable to the same request and iteration.
 */
export function runReportToJUnit(report: ApiRunReport): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const totalTests = report.totals.assertions + report.totals.failedRequests;
  lines.push(
    `<testsuites name="${xmlEscape(`Bureau API run ${report.runId}`)}" tests="${totalTests}" ` +
      `failures="${report.totals.failedAssertions + report.totals.failedRequests}" ` +
      `time="${(report.totals.totalMs / 1000).toFixed(3)}">`
  );

  for (const item of report.items) {
    const name = `${item.name} (iteration ${item.iteration})`;
    const failures = item.tests.filter((test) => !test.passed).length + (item.ok ? 0 : 1);
    lines.push(
      `  <testsuite name="${xmlEscape(name)}" tests="${item.tests.length || 1}" ` +
        `failures="${failures}" time="${(item.totalMs / 1000).toFixed(3)}">`
    );
    if (item.errorCode) {
      lines.push(`    <testcase name="${xmlEscape(`${item.method} ${item.url}`)}" classname="request">`);
      lines.push(
        `      <failure type="${xmlEscape(item.errorCode)}">${xmlEscape(item.errorMessage ?? '')}</failure>`
      );
      lines.push('    </testcase>');
    } else {
      // A request with no assertions still needs one passing case, or the suite looks empty.
      if (item.tests.length === 0) {
        lines.push(
          `    <testcase name="${xmlEscape(`${item.method} ${item.url} → ${item.status ?? 0}`)}" classname="request" />`
        );
      }
      for (const test of item.tests) {
        if (test.passed) {
          lines.push(`    <testcase name="${xmlEscape(test.name)}" classname="assertion" />`);
          continue;
        }
        lines.push(`    <testcase name="${xmlEscape(test.name)}" classname="assertion">`);
        lines.push(
          `      <failure type="assertion">${xmlEscape(test.message ?? 'The assertion failed.')}</failure>`
        );
        lines.push('    </testcase>');
      }
    }
    // JUnit has no field for the request itself, so the request line goes in system-out. Without
    // it a report of passing assertions would not say which URL was actually called.
    const consoleText = [
      `${item.method} ${item.url} → ${item.status ?? 0} (${item.totalMs} ms)`,
      ...item.scripts.flatMap((outcome) =>
        outcome.console.map((entry) => `[${outcome.phase}] ${entry.text}`)
      ),
    ].join('\n');
    lines.push(`    <system-out>${xmlEscape(consoleText)}</system-out>`);
    lines.push('  </testsuite>');
  }

  lines.push('</testsuites>');
  return `${lines.join('\n')}\n`;
}
