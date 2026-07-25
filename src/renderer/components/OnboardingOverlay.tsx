import { useEffect, useState, type ReactNode } from 'react';
import { RocketLaunchIcon } from '@phosphor-icons/react/RocketLaunch';
import { PaletteIcon } from '@phosphor-icons/react/Palette';
import { TextAaIcon } from '@phosphor-icons/react/TextAa';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/SlidersHorizontal';
import { CheckCircleIcon } from '@phosphor-icons/react/CheckCircle';
import type {
  DensityPreference,
  StartupViewPreference,
  ThemePreference,
} from '@shared/contracts/settings';
import { UI_SCALES } from '@shared/contracts/settings';
import { useAppStore } from '../store/appStore';
import { AccentColorPicker } from './ColorPicker';
import { Button } from './Button';
import { Checkbox } from './Checkbox';

type StepId = 'welcome' | 'look' | 'layout' | 'prefs' | 'ready';

type Step = {
  id: StepId;
  icon: ReactNode;
  title: string;
  body: string;
};

const THEMES: ThemePreference[] = ['dark', 'light', 'system'];
const DENSITIES: DensityPreference[] = ['compact', 'comfortable'];
const STARTUP_VIEWS: StartupViewPreference[] = ['hub', 'lastOpened'];
const PRESET_ACCENTS = ['#7c9cff', '#6db87a', '#c9a24d', '#d46a6a', '#b98cff', '#4fb3c4'];

const STEPS: Step[] = [
  {
    id: 'welcome',
    icon: <RocketLaunchIcon size={36} />,
    title: 'Welcome to Bureau',
    body: 'Set up the look and a few defaults. Changes apply immediately — you can revisit anything in Settings.',
  },
  {
    id: 'look',
    icon: <PaletteIcon size={36} />,
    title: 'Look and feel',
    body: 'Pick a theme and accent. Bureau is dark-first; the accent drives highlights, focus, and selection.',
  },
  {
    id: 'layout',
    icon: <TextAaIcon size={36} />,
    title: 'Density and scale',
    body: 'Choose how compact the chrome feels and how large the interface should render.',
  },
  {
    id: 'prefs',
    icon: <SlidersHorizontalIcon size={36} />,
    title: 'Preferences',
    body: 'Startup view, motion, and whether Files restores your last session.',
  },
  {
    id: 'ready',
    icon: <CheckCircleIcon size={36} />,
    title: 'You are set',
    body: 'Add a project from the hub, open it, and use Ctrl/Cmd + K anytime to jump to a command or tab.',
  },
];

