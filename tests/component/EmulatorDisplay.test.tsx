import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmulatorDisplay } from '@renderer/features/android/EmulatorDisplay';
import type { AndroidAvd, EmulatorDisplayEvent } from '@shared/contracts/android';
import type { BureauApiV1 } from '@shared/contracts/api';

const runningAvd: AndroidAvd = {
  name: 'Pixel_8',
  state: 'running',
  serial: 'emulator-5554',
  booted: true,
  grpcPort: 8554,
};

let displayListener: ((event: EmulatorDisplayEvent) => void) | null = null;
let startDisplay: ReturnType<typeof vi.fn>;
let stopDisplay: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // jsdom lacks ResizeObserver, which the display pane uses to follow panel resizes.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  displayListener = null;
  startDisplay = vi.fn(async () => ({ ok: true as const }));
  stopDisplay = vi.fn(async () => ({ ok: true as const }));
  const android = {
    startDisplay,
    stopDisplay,
    sendDisplayMouse: vi.fn(async () => ({ ok: true as const })),
    sendDisplayKey: vi.fn(async () => ({ ok: true as const })),
    pressDisplayButton: vi.fn(async () => ({ ok: true as const })),
    rotateDevice: vi.fn(async () => ({ ok: true as const })),
    pasteToDevice: vi.fn(async () => ({ ok: true as const })),
    saveScreenshot: vi.fn(async () => ({ path: null })),
    listSnapshots: vi.fn(async () => ({ deviceId: 'emulator-5554', snapshots: [] })),
    saveSnapshot: vi.fn(async () => ({ ok: true as const })),
    loadSnapshot: vi.fn(async () => ({ ok: true as const })),
    sendGeoFix: vi.fn(async () => ({ ok: true as const })),
    onDisplay: vi.fn((listener: (event: EmulatorDisplayEvent) => void) => {
      displayListener = listener;
      return () => {
        displayListener = null;
      };
    }),
  };
  Object.defineProperty(window, 'bureau', {
    configurable: true,
    value: { android } as unknown as BureauApiV1,
  });
});

afterEach(cleanup);

describe('EmulatorDisplay', () => {
  it('shows an empty state when no emulator is live', () => {
    render(<EmulatorDisplay avd={null} onPopOut={() => undefined} />);
    expect(screen.getByText('No running emulator')).toBeInTheDocument();
    expect(startDisplay).not.toHaveBeenCalled();
  });

  it('explains when a running emulator has no control port', () => {
    render(<EmulatorDisplay avd={{ ...runningAvd, grpcPort: null }} onPopOut={() => undefined} />);
    expect(screen.getByText('Embedded display unavailable')).toBeInTheDocument();
    expect(startDisplay).not.toHaveBeenCalled();
  });

  it('starts the stream for a streamable emulator and shows the connecting state', async () => {
    render(<EmulatorDisplay avd={runningAvd} onPopOut={() => undefined} />);
    expect(await screen.findByText(/Connecting to Pixel_8/)).toBeInTheDocument();
    expect(startDisplay).toHaveBeenCalledWith(expect.objectContaining({ avdName: 'Pixel_8' }));
    const request = startDisplay.mock.calls[0][0] as { width: number; height: number };
    expect(request.width).toBeGreaterThanOrEqual(16);
    expect(request.height).toBeGreaterThanOrEqual(16);
  });

  it('surfaces stream errors with a retry action', async () => {
    render(<EmulatorDisplay avd={runningAvd} onPopOut={() => undefined} />);
    await screen.findByText(/Connecting to Pixel_8/);
    act(() => {
      displayListener?.({
        avdName: 'Pixel_8',
        state: 'error',
        deviceWidth: null,
        deviceHeight: null,
        error: 'stream reset',
      });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('stream reset');
    startDisplay.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(startDisplay).toHaveBeenCalledTimes(1);
  });

  it('offers the pop-out action for a live emulator', async () => {
    const onPopOut = vi.fn();
    render(<EmulatorDisplay avd={runningAvd} onPopOut={onPopOut} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open in separate window' }));
    expect(onPopOut).toHaveBeenCalledWith(runningAvd);
  });

  it('toggles immersive mode and exits it with Escape', async () => {
    render(<EmulatorDisplay avd={runningAvd} onPopOut={() => undefined} />);
    await screen.findByText(/Connecting to Pixel_8/);
    const pane = document.querySelector('.emulator-pane');
    expect(pane).not.toHaveClass('emulator-pane--immersive');

    await userEvent.click(screen.getByRole('button', { name: 'Immersive mode' }));
    expect(pane).toHaveClass('emulator-pane--immersive');
    expect(screen.getByRole('button', { name: 'Exit immersive mode' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(pane).not.toHaveClass('emulator-pane--immersive');
    expect(screen.getByRole('button', { name: 'Immersive mode' })).toBeInTheDocument();
  });

  it('stops the stream on unmount', async () => {
    const view = render(<EmulatorDisplay avd={runningAvd} onPopOut={() => undefined} />);
    await screen.findByText(/Connecting to Pixel_8/);
    view.unmount();
    expect(stopDisplay).toHaveBeenCalledWith({ avdName: 'Pixel_8' });
  });
});
