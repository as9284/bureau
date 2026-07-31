import '@testing-library/jest-dom/vitest';
import { createElement, type ChangeEvent } from 'react';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// xterm touches canvas at import time; jsdom has no real 2D context and dumps
// "Not implemented: HTMLCanvasElement.prototype.getContext" into stderr.
vi.mock('@renderer/components/XtermSurface', () => ({
  XtermSurface: () => createElement('div', { 'data-testid': 'xterm-surface' }),
}));

// CodeMirror measures DOM geometry that jsdom does not implement (getClientRects).
vi.mock('@renderer/features/files/CodeEditor', () => ({
  CodeEditor: ({
    value,
    onChange,
    readOnly,
    'aria-label': ariaLabel,
  }: {
    value: string;
    onChange(value: string): void;
    readOnly?: boolean;
    'aria-label'?: string;
  }) =>
    createElement('textarea', {
      'aria-label': ariaLabel,
      className: 'cm-editor-mock',
      value,
      readOnly,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    }),
}));

// Unmount every rendered tree after each test, globally. Without this, a file
// that forgets its own afterEach(cleanup) leaves DOM behind and the next test
// sees duplicate elements ("found multiple elements") — an order-dependent
// flake rather than a real failure. Files may still call cleanup themselves;
// it is idempotent.
afterEach(cleanup);
