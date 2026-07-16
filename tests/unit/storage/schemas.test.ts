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

  it('defaults reduceMotion off and preserves an explicit opt-in', () => {
    expect(validateSettings({}).appearance.reduceMotion).toBe(false);
    expect(validateSettings({ appearance: { reduceMotion: true } }).appearance.reduceMotion).toBe(
      true
    );
    // Non-boolean junk falls back to the default rather than throwing away settings.
    expect(
      validateSettings({ appearance: { reduceMotion: 'yes' } }).appearance.reduceMotion
    ).toBe(false);
  });

  it('defaults the processes and preview groups and preserves overrides', () => {
    const defaults = validateSettings({});
    expect(defaults.processes).toEqual({ logBufferLines: 5000, maxCrashRestarts: 5 });
    expect(defaults.preview).toEqual({ defaultViewport: 'fill', captureConsole: true });

    const custom = validateSettings({
      processes: { maxCrashRestarts: 0 },
      preview: { defaultViewport: 'mobile', captureConsole: false },
    });
    // A partial group keeps the untouched key at its default.
    expect(custom.processes).toEqual({ logBufferLines: 5000, maxCrashRestarts: 0 });
    expect(custom.preview).toEqual({ defaultViewport: 'mobile', captureConsole: false });
  });

  it('defaults the embedded terminal and code editor settings', () => {
    const defaults = validateSettings({});
    expect(defaults.embeddedTerminal).toEqual({
      fontSize: 12,
      scrollback: 1000,
      cursorStyle: 'block',
    });
    expect(defaults.files.editorFontSize).toBe(13);
    expect(defaults.files.lineNumbers).toBe(true);

    const custom = validateSettings({
      embeddedTerminal: { fontSize: 14, cursorStyle: 'bar' },
      files: { lineNumbers: false },
    });
    expect(custom.embeddedTerminal).toEqual({
      fontSize: 14,
      scrollback: 1000,
      cursorStyle: 'bar',
    });
    expect(custom.files.lineNumbers).toBe(false);
    expect(custom.files.editorFontSize).toBe(13);
  });

  it('defaults uiScale to 100% and normalizes an unsupported scale', () => {
    expect(validateSettings({}).appearance.uiScale).toBe(1);
    expect(validateSettings({ appearance: { uiScale: 1.25 } }).appearance.uiScale).toBe(1.25);
    // An out-of-range or retired scale must not fail the whole settings parse.
    expect(validateSettings({ appearance: { uiScale: 3 } }).appearance.uiScale).toBe(1);
    expect(validateSettings({ appearance: { uiScale: 'big' } }).appearance.uiScale).toBe(1);
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
      reduceMotion: false,
      uiScale: 1,
    });
  });

  it('silently removes the retired workspace sidebar width from v1 settings', () => {
    const settings = validateSettings({ layout: { sidebarWidth: 320 } });

    expect(settings.layout).toEqual({
      paneWidths: { files: 340, commit: 280, filesExplorer: 280 },
    });
  });

  it('backfills onboarding.completedVersion=null for existing settings files', () => {
    // A pre-onboarding settings file has no `onboarding` section; the lenient
    // merge must supply the default so onboarding shows once for existing users.
    const settings = validateSettings({ appearance: { theme: 'light' } });
    expect(settings.onboarding).toEqual({ completedVersion: null });
  });

  it('preserves a stamped onboarding version', () => {
    const settings = validateSettings({ onboarding: { completedVersion: '1.0.4' } });
    expect(settings.onboarding.completedVersion).toBe('1.0.4');
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
  };
}
