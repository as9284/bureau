import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VariableField } from '@renderer/features/api/VariableField';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('VariableField', () => {
  it('cancels the deferred blur close when unmounted', () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <VariableField
        ariaLabel="URL"
        value="{{base"
        scope={new Map()}
        onChange={() => undefined}
      />
    );

    fireEvent.blur(screen.getByLabelText('URL'));
    unmount();

    // Without clearing the blur timer, this deferred setState would run after jsdom is gone and
    // surface as an unhandled `window is not defined` (exactly what failed CI on 1.1.2).
    expect(() => {
      vi.advanceTimersByTime(200);
    }).not.toThrow();
  });
});
