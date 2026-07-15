import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@renderer/store/appStore';
import { PreviewTab } from '@renderer/features/preview/PreviewTab';
import type { PreviewConsoleMessage } from '@shared/contracts/preview';

const MESSAGES: PreviewConsoleMessage[] = [
  { id: 1, level: 'error', text: 'Boom happened', source: 'http://localhost:3000/app.js', line: 10, at: '' },
  { id: 2, level: 'info', text: 'just fyi', source: '', line: 0, at: '' },
];

beforeEach(() => {
  // jsdom lacks ResizeObserver, which PreviewTab installs on the surface.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(window, 'bureau', {
    configurable: true,
    value: {
      preview: {
        setVisible: vi.fn(),
        setBounds: vi.fn(),
        onHotkey: vi.fn(() => () => undefined),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({
    previewConsole: [],
    previewConsoleOpen: false,
    previewUrl: null,
  });
  Reflect.deleteProperty(window, 'bureau');
});

describe('Preview in-app console', () => {
  it('streams messages and filters to errors only', async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      previewUrl: 'http://localhost:3000/',
      previewState: null,
      previewConsole: MESSAGES,
      previewConsoleOpen: true,
    });
    render(<PreviewTab />);

    expect(screen.getByText('Boom happened')).toBeInTheDocument();
    expect(screen.getByText('just fyi')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Errors only', pressed: false }));
    expect(screen.getByText('Boom happened')).toBeInTheDocument();
    expect(screen.queryByText('just fyi')).not.toBeInTheDocument();
  });

  it('clears the buffer and resets the native count', async () => {
    const clearConsole = vi.fn();
    (window.bureau as unknown as { preview: { clearConsole: unknown } }).preview.clearConsole =
      clearConsole;
    const user = userEvent.setup();
    useAppStore.setState({
      previewUrl: 'http://localhost:3000/',
      previewState: null,
      previewConsole: MESSAGES,
      previewConsoleOpen: true,
    });
    render(<PreviewTab />);

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(useAppStore.getState().previewConsole).toHaveLength(0);
    expect(clearConsole).toHaveBeenCalledOnce();
  });
});

describe('Preview toolbar', () => {
  it('does not expose network throttling', () => {
    useAppStore.setState({ previewUrl: 'http://localhost:3000/', previewState: null });
    render(<PreviewTab />);

    expect(screen.queryByRole('combobox', { name: 'Network throttling' })).not.toBeInTheDocument();
  });
});