export function OnboardingOverlay() {
  const open = useAppStore((s) => s.onboardingOpen);
  const complete = useAppStore((s) => s.completeOnboarding);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') complete();
      else if (event.key === 'ArrowRight') setStep((s) => Math.min(STEPS.length - 1, s + 1));
      else if (event.key === 'ArrowLeft') setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, complete]);

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const appearance = settings?.appearance;
  const general = settings?.general;
  const files = settings?.files;
  const accent = appearance?.accentColor ?? PRESET_ACCENTS[0];
  const isCustomAccent = !PRESET_ACCENTS.includes(accent);

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <div className="onboarding__card">
        <button type="button" className="onboarding__skip" onClick={() => complete()}>
          Skip
        </button>
        <div className="onboarding__icon" aria-hidden>
          {current.icon}
        </div>
        <h2 id="onboarding-title" className="onboarding__title">
          {current.title}
        </h2>
        <p className="onboarding__body">{current.body}</p>

        {current.id === 'look' && appearance ? (
          <div className="onboarding__controls">
            <div className="onboarding__field">
              <div className="onboarding__field-label">Theme</div>
              <div className="segmented" role="group" aria-label="Theme">
                {THEMES.map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    className={appearance.theme === theme ? 'active' : ''}
                    onClick={() => void updateSettings({ appearance: { theme } })}
                  >
                    {theme}
                  </button>
                ))}
              </div>
            </div>
            <div className="onboarding__field">
              <div className="onboarding__field-label">Accent</div>
              <div className="accent-swatches">
                {PRESET_ACCENTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    aria-label={`Accent ${preset}`}
                    className={['accent-swatch', accent === preset ? 'active' : ''].join(' ')}
                    style={{ background: preset }}
                    onClick={() => void updateSettings({ appearance: { accentColor: preset } })}
                  />
                ))}
                <AccentColorPicker
                  value={accent}
                  isActive={isCustomAccent}
                  onChange={(hex) => void updateSettings({ appearance: { accentColor: hex } })}
                />
                <span className="accent-value mono">{accent}</span>
              </div>
            </div>
          </div>
        ) : null}

        {current.id === 'layout' && appearance ? (
          <div className="onboarding__controls">
            <div className="onboarding__field">
              <div className="onboarding__field-label">Density</div>
              <div className="segmented" role="group" aria-label="Density">
                {DENSITIES.map((density) => (
                  <button
                    key={density}
                    type="button"
                    className={appearance.density === density ? 'active' : ''}
                    onClick={() => void updateSettings({ appearance: { density } })}
                  >
                    {density}
                  </button>
                ))}
              </div>
            </div>
            <div className="onboarding__field">
              <div className="onboarding__field-label">Interface scale</div>
              <div className="segmented" role="group" aria-label="Interface scale">
                {UI_SCALES.map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    className={appearance.uiScale === scale ? 'active' : ''}
                    onClick={() => void updateSettings({ appearance: { uiScale: scale } })}
                  >
                    {Math.round(scale * 100)}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {current.id === 'prefs' && general ? (
          <div className="onboarding__controls">
            <div className="onboarding__field">
              <div className="onboarding__field-label">On startup</div>
              <div className="segmented" role="group" aria-label="On startup">
                {STARTUP_VIEWS.map((view) => (
                  <button
                    key={view}
                    type="button"
                    className={general.startupView === view ? 'active' : ''}
                    onClick={() => void updateSettings({ general: { startupView: view } })}
                  >
                    {view === 'hub' ? 'Hub' : 'Last opened'}
                  </button>
                ))}
              </div>
            </div>
            <div className="onboarding__field onboarding__field--checks">
              <Checkbox
                checked={appearance?.reduceMotion ?? false}
                onCheckedChange={(reduceMotion) => void updateSettings({ appearance: { reduceMotion } })}
                label="Always reduce motion"
              />
              <Checkbox
                checked={files?.restoreSession ?? true}
                onCheckedChange={(restoreSession) => void updateSettings({ files: { restoreSession } })}
                label="Restore open Files tabs"
              />
            </div>
          </div>
        ) : null}

        {current.id === 'ready' && appearance ? (
          <dl className="onboarding__summary">
            <div>
              <dt>Theme</dt>
              <dd>{appearance.theme}</dd>
            </div>
            <div>
              <dt>Accent</dt>
              <dd className="mono">{appearance.accentColor}</dd>
            </div>
            <div>
              <dt>Density</dt>
              <dd>{appearance.density}</dd>
            </div>
            <div>
              <dt>Scale</dt>
              <dd className="mono">{Math.round(appearance.uiScale * 100)}%</dd>
            </div>
            <div>
              <dt>Startup</dt>
              <dd>{general?.startupView === 'lastOpened' ? 'Last opened' : 'Hub'}</dd>
            </div>
          </dl>
        ) : null}

        <div className="onboarding__dots" aria-hidden>
          {STEPS.map((item, index) => (
            <span
              key={item.id}
              className={['onboarding__dot', index === step ? 'is-active' : '']
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </div>
        <div className="onboarding__actions">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </Button>
          {isLast ? (
            <Button variant="primary" onClick={() => complete()}>
              Get started
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
