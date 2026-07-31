import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicSettings } from '@shared/contracts/settings';
import {
  DEFAULT_API_SETTINGS,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CONFIRMATION_SETTINGS,
  DEFAULT_FILES_SETTINGS,
  DEFAULT_GENERAL_SETTINGS,
  ONBOARDING_TOUR_ID,
} from '@shared/contracts/settings';
import { useAppStore } from '@renderer/store/appStore';
import { OnboardingOverlay } from '@renderer/components/OnboardingOverlay';

const SETTINGS: PublicSettings = {
  schemaVersion: 1,
  editor: { kind: 'none' },
  terminal: { kind: 'auto' },
  general: { ...DEFAULT_GENERAL_SETTINGS },
  appearance: { ...DEFAULT_APPEARANCE_SETTINGS },
  tools: { showOpenInEditor: true, showOpenInTerminal: true, showOpenInExplorer: true },
  layout: { paneWidths: { files: 340, commit: 280 } },
  notifications: { enabled: false, longRunningOnly: true },
  android: {
    defaultLogcatPriority: 'V',
    defaultLogcatFilter: '',
    reactNativeMetroPort: 8081,
    reactNativeAutoReverse: true,
    emulatorDisplayMode: 'embedded',
  },
  toolchains: {},
  processes: { logBufferLines: 5000, maxCrashRestarts: 5 },
  preview: { defaultViewport: 'fill', captureConsole: true },
  embeddedTerminal: { fontSize: 12, scrollback: 1000, cursorStyle: 'block' },
  git: {},
  gitBehavior: { pullStrategy: 'ff-only' },
  history: { commitLimit: 30 },
  confirmations: { ...DEFAULT_CONFIRMATION_SETTINGS },
  commit: { defaultSignOff: false, signingPreference: 'off' },
  api: { ...DEFAULT_API_SETTINGS },
  files: { ...DEFAULT_FILES_SETTINGS },
  onboarding: { completedVersion: null },
};

afterEach(() => {
  cleanup();
  useAppStore.setState({ onboardingOpen: false, settings: null });
});

describe('OnboardingOverlay', () => {
  it('renders nothing until onboarding is open', () => {
    const { container } = render(<OnboardingOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it('walks the interactive setup and stamps the tour id on finish', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ onboardingOpen: true, settings: SETTINGS, updateSettings });
    render(<OnboardingOverlay />);

    expect(screen.getByText('Welcome to Bureau')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Look and feel')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(updateSettings).toHaveBeenCalledWith({ appearance: { theme: 'light' } });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Density and scale')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Density' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Preferences')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'On startup' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('You are set')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Get started' }));

    expect(useAppStore.getState().onboardingOpen).toBe(false);
    expect(updateSettings).toHaveBeenCalledWith({
      onboarding: { completedVersion: ONBOARDING_TOUR_ID },
    });
  });

  it('skips and still stamps the tour id', async () => {
    const user = userEvent.setup();
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ onboardingOpen: true, settings: SETTINGS, updateSettings });
    render(<OnboardingOverlay />);

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(useAppStore.getState().onboardingOpen).toBe(false);
    expect(updateSettings).toHaveBeenCalledWith({
      onboarding: { completedVersion: ONBOARDING_TOUR_ID },
    });
  });
});
