import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAppStore } from '@renderer/store/appStore';
import { OnboardingOverlay } from '@renderer/components/OnboardingOverlay';

afterEach(() => {
  cleanup();
  useAppStore.setState({ onboardingOpen: false });
});

describe('OnboardingOverlay', () => {
  it('renders nothing until onboarding is open', () => {
    const { container } = render(<OnboardingOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it('walks the tour and stamps the version on finish', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn();
    useAppStore.setState({ onboardingOpen: true, updateSettings });
    render(<OnboardingOverlay />);

    expect(screen.getByText('Welcome to Bureau')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    await user.click(screen.getByRole('button', { name: 'Get started' }));

    expect(useAppStore.getState().onboardingOpen).toBe(false);
    // No capabilities set in this harness, so the fallback version is stamped.
    expect(updateSettings).toHaveBeenCalledWith({ onboarding: { completedVersion: '0.0.0' } });
  });

  it('skips and still stamps the version', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn();
    useAppStore.setState({ onboardingOpen: true, updateSettings });
    render(<OnboardingOverlay />);

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(useAppStore.getState().onboardingOpen).toBe(false);
    expect(updateSettings).toHaveBeenCalledOnce();
  });
});
