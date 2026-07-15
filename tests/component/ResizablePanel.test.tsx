import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ResizablePanel } from '@renderer/components/ResizablePanel';

const originalPointerEvent = window.PointerEvent;

beforeAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: MouseEvent,
  });
});

afterAll(() => {
  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: originalPointerEvent,
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ResizablePanel', () => {
  it('drags, clamps against the sibling minimum, and commits the final width', () => {
    const onSizeCommit = vi.fn();
    render(
      <div>
        <ResizablePanel
          axis="horizontal"
          defaultSize={240}
          minSize={160}
          maxSize={520}
          minSiblingSize={300}
          storageKey="test-sidebar"
          resizeLabel="Resize test sidebar"
          onSizeCommit={onSizeCommit}
        >
          <div>Sidebar</div>
        </ResizablePanel>
      </div>
    );

    const handle = screen.getByRole('separator', { name: 'Resize test sidebar' });
    const panel = handle.parentElement as HTMLDivElement;
    Object.defineProperty(panel.parentElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 700, height: 500, top: 0, left: 0, right: 700, bottom: 500 }),
    });
    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(handle, 'releasePointerCapture', { value: vi.fn() });

    fireEvent.pointerDown(handle, { button: 0, pointerId: 4, clientX: 240 });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 700 });
    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 700 });

    expect(handle).toHaveAttribute('aria-valuenow', '399');
    expect(panel.style.getPropertyValue('--resizable-panel-size')).toBe('399px');
    expect(onSizeCommit).toHaveBeenCalledWith(399);
    expect(window.localStorage.getItem('bureau:panel-size:test-sidebar')).toBe('399');
  });

  it('supports keyboard resizing and restores the default on double-click', () => {
    const onSizeCommit = vi.fn();
    render(
      <ResizablePanel
        axis="vertical"
        edge="start"
        defaultSize={320}
        minSize={140}
        maxSize={640}
        storageKey="test-output"
        resizeLabel="Resize process output"
        onSizeCommit={onSizeCommit}
      >
        <div>Output</div>
      </ResizablePanel>
    );

    const handle = screen.getByRole('separator', { name: 'Resize process output' });
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');

    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(handle).toHaveAttribute('aria-valuenow', '308');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle).toHaveAttribute('aria-valuenow', '140');
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '320');
    expect(onSizeCommit).toHaveBeenLastCalledWith(320);
  });

  it('restores a committed size after the panel remounts', () => {
    const firstRender = render(
      <ResizablePanel
        axis="horizontal"
        defaultSize={240}
        minSize={160}
        maxSize={520}
        storageKey="session-sidebar"
        resizeLabel="Resize persisted sidebar"
      >
        <div>Sidebar</div>
      </ResizablePanel>
    );
    const firstHandle = screen.getByRole('separator', { name: 'Resize persisted sidebar' });

    fireEvent.keyDown(firstHandle, { key: 'ArrowRight', shiftKey: true });
    expect(firstHandle).toHaveAttribute('aria-valuenow', '288');
    expect(window.localStorage.getItem('bureau:panel-size:session-sidebar')).toBe('288');

    firstRender.unmount();
    render(
      <ResizablePanel
        axis="horizontal"
        defaultSize={240}
        minSize={160}
        maxSize={520}
        storageKey="session-sidebar"
        resizeLabel="Resize persisted sidebar"
      >
        <div>Sidebar</div>
      </ResizablePanel>
    );

    const restoredHandle = screen.getByRole('separator', { name: 'Resize persisted sidebar' });
    expect(restoredHandle).toHaveAttribute('aria-valuenow', '288');
    expect(restoredHandle.parentElement).toHaveStyle('--resizable-panel-size: 288px');
  });
});
