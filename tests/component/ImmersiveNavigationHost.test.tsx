import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImmersiveNavigationHost } from '@renderer/layout/ImmersiveNavigationHost';
import { IMMERSIVE_NAVIGATION_REVEAL_EVENT } from '@renderer/lib/immersiveNavigation';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderHost({ edgeRevealDisabled = false }: { edgeRevealDisabled?: boolean } = {}) {
  const result = render(
    <ImmersiveNavigationHost edgeRevealDisabled={edgeRevealDisabled}>
      <nav aria-label="Primary navigation">
        <button type="button">Projects</button>
        <button type="button">Project Atlas</button>
      </nav>
    </ImmersiveNavigationHost>
  );
  const edge = screen.getByRole('button', { name: 'Show navigation' });
  const navigation = result.container.querySelector<HTMLElement>('.immersive-navigation');
  if (!navigation) throw new Error('Expected immersive navigation host to render.');
  return { edge, navigation };
}

describe('ImmersiveNavigationHost', () => {
  it('reveals the project rail after a deliberate edge dwell', () => {
    vi.useFakeTimers();
    const { edge, navigation } = renderHost();

    expect(navigation).toHaveAttribute('aria-hidden', 'true');
    expect(navigation).toHaveAttribute('inert');

    fireEvent.pointerEnter(edge);

    act(() => vi.advanceTimersByTime(149));
    expect(navigation).not.toHaveClass('is-revealed');

    act(() => vi.advanceTimersByTime(1));

    expect(navigation).toHaveClass('is-revealed');
    expect(navigation).toHaveAttribute('aria-hidden', 'false');
    expect(navigation).not.toHaveAttribute('inert');
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
  });

  it('hides 350ms after the pointer leaves the navigation surface', () => {
    vi.useFakeTimers();
    const { edge, navigation } = renderHost();

    fireEvent.pointerEnter(edge);
    act(() => vi.advanceTimersByTime(150));
    fireEvent.pointerLeave(edge);
    fireEvent.pointerEnter(navigation);
    fireEvent.pointerLeave(navigation);

    act(() => vi.advanceTimersByTime(349));
    expect(navigation).toHaveClass('is-revealed');

    act(() => vi.advanceTimersByTime(1));
    expect(navigation).not.toHaveClass('is-revealed');
  });

  it('cancels a pending hide while the pointer crosses from the edge into navigation', () => {
    vi.useFakeTimers();
    const { edge, navigation } = renderHost();

    fireEvent.pointerEnter(edge);
    act(() => vi.advanceTimersByTime(150));
    fireEvent.pointerLeave(edge);
    fireEvent.pointerEnter(navigation);

    act(() => vi.advanceTimersByTime(350));
    expect(navigation).toHaveClass('is-revealed');
  });

  it('requires the pointer to re-arm inside the workspace after hiding', () => {
    vi.useFakeTimers();
    const { edge, navigation } = renderHost();
    const workspace = navigation.parentElement?.parentElement;
    if (!workspace) throw new Error('Expected the host to have a workspace parent.');

    fireEvent.pointerEnter(edge);
    act(() => vi.advanceTimersByTime(150));
    fireEvent.pointerLeave(edge);
    fireEvent.pointerEnter(navigation);
    fireEvent.pointerLeave(navigation);
    act(() => vi.advanceTimersByTime(350));
    expect(navigation).not.toHaveClass('is-revealed');

    fireEvent.pointerEnter(edge);
    act(() => vi.advanceTimersByTime(150));
    expect(navigation).not.toHaveClass('is-revealed');

    fireEvent.pointerLeave(edge);
    act(() =>
      workspace.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 24 }))
    );
    fireEvent.pointerEnter(edge);
    act(() => vi.advanceTimersByTime(150));
    expect(navigation).toHaveClass('is-revealed');
  });

  it('protects Files from edge hover while preserving the deliberate reveal control', () => {
    vi.useFakeTimers();
    const { edge, navigation } = renderHost({ edgeRevealDisabled: true });

    expect(edge).toBeDisabled();
    fireEvent.pointerEnter(edge);
    act(() => vi.advanceTimersByTime(150));
    expect(navigation).not.toHaveClass('is-revealed');

    act(() => window.dispatchEvent(new Event(IMMERSIVE_NAVIGATION_REVEAL_EVENT)));
    expect(navigation).toHaveClass('is-revealed');
  });

  it('hides after a pointer exit even when a clicked navigation item retains focus', () => {
    vi.useFakeTimers();
    const { edge, navigation } = renderHost();

    fireEvent.focus(edge);
    const project = screen.getByRole('button', { name: 'Project Atlas' });
    fireEvent.focus(project);
    fireEvent.pointerEnter(navigation);
    fireEvent.pointerLeave(navigation);

    act(() => vi.advanceTimersByTime(350));
    expect(navigation).not.toHaveClass('is-revealed');
  });
});
