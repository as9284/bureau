import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { AndroidLogo } from '@phosphor-icons/react/AndroidLogo';
import { ArrowClockwise } from '@phosphor-icons/react/ArrowClockwise';
import { DeviceMobileCamera } from '@phosphor-icons/react/DeviceMobileCamera';
import { DownloadSimple } from '@phosphor-icons/react/DownloadSimple';
import { FileArrowUp } from '@phosphor-icons/react/FileArrowUp';
import { Play } from '@phosphor-icons/react/Play';
import { Stop } from '@phosphor-icons/react/Stop';
import { Trash } from '@phosphor-icons/react/Trash';
import type {
  AndroidAvd,
  AndroidOverview,
  EmulatorGpuMode,
  LogcatFilter,
  LogcatLine,
  LogcatPriority,
  ReactNativeProjectStatus,
} from '@shared/contracts/android';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Dropdown } from '../../components/Dropdown';
import { IconButton } from '../../components/IconButton';
import { ResizablePanel } from '../../components/ResizablePanel';
import { TextField } from '../../components/TextField';
import { useModalDismiss } from '../../lib/useModalDismiss';
import { useAppStore } from '../../store/appStore';
import { errorHeading, toError } from '../../lib/error';
import { EmulatorDisplay } from './EmulatorDisplay';

const EMPTY_FILTER: LogcatFilter = { priority: 'V', tag: '', packageName: '', regex: '' };
const PRIORITIES: LogcatPriority[] = ['V', 'D', 'I', 'W', 'E', 'F', 'S'];

