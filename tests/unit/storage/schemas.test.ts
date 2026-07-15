import { describe, it, expect } from 'vitest';
import {
  createDefaultSettings,
  settingsFileToPublic,
  validateProjectCatalogue,
  validateSettings,
} from '@main/storage/schemas';
import { settingsPatchSchema } from '@shared/validation/requests';

describe('validateSettings', () => {
  it('returns defaults for an empty object', () => {
    const settings = validateSettings({});
    expect(settings.appearance.theme).toBe('dark');
    expect(settings.appearance.density).toBe('compact');
    expect(settings.appearance.immersiveMode).toBe(false);
    expect(settings.layout.paneWidths).toMatchObject({ files: 340, commit: 280 });
    expect(settings.android).toMatchObject({
      reactNativeMetroPort: 8081,
      reactNativeAutoReverse: true,
    });
    expect(settings.schemaVersion).toBe(1);
  });

  it('deep-merges partial sections over defaults', () => {
    const settings = validateSettings({ appearance: { theme: 'light' } });
    expect(settings.appearance.theme).toBe('light');
    // Unspecified keys fall back to defaults.
    expect(settings.appearance.density).toBe('compact');
    expect(settings.appearance.accentColor).toBe('#7c9cff');
  });

  it('normalizes an invalid accent color to the default', () => {
    const settings = validateSettings({ appearance: { accentColor: 'not-a-color' } });
    expect(settings.appearance.accentColor).toBe('#7c9cff');
  });

  it('silently removes retired immersive tuning fields from v1 settings', () => {
    const settings = validateSettings({
      appearance: {
        immersiveMode: true,
        immersiveRevealDelayMs: 300,
        immersiveEdgeWidthPx: 8,
      },
    });

    expect(settings.appearance).toEqual({
      theme: 'dark',
      density: 'compact',
      accentColor: '#7c9cff',
      immersiveMode: true,
    });
  });

  it('silently removes the retired workspace sidebar width from v1 settings', () => {
    const settings = validateSettings({ layout: { sidebarWidth: 320 } });

    expect(settings.layout).toEqual({
      paneWidths: { files: 340, commit: 280, filesExplorer: 280 },
    });
  });
});

describe('settingsPatchSchema', () => {
  it('rejects retired immersive tuning fields', () => {
    expect(
      settingsPatchSchema.safeParse({ appearance: { immersiveRevealDelayMs: 300 } }).success
    ).toBe(false);
    expect(
      settingsPatchSchema.safeParse({ appearance: { immersiveEdgeWidthPx: 8 } }).success
    ).toBe(false);
  });

  it('rejects the retired workspace sidebar width', () => {
    expect(settingsPatchSchema.safeParse({ layout: { sidebarWidth: 220 } }).success).toBe(false);
  });
});

describe('settingsFileToPublic', () => {
  it('strips file-only fields', () => {
    const file = createDefaultSettings();
    const publicSettings = settingsFileToPublic(file) as Record<string, unknown>;
    expect('updatedAt' in publicSettings).toBe(false);
    expect(publicSettings.appearance).toBeDefined();
  });
});

describe('validateProjectCatalogue', () => {
  it('rejects duplicate project ids', () => {
    const dup = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      projects: [
        makeProject('11111111-1111-4111-8111-111111111111', '/a'),
        makeProject('11111111-1111-4111-8111-111111111111', '/b'),
      ],
    };
    expect(() => validateProjectCatalogue(dup)).toThrow();
  });

  it('accepts a valid catalogue', () => {
    const value = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      projects: [
        {
          ...makeProject('22222222-2222-4222-8222-222222222222', '/a'),
          stack: ['node', 'react-native'],
        },
      ],
    };
    expect(validateProjectCatalogue(value).projects).toHaveLength(1);
  });
});

function makeProject(projectId: string, path: string) {
  return {
    projectId,
    name: 'demo',
    path,
    canonicalPath: path,
    stack: ['node'],
    addedAt: new Date().toISOString(),
    configPresent: false,
  };
}
