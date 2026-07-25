import { describe, expect, it } from 'vitest';
import { ONBOARDING_TOUR_ID, shouldShowOnboarding } from '@shared/contracts/settings';

describe('shouldShowOnboarding', () => {
  it('shows for first-run and older stamps', () => {
    expect(shouldShowOnboarding(null)).toBe(true);
    expect(shouldShowOnboarding(undefined)).toBe(true);
    expect(shouldShowOnboarding('1.0.15')).toBe(true);
    expect(shouldShowOnboarding('0.0.0')).toBe(true);
  });

  it('hides only after the current tour id is stamped', () => {
    expect(shouldShowOnboarding(ONBOARDING_TOUR_ID)).toBe(false);
  });
});