export function AndroidPanel({ projectId }: { projectId: string }) {
  const project = useAppStore((state) =>
    state.projects.find((item) => item.projectId === projectId)
  );
  const settings = useAppStore((state) => state.settings);
  const pushToast = useAppStore((state) => state.pushToast);
  const loadProcesses = useAppStore((state) => state.loadProcesses);
  const workspace = useAppStore((state) => state.androidByProject[projectId]);
  const setAndroidWorkspace = useAppStore((state) => state.setAndroidWorkspace);
  const [overview, setOverview] = useState<AndroidOverview | null>(() => workspace?.overview ?? null);
  const [loading, setLoading] = useState(() => !workspace?.overview);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDevice, setSelectedDevice] = useState(() => workspace?.selectedDevice ?? '');
  const [startAvd, setStartAvd] = useState<AndroidAvd | null>(null);
  const [popOutAvd, setPopOutAvd] = useState<AndroidAvd | null>(null);
  const [apkPath, setApkPath] = useState(() => workspace?.apkPath ?? '');
  const [packageName, setPackageName] = useState(() => workspace?.packageName ?? '');
  const [activity, setActivity] = useState(() => workspace?.activity ?? '');
  const [packages, setPackages] = useState<string[]>(() => workspace?.packages ?? []);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [filter, setFilter] = useState<LogcatFilter>(
    () =>
      workspace?.filter ?? {
        ...EMPTY_FILTER,
        priority: settings?.android.defaultLogcatPriority ?? 'V',
        regex: settings?.android.defaultLogcatFilter ?? '',
      }
  );
  const [logcat, setLogcat] = useState<{ running: boolean; paused: boolean; lines: LogcatLine[] }>(
    () => workspace?.logcat ?? { running: false, paused: false, lines: [] }
  );
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const [bitrate, setBitrate] = useState(() => workspace?.bitrate ?? 8);
  const [maxSize, setMaxSize] = useState(() => workspace?.maxSize ?? 1920);
  const [recordPath, setRecordPath] = useState(() => workspace?.recordPath ?? '');
  const [reactNative, setReactNative] = useState<ReactNativeProjectStatus | null>(
    () => workspace?.reactNative ?? null
  );
  const [reactNativeError, setReactNativeError] = useState<string | null>(
    () => workspace?.reactNativeError ?? null
  );

  useEffect(() => {
    setAndroidWorkspace(projectId, {
      overview,
      selectedDevice,
      apkPath,
      packageName,
      activity,
      packages,
      filter,
      logcat,
      bitrate,
      maxSize,
      recordPath,
      reactNative,
      reactNativeError,
    });
  }, [
    activity,
    apkPath,
    bitrate,
    filter,
    logcat,
    maxSize,
    overview,
    packageName,
    packages,
    projectId,
    recordPath,
    reactNative,
    reactNativeError,
    selectedDevice,
    setAndroidWorkspace,
  ]);

  const shouldInspectReactNative = Boolean(
    project?.stack.includes('node') || project?.stack.includes('react-native')
  );

  const refreshReactNativeStatus = useCallback(async (): Promise<void> => {
    if (!shouldInspectReactNative) return;
    try {
      const status = await window.bureau.android.getReactNativeStatus({ projectId });
      setReactNative(status);
      setReactNativeError(null);
      if (status.packageName) setPackageName((current) => current || status.packageName || '');
    } catch (cause) {
      setReactNative(null);
      setReactNativeError(toError(cause, 'android.reactNative.status').message);
    }
  }, [projectId, shouldInspectReactNative]);

  const refresh = useCallback(
    async (silent = false): Promise<void> => {
      if (!silent) setLoading(true);
      if (!silent) setError(null);
      try {
        const next = await window.bureau.android.getOverview();
        setOverview(next);
        setSelectedDevice((current) => {
          if (current && next.devices.some((device) => device.id === current)) return current;
          return (
            next.devices.find((device) => device.state === 'device')?.id ??
            next.devices[0]?.id ??
            ''
          );
        });
        await refreshReactNativeStatus();
      } catch (cause) {
        if (!silent) setError(toError(cause, 'android.getOverview').message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [refreshReactNativeStatus]
  );

  useEffect(() => {
    void refresh();
    void window.bureau.android.getLogcatSnapshot().then((snapshot) => {
      setLogcat({ running: snapshot.running, paused: snapshot.paused, lines: snapshot.lines });
      if (snapshot.deviceId) setSelectedDevice(snapshot.deviceId);
    });
    const unsubscribe = window.bureau.android.onLogcat((event) => {
      setLogcat((current) => ({
        ...current,
        running: event.running,
        paused: event.running ? current.paused : false,
        lines: [...current.lines, ...event.lines].slice(-4000),
      }));
    });
    const poll = setInterval(() => void refresh(true), 5000);
    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [refresh]);

  const selected = overview?.devices.find((device) => device.id === selectedDevice);
  const deviceReady = selected?.state === 'device';
  // The embedded display follows the selected emulator, falling back to the
  // first live AVD so a single running emulator "just shows up".
  const liveAvds = overview?.avds.filter((avd) => avd.serial) ?? [];
  const displayAvd = liveAvds.find((avd) => avd.serial === selectedDevice) ?? liveAvds[0] ?? null;
  const defaultDetached = (settings?.android.emulatorDisplayMode ?? 'embedded') === 'window';

  async function perform(
    key: string,
    action: () => Promise<{ ok: boolean; error?: unknown }>,
    success?: string
  ) {
    setBusy(key);
    try {
      const result = await action();
      if (!result.ok) {
        const mapped = toError(result.error, key);
        pushToast('error', `${errorHeading(mapped)}: ${mapped.message}`);
        return false;
      }
      if (success) pushToast('success', success);
      return true;
    } catch (cause) {
      pushToast('error', toError(cause, key).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function chooseSdk() {
    setBusy('sdk');
    try {
      await window.bureau.android.chooseSdkPath();
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function chooseApk() {
    const result = await window.bureau.android.chooseApk();
    if (result.path) setApkPath(result.path);
  }

  function dropApk(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.apk')) {
      pushToast('error', 'Drop an .apk file here.');
      return;
    }
    const path = window.bureau.android.pathForFile(file);
    if (path) setApkPath(path);
  }

  async function installApk() {
    if (!apkPath) return;
    const okay = await perform(
      'android.apk.install',
      () =>
        window.bureau.android.installApk({
          deviceId: selectedDevice || undefined,
          apkPath,
          replace: true,
        }),
      'APK installed'
    );
    if (okay) await loadPackageList();
  }

  async function loadPackageList() {
    if (!deviceReady) return;
    setBusy('packages');
    try {
      const result = await window.bureau.android.listPackages({ deviceId: selectedDevice });
      setPackages(result.packages);
    } catch (cause) {
      pushToast('error', toError(cause, 'android.packages.list').message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleLogcat() {
    if (logcat.running) {
      await window.bureau.android.stopLogcat();
      setLogcat((current) => ({ ...current, running: false, paused: false }));
      return;
    }
    const okay = await perform('android.logcat.start', () =>
      window.bureau.android.startLogcat({ deviceId: selectedDevice || undefined, filter })
    );
    if (okay) setLogcat((current) => ({ ...current, running: true, paused: false, lines: [] }));
  }

  async function pauseLogcat() {
    const snapshot = await window.bureau.android.pauseLogcat({ paused: !logcat.paused });
    setLogcat({ running: snapshot.running, paused: snapshot.paused, lines: snapshot.lines });
  }

  async function clearLogcat() {
    const snapshot = await window.bureau.android.clearLogcat();
    setLogcat((current) => ({ ...current, lines: snapshot.lines }));
  }

  async function runReactNativeAction(
    key: string,
    action: () => Promise<{ ok: boolean; error?: unknown }>,
    success?: string
  ): Promise<void> {
    const okay = await perform(key, action, success);
    if (okay) await loadProcesses(projectId);
    await refreshReactNativeStatus();
  }

  if (loading && !overview) return <AndroidSkeleton />;

  return (
    <div className="android-panel">
      <header className="android-header">
        <div className="android-header__identity">
          <AndroidLogo size={22} weight="fill" />
          <div>
            <h1>Android</h1>
            <p className="mono">{overview?.sdk.sdkPath ?? 'SDK not detected'}</p>
          </div>
        </div>
        <div className="android-tool-status" aria-label="Android tool availability">
          <ToolStatus label="adb" available={Boolean(overview?.sdk.adb.available)} />
          <ToolStatus label="emulator" available={Boolean(overview?.sdk.emulator.available)} />
          <ToolStatus label="scrcpy" available={Boolean(overview?.sdk.scrcpy.available)} />
        </div>
        <Dropdown
          className="device-select"
          label="Android device"
          value={selectedDevice}
          options={[
            { value: '', label: 'Select device' },
            ...(overview?.devices.map((device) => ({
              value: device.id,
              label: `${device.model ?? device.avdName ?? device.id} (${device.state})`,
            })) ?? []),
          ]}
          onChange={setSelectedDevice}
        />
        <IconButton label="Refresh Android devices" onClick={() => void refresh()}>
          <ArrowClockwise size={17} />
        </IconButton>
      </header>

      {error && (
        <div className="android-banner error" role="alert">
          <span>{error}</span>
          <div className="android-action-row inline">
            <Button
              onClick={() =>
                void perform(
                  'android.adb.restart',
                  () => window.bureau.android.restartAdb(),
                  'ADB restarted'
                ).then(() => refresh())
              }
            >
              Restart ADB
            </Button>
            <Button onClick={() => void refresh()}>Retry</Button>
          </div>
        </div>
      )}
      {!overview?.sdk.sdkPath && (
        <div className="android-banner warning">
          <span>
            Android SDK not detected. Choose the SDK root containing platform-tools and emulator.
          </span>
          <Button variant="primary" disabled={busy === 'sdk'} onClick={() => void chooseSdk()}>
            Choose SDK
          </Button>
        </div>
      )}
      {selected && selected.state !== 'device' && (
        <div className="android-banner warning" role="alert">
          {selected.state === 'unauthorized'
            ? 'Accept the USB debugging prompt on the device.'
            : 'This device is offline. Reconnect it or restart ADB.'}
        </div>
      )}

      <div className="android-dashboard">
        <div className="android-dashboard__main">
        <ResizablePanel
          axis="vertical"
          className="android-dashboard__top-panel"
          defaultSize={300}
          minSize={220}
          maxSize={560}
          minSiblingSize={260}
          storageKey={`android-top-${projectId}`}
          resizeLabel="Resize Android tools and Logcat"
        >
          <div className="android-dashboard__top">
            <ResizablePanel
              axis="horizontal"
              className="android-dashboard__avd-panel"
              defaultSize={320}
              minSize={280}
              maxSize={520}
              minSiblingSize={360}
              storageKey={`android-avds-${projectId}`}
              resizeLabel="Resize virtual devices and device actions"
            >
              <section className="android-pane avd-pane" aria-labelledby="avd-title">
                <div className="android-pane__header">
                  <h2 id="avd-title">Virtual devices</h2>
                  <span>{overview?.avds.length ?? 0}</span>
                </div>
                <div className="avd-list">
                  {overview?.avds.length ? (
                    overview.avds.map((avd) => (
                      <div className="avd-row" key={avd.name}>
                        <span className={`android-state ${avd.state}`} aria-hidden />
                        <div className="avd-row__identity">
                          <strong>{avd.name}</strong>
                          <span>
                            {avd.target ??
                              (avd.apiLevel ? `API ${avd.apiLevel}` : 'Target unavailable')}
                          </span>
                        </div>
                        <span className="avd-row__state">{avd.state}</span>
                        {avd.state === 'stopped' || avd.state === 'error' ? (
                          <IconButton label={`Start ${avd.name}`} onClick={() => setStartAvd(avd)}>
                            <Play size={16} weight="fill" />
                          </IconButton>
                        ) : (
                          <IconButton
                            label={`Stop ${avd.name}`}
                            disabled={busy === `stop-${avd.name}`}
                            onClick={() =>
                              void perform(
                                `stop-${avd.name}`,
                                () =>
                                  window.bureau.android.stopAvd({
                                    name: avd.name,
                                    deviceId: avd.serial,
                                  }),
                                `${avd.name} stopped`
                              ).then(refresh)
                            }
                          >
                            <Stop size={16} weight="fill" />
                          </IconButton>
                        )}
                        {avd.error && <p className="avd-row__error">{avd.error}</p>}
                      </div>
                    ))
                  ) : (
                    <div className="android-empty">
                      <AndroidLogo size={30} />
                      <strong>No virtual devices</strong>
                      <span>
                        Create an AVD in Android Studio Device Manager or with avdmanager.
                      </span>
                    </div>
                  )}
                </div>
              </section>
            </ResizablePanel>

            <section className="android-pane device-pane" aria-labelledby="device-actions-title">
              <div className="android-pane__header">
                <h2 id="device-actions-title">Device actions</h2>
                <span>{selected?.type ?? 'none'}</span>
              </div>
              <div className="device-actions">
                <div
                  className="apk-dropzone"
                  role="button"
                  tabIndex={0}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={dropApk}
                  onClick={() => void chooseApk()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') void chooseApk();
                  }}
                >
                  <FileArrowUp size={22} />
                  <span>
                    {apkPath ? apkPath.split(/[\\/]/).pop() : 'Drop an APK or choose a file'}
                  </span>
                </div>
                <Button
                  variant="primary"
                  disabled={!deviceReady || !apkPath || busy === 'android.apk.install'}
                  onClick={() => void installApk()}
                >
                  <DownloadSimple size={16} />
                  Install
                </Button>
                <div className="android-fields two">
                  <label>
                    Package
                    <TextField
                      mono
                      value={packageName}
                      list="android-package-list"
                      onChange={(event) => setPackageName(event.target.value)}
                      placeholder="com.example.app"
                    />
                  </label>
                  <label>
                    Activity
                    <TextField
                      mono
                      value={activity}
                      onChange={(event) => setActivity(event.target.value)}
                      placeholder=".MainActivity (optional)"
                    />
                  </label>
                  <datalist id="android-package-list">
                    {packages.map((item) => (
                      <option value={item} key={item} />
                    ))}
                  </datalist>
                </div>
                <div className="android-action-row">
                  <Button
                    disabled={!deviceReady || !packageName}
                    onClick={() =>
                      void perform(
                        'android.apk.launch',
                        () =>
                          window.bureau.android.launchPackage({
                            deviceId: selectedDevice,
                            packageName,
                            activity: activity || undefined,
                          }),
                        'App launched'
                      )
                    }
                  >
                    <Play size={15} />
                    Launch
                  </Button>
                  <Button
                    disabled={!deviceReady || busy === 'packages'}
                    onClick={() => void loadPackageList()}
                  >
                    List packages
                  </Button>
                  <Button
                    disabled={!deviceReady || !packageName}
                    onClick={() => setConfirmUninstall(true)}
                  >
                    <Trash size={15} />
                    Uninstall
                  </Button>
                </div>
                <div className="android-action-row">
                  <Button
                    disabled={!deviceReady || !overview?.sdk.scrcpy.available}
                    onClick={() => setMirrorOpen((value) => !value)}
                  >
                    <DeviceMobileCamera size={16} />
                    Mirror
                  </Button>
                  {project?.stack.includes('flutter') && (
                    <Button
                      disabled={!deviceReady || !overview?.sdk.flutter.available}
                      onClick={() =>
                        void perform(
                          'android.flutter.run',
                          () =>
                            window.bureau.android.runFlutter({
                              projectId,
                              deviceId: selectedDevice,
                            }),
                          'Flutter process started'
                        ).then((okay) => {
                          if (okay) return loadProcesses(projectId);
                        })
                      }
                    >
                      Run Flutter here
                    </Button>
                  )}
                </div>
                {reactNative &&
                  (reactNative.detected || project?.stack.includes('react-native')) && (
                    <div className="react-native-tools" aria-label="React Native controls">
                      <div className="react-native-tools__header">
                        <div>
                          <strong>React Native</strong>
                          <span>
                            {reactNative.metroStatus === 'running'
                              ? `Metro running on :${reactNative.metroPort}`
                              : reactNative.metroStatus === 'starting'
                                ? `Metro starting on :${reactNative.metroPort}`
                                : `Metro idle on :${reactNative.metroPort}`}
                          </span>
                        </div>
                        <i
                          className={`android-state ${
                            reactNative.metroStatus === 'running'
                              ? 'running'
                              : reactNative.metroStatus === 'starting'
                                ? 'starting'
                                : ''
                          }`}
                          aria-hidden
                        />
                      </div>
                      {reactNative.reason ? (
                        <p className="react-native-tools__reason">{reactNative.reason}</p>
                      ) : (
                        <div className="android-action-row">
                          {reactNative.metroStatus === 'running' ||
                          reactNative.metroStatus === 'starting' ? (
                            <Button
                              disabled={busy === 'android.reactNative.metro.stop'}
                              onClick={() =>
                                void runReactNativeAction(
                                  'android.reactNative.metro.stop',
                                  () => window.bureau.android.stopReactNativeMetro({ projectId }),
                                  'Metro stopped'
                                )
                              }
                            >
                              <Stop size={15} weight="fill" />
                              Stop Metro
                            </Button>
                          ) : (
                            <Button
                              disabled={busy === 'android.reactNative.metro.start'}
                              onClick={() =>
                                void runReactNativeAction(
                                  'android.reactNative.metro.start',
                                  () => window.bureau.android.startReactNativeMetro({ projectId }),
                                  'Metro started'
                                )
                              }
                            >
                              <Play size={15} weight="fill" />
                              Start Metro
                            </Button>
                          )}
                          <Button
                            variant="primary"
                            disabled={
                              !deviceReady ||
                              reactNative.androidStatus === 'starting' ||
                              reactNative.androidStatus === 'running' ||
                              busy === 'android.reactNative.run'
                            }
                            onClick={() =>
                              void runReactNativeAction(
                                'android.reactNative.run',
                                () =>
                                  window.bureau.android.runReactNativeAndroid({
                                    projectId,
                                    deviceId: selectedDevice,
                                    port: reactNative.metroPort,
                                  }),
                                'React Native Android build started'
                              )
                            }
                          >
                            <Play size={15} weight="fill" />
                            Run Android
                          </Button>
                          <Button
                            disabled={!deviceReady}
                            onClick={() =>
                              void runReactNativeAction(
                                'android.reactNative.reverse',
                                () =>
                                  window.bureau.android.reverseReactNativePort({
                                    projectId,
                                    deviceId: selectedDevice,
                                    port: reactNative.metroPort,
                                  }),
                                `Port ${reactNative.metroPort} reversed`
                              )
                            }
                          >
                            Reverse port
                          </Button>
                          <Button
                            disabled={!deviceReady || !packageName}
                            onClick={() =>
                              void runReactNativeAction(
                                'android.reactNative.reload',
                                () =>
                                  window.bureau.android.reloadReactNative({
                                    projectId,
                                    deviceId: selectedDevice,
                                    packageName,
                                  }),
                                'JavaScript reloaded'
                              )
                            }
                          >
                            Reload JS
                          </Button>
                          <Button
                            disabled={!deviceReady}
                            onClick={() =>
                              void runReactNativeAction('android.reactNative.devMenu', () =>
                                window.bureau.android.openReactNativeDevMenu({
                                  projectId,
                                  deviceId: selectedDevice,
                                })
                              )
                            }
                          >
                            Dev menu
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                {reactNativeError && project?.stack.includes('react-native') && (
                  <div className="react-native-tools" role="alert">
                    <div className="react-native-tools__header">
                      <strong>React Native unavailable</strong>
                    </div>
                    <p className="react-native-tools__reason">{reactNativeError}</p>
                    <div className="android-action-row">
                      <Button onClick={() => void refreshReactNativeStatus()}>Retry</Button>
                    </div>
                  </div>
                )}
                {mirrorOpen && (
                  <div className="mirror-options">
                    <label>
                      Bitrate (Mbps)
                      <TextField
                        type="number"
                        min={1}
                        max={100}
                        value={bitrate}
                        onChange={(event) => setBitrate(Number(event.target.value))}
                      />
                    </label>
                    <label>
                      Max size
                      <TextField
                        type="number"
                        min={320}
                        max={8192}
                        value={maxSize}
                        onChange={(event) => setMaxSize(Number(event.target.value))}
                      />
                    </label>
                    <label>
                      Recording
                      <TextField
                        mono
                        readOnly
                        value={recordPath}
                        placeholder="Off"
                        onClick={async () => {
                          const result = await window.bureau.android.chooseRecordingPath();
                          if (result.path) setRecordPath(result.path);
                        }}
                      />
                    </label>
                    <Button
                      variant="primary"
                      disabled={!deviceReady}
                      onClick={() =>
                        void perform(
                          'android.scrcpy.start',
                          () =>
                            window.bureau.android.launchScrcpy({
                              deviceId: selectedDevice,
                              bitrateMbps: bitrate,
                              maxSize,
                              recordPath: recordPath || undefined,
                            }),
                          'Mirror started'
                        )
                      }
                    >
                      Start mirror
                    </Button>
                  </div>
                )}
              </div>
            </section>
          </div>
        </ResizablePanel>

        <section className="android-pane logcat-pane" aria-labelledby="logcat-title">
          <div className="android-pane__header">
            <h2 id="logcat-title">Logcat</h2>
            <span>{logcat.lines.length} lines</span>
          </div>
          <div className="logcat-filterbar">
            <TextField
              aria-label="Logcat tag filter"
              placeholder="Tag"
              value={filter.tag ?? ''}
              onChange={(event) =>
                setFilter((current) => ({ ...current, tag: event.target.value }))
              }
            />
            <Dropdown
              className="logcat-priority-select"
              label="Logcat priority"
              value={filter.priority}
              options={PRIORITIES.map((priority) => ({ value: priority, label: priority }))}
              onChange={(priority) =>
                setFilter((current) => ({
                  ...current,
                  priority,
                }))
              }
            />
            <TextField
              aria-label="Logcat package filter"
              placeholder="Package"
              value={filter.packageName ?? ''}
              onChange={(event) =>
                setFilter((current) => ({ ...current, packageName: event.target.value }))
              }
            />
            <TextField
              aria-label="Logcat regular expression"
              placeholder="Regex"
              value={filter.regex ?? ''}
              onChange={(event) =>
                setFilter((current) => ({ ...current, regex: event.target.value }))
              }
            />
            <Button
              variant={logcat.running ? 'secondary' : 'primary'}
              disabled={!deviceReady}
              onClick={() => void toggleLogcat()}
            >
              {logcat.running ? 'Stop' : 'Start'}
            </Button>
            <Button disabled={!logcat.running} onClick={() => void pauseLogcat()}>
              {logcat.paused ? 'Resume' : 'Pause'}
            </Button>
            <Button onClick={() => void clearLogcat()}>Clear</Button>
            <Button onClick={() => void window.bureau.android.exportLogcat()}>Export</Button>
          </div>
          <LogcatConsole lines={logcat.lines} paused={logcat.paused} />
        </section>
        </div>
        <ResizablePanel
          axis="horizontal"
          edge="start"
          className="android-dashboard__display-panel"
          defaultSize={380}
          minSize={280}
          maxSize={760}
          minSiblingSize={520}
          storageKey={`android-display-${projectId}`}
          resizeLabel="Resize emulator display"
        >
          <EmulatorDisplay avd={displayAvd} onPopOut={setPopOutAvd} />
        </ResizablePanel>
      </div>

      {startAvd && (
        <StartAvdDialog
          avd={startAvd}
          busy={busy === `start-${startAvd.name}`}
          defaultDetached={defaultDetached}
          onCancel={() => setStartAvd(null)}
          onStart={async (options) => {
            const okay = await perform(
              `start-${startAvd.name}`,
              () =>
                window.bureau.android.startAvd({
                  name: startAvd.name,
                  options,
                  confirmedWipe: options.wipeData,
                }),
              `${startAvd.name} starting`
            );
            if (okay) {
              setStartAvd(null);
              await refresh();
            }
          }}
        />
      )}
      {confirmUninstall && (
        <ConfirmDialog
          title="Uninstall package?"
          body={`This permanently removes ${packageName} and its app data from the selected device.`}
          confirmLabel="Uninstall"
          onCancel={() => setConfirmUninstall(false)}
          onConfirm={async () => {
            setConfirmUninstall(false);
            const okay = await perform(
              'android.apk.uninstall',
              () =>
                window.bureau.android.uninstallPackage({
                  deviceId: selectedDevice,
                  packageName,
                  confirmed: true,
                }),
              'Package uninstalled'
            );
            if (okay) {
              setPackageName('');
              await loadPackageList();
            }
          }}
        />
      )}
      {popOutAvd && (
        <ConfirmDialog
          title="Reopen in a separate window?"
          body={`${popOutAvd.name} will restart so its display moves to the emulator's own window. Unsaved app state on the device may be lost.`}
          confirmLabel="Restart in window"
          onCancel={() => setPopOutAvd(null)}
          onConfirm={async () => {
            const avd = popOutAvd;
            setPopOutAvd(null);
            const okay = await perform(
              `popout-${avd.name}`,
              async () => {
                const stopped = await window.bureau.android.stopAvd({
                  name: avd.name,
                  deviceId: avd.serial,
                });
                if (!stopped.ok) return stopped;
                // The AVD directory stays locked briefly after a kill; poll until the
                // device is really gone before relaunching (bounded, no fixed sleep).
                for (let attempt = 0; attempt < 20; attempt += 1) {
                  const view = await window.bureau.android.getOverview();
                  if (!view.avds.find((item) => item.name === avd.name)?.serial) break;
                  await new Promise((resolve) => setTimeout(resolve, 500));
                }
                return window.bureau.android.startAvd({
                  name: avd.name,
                  options: {
                    coldBoot: false,
                    wipeData: false,
                    gpu: 'auto',
                    writableSystem: false,
                    displayMode: 'window',
                  },
                  confirmedWipe: false,
                });
              },
              `${avd.name} reopening in its own window`
            );
            if (okay) await refresh();
          }}
        />
      )}
    </div>
  );
}

function ToolStatus({ label, available }: { label: string; available: boolean }) {
  return (
    <span className={available ? 'available' : 'missing'}>
      <i aria-hidden />
      {label}
    </span>
  );
}

function LogcatConsole({ lines, paused }: { lines: LogcatLine[]; paused: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  // Auto-scroll to the newest line while the view is pinned to the bottom; scrolling up
  // to read history releases the pin so incoming lines don't yank the view back down.
  useLayoutEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, follow]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  const jumpToBottom = (): void => {
    setFollow(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  return (
    <div className="logcat-view">
      <div
        ref={scrollRef}
        className="logcat-console"
        role="log"
        aria-label="Android logcat output"
        onScroll={onScroll}
      >
        {paused && <div className="logcat-paused">Paused</div>}
        {lines.length === 0 ? (
          <div className="logcat-empty">No logcat output yet.</div>
        ) : (
          lines.map((line) => (
            <div className={`logcat-line priority-${line.priority.toLowerCase()}`} key={line.seq}>
              <span className="logcat-time">{line.timestamp}</span>
              <span className="logcat-priority">{line.priority}</span>
              <span className="logcat-tag">{line.tag}</span>
              <span className="logcat-message">{line.message}</span>
            </div>
          ))
        )}
      </div>
      {!follow && (
        <button type="button" className="log-console__jump" onClick={jumpToBottom}>
          Jump to latest ↓
        </button>
      )}
    </div>
  );
}

function StartAvdDialog({
  avd,
  busy,
  defaultDetached,
  onCancel,
  onStart,
}: {
  avd: AndroidAvd;
  busy: boolean;
  defaultDetached: boolean;
  onCancel(): void;
  onStart(options: {
    coldBoot: boolean;
    wipeData: boolean;
    gpu: EmulatorGpuMode;
    dnsServer?: string;
    writableSystem: boolean;
    displayMode: 'embedded' | 'window';
  }): Promise<void>;
}) {
  const [coldBoot, setColdBoot] = useState(false);
  const [wipeData, setWipeData] = useState(false);
  const [gpu, setGpu] = useState<EmulatorGpuMode>('auto');
  const [dnsServer, setDnsServer] = useState('');
  const [writableSystem, setWritableSystem] = useState(false);
  const [detachedWindow, setDetachedWindow] = useState(defaultDetached);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDismiss(onCancel, dialogRef);
  return (
    <div className="overlay-root" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="dialog dialog--form android-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-avd-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="start-avd-title">Start {avd.name}</h2>
        </div>
        <div className="dialog__body android-options">
          <Checkbox
            checked={coldBoot}
            onChange={setColdBoot}
            label="Cold boot"
            description="Ignore the saved quick-boot snapshot."
          />
          <Checkbox
            checked={wipeData}
            onChange={setWipeData}
            label="Wipe data"
            description="Permanently reset this virtual device before starting it."
            tone="danger"
          />
          <label>
            GPU mode
            <Dropdown<EmulatorGpuMode>
              label="GPU mode"
              value={gpu}
              options={[
                { value: 'auto', label: 'Automatic' },
                { value: 'host', label: 'Host' },
                { value: 'swiftshader_indirect', label: 'SwiftShader' },
                { value: 'angle_indirect', label: 'ANGLE' },
                { value: 'off', label: 'Off' },
              ]}
              onChange={setGpu}
            />
          </label>
          <label>
            DNS server
            <TextField
              value={dnsServer}
              onChange={(event) => setDnsServer(event.target.value)}
              placeholder="Optional, for example 8.8.8.8"
            />
          </label>
          <Checkbox
            checked={writableSystem}
            onChange={setWritableSystem}
            label="Writable system"
            description="Start with a writable system image."
          />
          <Checkbox
            checked={detachedWindow}
            onChange={setDetachedWindow}
            label="Separate window"
            description="Show the emulator in its own window instead of the embedded pane."
          />
        </div>
        <div className="dialog__footer">
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant={wipeData ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() =>
              void onStart({
                coldBoot,
                wipeData,
                gpu,
                dnsServer: dnsServer || undefined,
                writableSystem,
                displayMode: detachedWindow ? 'window' : 'embedded',
              })
            }
          >
            {busy ? 'Starting...' : wipeData ? 'Wipe and start' : 'Start'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel(): void;
  onConfirm(): Promise<void>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalDismiss(onCancel, dialogRef);
  return (
    <div className="overlay-root" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="dialog android-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="android-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="android-confirm-title">{title}</h2>
        </div>
        <div className="dialog__body">
          <p className="dialog__text">{body}</p>
        </div>
        <div className="dialog__footer">
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={() => void onConfirm()}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AndroidSkeleton() {
  return (
    <div className="android-panel android-skeleton" aria-label="Loading Android tools">
      <div />
      <div />
      <div />
    </div>
  );
}
