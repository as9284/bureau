import { useEffect, useState, type ReactNode } from 'react';
import { RocketLaunchIcon } from '@phosphor-icons/react/RocketLaunch';
import { PlayCircleIcon } from '@phosphor-icons/react/PlayCircle';
import { BrowserIcon } from '@phosphor-icons/react/Browser';
import { FolderIcon } from '@phosphor-icons/react/Folder';
import { GitBranchIcon } from '@phosphor-icons/react/GitBranch';
import { useAppStore } from '../store/appStore';
import { Button } from './Button';

type Step = { icon: ReactNode; title: string; body: string };

const STEPS: Step[] = [
  {
    icon: <RocketLaunchIcon size={40} />,
    title: 'Welcome to Bureau',
    body: 'Your local-first mission control for running, previewing, and shipping software projects.',
  },
  {
    icon: <PlayCircleIcon size={40} />,
    title: 'Run and monitor',
    body: 'Start, watch, and safely stop dev servers and runtimes from the Processes tab — with live logs, metrics, and tree-kill.',
  },
  {
    icon: <BrowserIcon size={40} />,
    title: 'A real preview',
    body: 'Preview localhost like a browser: device emulation with true DPR and user-agents, network throttling, and an in-app console.',
  },
  {
    icon: <FolderIcon size={40} />,
    title: 'Files and docs',
    body: 'A secure explorer with a code editor and the Monocle Markdown reader — search, drafts, and conflict-safe saves.',
  },
  {
    icon: <GitBranchIcon size={40} />,
    title: 'Git, built in',
    body: 'A full Git workbench lives in each project. Press Ctrl/Cmd + K anytime to jump to any project, tab, or command.',
  },
];

export function OnboardingOverlay() {
  const open = useAppStore((s) => s.onboardingOpen);
  const complete = useAppStore((s) => s.completeOnboarding);
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
        <div className="onboarding__dots" aria-hidden>
          {STEPS.map((item, index) => (
            <span
              key={item.title}
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
