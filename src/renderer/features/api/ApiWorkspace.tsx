import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@renderer/components/Button';
import { Dialog } from '@renderer/components/Dialog';
import { EmptyState } from '@renderer/components/EmptyState';
import { ResizablePanel } from '@renderer/components/ResizablePanel';
import { errorHeading } from '@renderer/lib/error';
import { parseAuxId, selectActiveApiSnapshot, useApiStore } from '@renderer/store/apiStore';
import { buildVariableScope } from './variablePreview';
import { useAppStore } from '@renderer/store/appStore';
import { API_SIDEBAR_DEFAULT_WIDTH, API_SIDEBAR_MAX_WIDTH, API_SIDEBAR_MIN_WIDTH } from '@shared/contracts/settings';
import { ApiDocumentTabs, type AuxTab } from './ApiDocumentTabs';
import { ApiSidebar } from './ApiSidebar';
import { CookiesEditor, EnvironmentEditor, SecretsEditor } from './ApiAuxEditor';
import { ApiConfirmDialog } from './ApiConfirmDialog';
import { ApiQuickOpen } from './ApiQuickOpen';
import { ApiShortcutsDialog } from './ApiShortcutsDialog';
import { ApiToolbar } from './ApiToolbar';
import { ExportDialog } from './ExportDialog';
import { ImportDialog } from './ImportDialog';
import { OAuthDialog } from './OAuthDialog';
import { RequestComposer } from './RequestComposer';
import { RunnerDialog } from './RunnerDialog';
import { ScriptApprovalDialog } from './ScriptApprovalDialog';
import { BackupDialog } from './BackupDialog';
import { ProxyProfileDialog } from './ProxyProfileDialog';
import { ResponseInspector } from './ResponseInspector';
import { StreamConsole } from './StreamConsole';
import { TlsProfileDialog } from './TlsProfileDialog';
import { CookieEditorDialog } from './CookieEditorDialog';
import type { ApiCookie } from '@shared/contracts/apiWorkbench';

const EMPTY_HISTORY_STATE = {
  loadState: 'idle' as const,
  items: [],
  error: null,
  generation: 0,
};

/** `null` means "create new"; a string edits that profile; `undefined` means the dialog is closed. */
type ProfileDialogTarget = string | null | undefined;

export function ApiWorkspace() {
  const loadState = useApiStore((s) => s.loadState);
  const workspaces = useApiStore((s) => s.workspaces);
  const error = useApiStore((s) => s.error);
  const activeWorkspaceId = useApiStore((s) => s.activeWorkspaceId);
  const workspaceSnapshots = useApiStore((s) => s.workspaceSnapshots);
  const documents = useApiStore((s) => s.documents);
  const openDocumentIds = useApiStore((s) => s.openDocumentIds);
  const activeRequestId = useApiStore((s) => s.activeRequestId);
  const openAuxIds = useApiStore((s) => s.openAuxIds);
  const activeAuxId = useApiStore((s) => s.activeAuxId);
  const sessions = useApiStore((s) => s.sessions);
  const histories = useApiStore((s) => s.histories);
  const secrets = useApiStore((s) => s.secrets);
  const secretStorageAvailable = useApiStore((s) => s.secretStorageAvailable);
  const sidebarMode = useApiStore((s) => s.sidebarMode);
  const activeEnvironmentId = useApiStore((s) => s.activeEnvironmentId);
  const relinkPickerOpen = useApiStore((s) => s.relinkPickerOpen);
  const graphqlSchemas = useApiStore((s) => s.graphqlSchemas);
  const introspecting = useApiStore((s) => s.introspecting);
  const introspectError = useApiStore((s) => s.introspectError);
  const oauthPhases = useApiStore((s) => s.oauthPhases);
  const importPreview = useApiStore((s) => s.importPreview);
  const importBusy = useApiStore((s) => s.importBusy);
  const importError = useApiStore((s) => s.importError);
  const importReport = useApiStore((s) => s.importReport);
  const exportPlan = useApiStore((s) => s.exportPlan);
  const exportBusy = useApiStore((s) => s.exportBusy);
  const exportError = useApiStore((s) => s.exportError);
  const runnerOpen = useApiStore((s) => s.runnerOpen);
  const runData = useApiStore((s) => s.runData);
  const runDataBusy = useApiStore((s) => s.runDataBusy);
  const activeRun = useApiStore((s) => s.activeRun);
  const runError = useApiStore((s) => s.runError);
  const scriptApproval = useApiStore((s) => s.scriptApproval);
  const scriptValidation = useApiStore((s) => s.scriptValidation);
  const cookieJars = useApiStore((s) => s.cookieJars);
  const activeCookieJarId = useApiStore((s) => s.activeCookieJarId);
  const cookies = useApiStore((s) => s.cookies);
  const cookiesLoading = useApiStore((s) => s.cookiesLoading);
  const restorePlan = useApiStore((s) => s.restorePlan);
  const restoreBusy = useApiStore((s) => s.restoreBusy);
  const restoreError = useApiStore((s) => s.restoreError);
  const restoreReport = useApiStore((s) => s.restoreReport);

  const loadWorkspaces = useApiStore((s) => s.loadWorkspaces);
  const createWorkspace = useApiStore((s) => s.createWorkspace);
  const setActiveWorkspace = useApiStore((s) => s.setActiveWorkspace);
  const setSidebarMode = useApiStore((s) => s.setSidebarMode);
  const setActiveEnvironment = useApiStore((s) => s.setActiveEnvironment);
  const setRelinkPickerOpen = useApiStore((s) => s.setRelinkPickerOpen);
  const relinkWorkspace = useApiStore((s) => s.relinkWorkspace);
  const removeWorkspaceLink = useApiStore((s) => s.removeWorkspaceLink);
  const refreshActiveWorkspace = useApiStore((s) => s.refreshActiveWorkspace);
  const loadHistory = useApiStore((s) => s.loadHistory);
  const createCollection = useApiStore((s) => s.createCollection);
  const createEnvironment = useApiStore((s) => s.createEnvironment);
  const updateEnvironment = useApiStore((s) => s.updateEnvironment);
  const deleteEnvironment = useApiStore((s) => s.deleteEnvironment);
  const openRequest = useApiStore((s) => s.openRequest);
  const closeRequest = useApiStore((s) => s.closeRequest);
  const setActiveRequest = useApiStore((s) => s.setActiveRequest);
  const openAuxDocument = useApiStore((s) => s.openAuxDocument);
  const closeAuxDocument = useApiStore((s) => s.closeAuxDocument);
  const setActiveAux = useApiStore((s) => s.setActiveAux);
  const gateApiConfirm = useApiStore((s) => s.gateApiConfirm);
  const updateDraft = useApiStore((s) => s.updateDraft);
  const saveRequest = useApiStore((s) => s.saveRequest);
  const sendRequest = useApiStore((s) => s.sendRequest);
  const cancelRequest = useApiStore((s) => s.cancelRequest);
  const openStream = useApiStore((s) => s.openStream);
  const closeStream = useApiStore((s) => s.closeStream);
  const sendStreamMessage = useApiStore((s) => s.sendStreamMessage);
  const setStreamPaused = useApiStore((s) => s.setStreamPaused);
  const clearStreamTranscript = useApiStore((s) => s.clearStreamTranscript);
  const introspectGraphql = useApiStore((s) => s.introspectGraphql);
  const saveSecret = useApiStore((s) => s.saveSecret);
  const deleteSecret = useApiStore((s) => s.deleteSecret);
  const saveTlsProfile = useApiStore((s) => s.saveTlsProfile);
  const saveOAuthProfile = useApiStore((s) => s.saveOAuthProfile);
  const authorizeOAuth = useApiStore((s) => s.authorizeOAuth);
  const cancelOAuth = useApiStore((s) => s.cancelOAuth);
  const clearOAuthToken = useApiStore((s) => s.clearOAuthToken);
  const inspectImport = useApiStore((s) => s.inspectImport);
  const commitImport = useApiStore((s) => s.commitImport);
  const cancelImport = useApiStore((s) => s.cancelImport);
  const clearImportReport = useApiStore((s) => s.clearImportReport);
  const planExport = useApiStore((s) => s.planExport);
  const commitExport = useApiStore((s) => s.commitExport);
  const cancelExport = useApiStore((s) => s.cancelExport);
  const validateScript = useApiStore((s) => s.validateScript);
  const openScriptApproval = useApiStore((s) => s.openScriptApproval);
  const closeScriptApproval = useApiStore((s) => s.closeScriptApproval);
  const approveScripts = useApiStore((s) => s.approveScripts);
  const setRunnerOpen = useApiStore((s) => s.setRunnerOpen);
  const chooseRunData = useApiStore((s) => s.chooseRunData);
  const clearRunData = useApiStore((s) => s.clearRunData);
  const startRun = useApiStore((s) => s.startRun);
  const cancelRun = useApiStore((s) => s.cancelRun);
  const exportRunReport = useApiStore((s) => s.exportRunReport);
  const dismissRun = useApiStore((s) => s.dismissRun);
  const loadCookies = useApiStore((s) => s.loadCookies);
  const saveProxyProfile = useApiStore((s) => s.saveProxyProfile);
  const deleteCookieFromJar = useApiStore((s) => s.deleteCookie);
  const clearCookies = useApiStore((s) => s.clearCookies);
  const saveCookie = useApiStore((s) => s.saveCookie);
  const backupWorkspaces = useApiStore((s) => s.backupWorkspaces);
  const planRestore = useApiStore((s) => s.planRestore);
  const commitRestore = useApiStore((s) => s.commitRestore);
  const cancelRestore = useApiStore((s) => s.cancelRestore);

  const projects = useAppStore((s) => s.projects);
  const apiSidebarWidth = useAppStore(
    (s) => s.settings?.layout.paneWidths.apiSidebar ?? API_SIDEBAR_DEFAULT_WIDTH
  );
  const updateSettings = useAppStore((s) => s.updateSettings);
  // The installation-wide kill switch; the editor says so rather than silently doing nothing.
  const scriptsEnabledGlobally = useAppStore((s) => s.settings?.api?.scriptsEnabled ?? true);

  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [tlsDialog, setTlsDialog] = useState<ProfileDialogTarget>(undefined);
  const [proxyDialog, setProxyDialog] = useState<ProfileDialogTarget>(undefined);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [clearCookiesOpen, setClearCookiesOpen] = useState(false);
  const [editingCookie, setEditingCookie] = useState<ApiCookie | null | undefined>(undefined);
  const [oauthDialog, setOAuthDialog] = useState<ProfileDialogTarget>(undefined);
  const [responseFocused, setResponseFocused] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  /** Variable name the environment editor should focus once it opens, from a composer chip. */
  const [pendingVariableFocus, setPendingVariableFocus] = useState<string | null>(null);

  /** Ctrl+W and the tab close button share one guard so neither can drop unsaved work silently. */
  const closeActiveDocument = useCallback(
    (requestId: string) => {
      const target = useApiStore.getState().documents[requestId];
      if (!target?.dirty) {
        closeRequest(requestId);
        return;
      }
      gateApiConfirm({
        title: 'Discard unsaved changes?',
        description: `“${target.draft.name || 'Untitled request'}” has edits that have not been saved.`,
        confirmLabel: 'Discard and close',
        danger: true,
        run: () => closeRequest(requestId),
      });
    },
    [closeRequest, gateApiConfirm]
  );

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const snapshot = useApiStore(selectActiveApiSnapshot);
  const snapshotState = activeWorkspaceId
    ? (workspaceSnapshots[activeWorkspaceId] ?? { loadState: 'idle' as const })
    : { loadState: 'idle' as const };
  const history = activeWorkspaceId
    ? (histories[activeWorkspaceId] ?? EMPTY_HISTORY_STATE)
    : EMPTY_HISTORY_STATE;

  const activeDocument = activeRequestId ? documents[activeRequestId] : null;
  const activeSession = useMemo(() => {
    if (!activeRequestId) return undefined;
    // Newest session for this request wins; older ones stay in the map for history.
    const candidates = Object.values(sessions).filter(
      (session) => session.requestId === activeRequestId
    );
    return candidates[candidates.length - 1];
  }, [activeRequestId, sessions]);

  // An environment tab is only meaningful while its environment exists in the active workspace, so
  // deletions and workspace switches drop the tab rather than leaving it pointing at nothing.
  const auxTabs = useMemo<AuxTab[]>(() => {
    const tabs: AuxTab[] = [];
    for (const id of openAuxIds) {
      const parsed = parseAuxId(id);
      if (!parsed) continue;
      if (parsed.kind === 'secrets') tabs.push({ id, title: 'Secrets' });
      else if (parsed.kind === 'cookies') tabs.push({ id, title: 'Cookies' });
      else {
        const environment = snapshot?.environments.find(
          (entry) => entry.environmentId === parsed.environmentId
        );
        if (environment) tabs.push({ id, title: environment.name || 'Untitled environment' });
      }
    }
    return tabs;
  }, [openAuxIds, snapshot?.environments]);

  // What the active request's `{{variables}}` resolve to right now, for the composer's preview,
  // highlighting and autocomplete. Main still performs the real substitution.
  const variableScope = useMemo(
    () =>
      buildVariableScope({
        snapshot,
        environmentId: activeEnvironmentId,
        requestId: activeRequestId ?? undefined,
        requestVariables: activeDocument?.draft.variables,
      }),
    [snapshot, activeEnvironmentId, activeRequestId, activeDocument?.draft.variables]
  );

  /**
   * An unresolved variable chip is a dead end unless it leads somewhere: this opens the active
   * environment's editor and seeds the missing name so it can be filled in on the spot.
   */
  const jumpToVariable = (name: string): void => {
    const environment = snapshot?.environments.find(
      (entry) => entry.environmentId === activeEnvironmentId
    );
    if (!environment) {
      // Nothing is active yet, so send the user to where an environment is chosen or created.
      setSidebarMode('environments');
      return;
    }
    if (!environment.variables.some((variable) => variable.name.trim() === name)) {
      void updateEnvironment(environment.environmentId, {
        variables: [
          ...environment.variables,
          { variableId: crypto.randomUUID(), name, value: '', enabled: true, secret: false },
        ],
      });
    }
    setPendingVariableFocus(name);
    openAuxDocument({ kind: 'environment', environmentId: environment.environmentId });
  };

  const activeAux = auxTabs.some((tab) => tab.id === activeAuxId) ? parseAuxId(activeAuxId ?? '') : null;
  const activeEnvironment =
    activeAux?.kind === 'environment'
      ? (snapshot?.environments.find(
          (entry) => entry.environmentId === activeAux.environmentId
        ) ?? null)
      : null;

  // Focus mode belongs to one request tab. Switching tabs should never leave its composer hidden.
  useEffect(() => setResponseFocused(false), [activeRequestId]);

  useEffect(() => {
    if (!responseFocused) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setResponseFocused(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [responseFocused]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      // Dialogs have their own explicit actions. A shortcut must never reach past an open dialog
      // and act on the workspace behind it. Quick-open is a dialog too, and closes on Escape.
      if (document.querySelector('[role="dialog"]')) return;

      const key = event.key.toLowerCase();

      if (key === 's') {
        event.preventDefault();
        if (!activeDocument?.dirty || activeDocument.saving) return;
        void saveRequest(activeDocument.requestId);
        return;
      }

      if (key === 'p') {
        event.preventDefault();
        setQuickOpen(true);
        return;
      }

      if (key === 'f') {
        event.preventDefault();
        // Focus follows the filter: the field only exists on the sections that have one.
        if (sidebarMode !== 'collections' && sidebarMode !== 'history') setSidebarMode('collections');
        requestAnimationFrame(() => {
          const filter = document.querySelector<HTMLInputElement>(
            '#api-collections-filter, #api-history-filter'
          );
          filter?.focus();
          filter?.select();
        });
        return;
      }

      if (key === 'w') {
        event.preventDefault();
        if (activeAuxId) closeAuxDocument(activeAuxId);
        else if (activeRequestId) closeActiveDocument(activeRequestId);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (!activeDocument) return;
        const session = Object.values(useApiStore.getState().sessions)
          .filter((entry) => entry.requestId === activeDocument.requestId)
          .at(-1);
        const draft = activeDocument.draft;
        const streaming =
          draft.protocol === 'websocket' ||
          draft.protocol === 'sse' ||
          (draft.protocol === 'graphql' && draft.protocolOptions.graphql?.transport === 'WS');
        if (streaming) {
          if (session?.streamStatus === 'open') void closeStream(session.sessionId);
          else void openStream(activeDocument.requestId);
          return;
        }
        if (session?.inFlight) void cancelRequest(session.sessionId);
        else void sendRequest(activeDocument.requestId);
        return;
      }

      if (event.key === 'Tab') {
        // Cycles requests and workspace-data tabs together, in strip order.
        const strip = [...openDocumentIds, ...auxTabs.map((tab) => tab.id)];
        if (strip.length < 2) return;
        event.preventDefault();
        const currentId = activeAuxId ?? activeRequestId;
        const index = currentId ? strip.indexOf(currentId) : -1;
        const next = strip[(index + (event.shiftKey ? -1 : 1) + strip.length) % strip.length];
        if (auxTabs.some((tab) => tab.id === next)) setActiveAux(next);
        else setActiveRequest(next);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeAuxId,
    activeDocument,
    activeRequestId,
    auxTabs,
    cancelRequest,
    closeActiveDocument,
    closeAuxDocument,
    closeStream,
    openDocumentIds,
    openStream,
    saveRequest,
    sendRequest,
    setActiveAux,
    setActiveRequest,
    setSidebarMode,
    sidebarMode,
  ]);

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className="api-workbench">
        <div className="tab-loading" role="status">
          Loading API workspaces…
        </div>
      </div>
    );
  }

  if (loadState === 'error' && error) {
    return (
      <div className="api-workbench">
        <div className="api-workbench__banner" role="alert">
          <div>
            <strong>{errorHeading(error)}</strong>
            <p>{error.message}</p>
          </div>
          <Button variant="secondary" onClick={() => void loadWorkspaces()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className="api-workbench">
        <EmptyState
          title="No API workspaces yet"
          description="Create a workspace to start building HTTP requests, environments, and collections."
          actions={
            <Button variant="primary" onClick={() => void createWorkspace({ name: 'My workspace' })}>
              Create workspace
            </Button>
          }
        />
      </div>
    );
  }

  const protocol = activeDocument?.draft.protocol;
  // A GraphQL subscription is a stream too: same transcript console, same Connect/Disconnect.
  const isSubscription =
    protocol === 'graphql' &&
    activeDocument?.draft.protocolOptions.graphql?.transport === 'WS';
  const isStream = protocol === 'websocket' || protocol === 'sse' || isSubscription;
  const responseFocusActive = responseFocused && !isStream;
  const streamProtocol: 'websocket' | 'sse' = protocol === 'sse' ? 'sse' : 'websocket';
  const tlsProfiles = snapshot?.tlsProfiles ?? [];
  const proxyProfiles = snapshot?.proxyProfiles ?? [];
  const oauthProfiles = snapshot?.oauthProfiles ?? [];
  const oauthTokens = snapshot?.oauthTokens ?? [];

  const editingTlsProfile =
    typeof tlsDialog === 'string'
      ? (tlsProfiles.find((profile) => profile.profileId === tlsDialog) ?? null)
      : null;
  const editingOAuthProfile =
    typeof oauthDialog === 'string'
      ? (oauthProfiles.find((profile) => profile.profileId === oauthDialog) ?? null)
      : null;

  return (
    <div className="api-workbench">
      <ApiToolbar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        snapshot={snapshot}
        activeEnvironmentId={activeEnvironmentId}
        onWorkspaceChange={(workspaceId) => setActiveWorkspace(workspaceId)}
        onEnvironmentChange={(environmentId) => setActiveEnvironment(environmentId)}
        onNewRequest={() =>
          void createCollection({ parentId: null, kind: 'request', name: 'New request' })
        }
        onImport={() => setImportOpen(true)}
        onExport={() => setExportOpen(true)}
        onRun={() => setRunnerOpen(true)}
        onBackup={() => setRestoreOpen(true)}
        onShortcuts={() => setShortcutsOpen(true)}
      />

      {importReport ? (
        <div className="api-workbench__report" role="status">
          <strong>Import complete</strong>
          <span className="mono">
            {importReport.createdFolders} folders · {importReport.createdRequests} requests ·{' '}
            {importReport.createdEnvironments} environments
            {importReport.renamed > 0 ? ` · ${importReport.renamed} renamed` : ''}
            {importReport.replaced > 0 ? ` · ${importReport.replaced} replaced` : ''}
            {importReport.skipped > 0 ? ` · ${importReport.skipped} skipped` : ''}
            {importReport.scriptsImportedDisabled > 0
              ? ` · ${importReport.scriptsImportedDisabled} scripts disabled`
              : ''}
          </span>
          <Button size="compact" variant="ghost" onClick={clearImportReport}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="api-workbench__main">
        <ResizablePanel
          axis="horizontal"
          defaultSize={apiSidebarWidth}
          minSize={API_SIDEBAR_MIN_WIDTH}
          maxSize={API_SIDEBAR_MAX_WIDTH}
          minSiblingSize={420}
          storageKey="api-sidebar"
          resizeLabel="Resize API sidebar"
          className="api-sidebar-panel"
          onSizeCommit={(apiSidebar) => void updateSettings({ layout: { paneWidths: { apiSidebar } } })}
        >
          <ApiSidebar
            mode={sidebarMode}
            snapshot={snapshot}
            snapshotLoadState={snapshotState.loadState}
            history={history}
            projects={projects}
            secrets={secrets}
            relinkPickerOpen={relinkPickerOpen}
            onModeChange={(next) => {
              setSidebarMode(next);
              // Cookies are held in main, so the pane reads them when it is opened rather than
              // keeping a copy in sync on every response.
              if (next === 'cookies') void loadCookies();
            }}
            onOpenRequest={openRequest}
            onCreateFolder={() =>
              void createCollection({ parentId: null, kind: 'folder', name: 'New folder' })
            }
            onCreateRequest={() =>
              void createCollection({ parentId: null, kind: 'request', name: 'New request' })
            }
            onCreateEnvironment={() => void createEnvironment('New environment')}
            onDeleteEnvironment={(environmentId) => void deleteEnvironment(environmentId)}
            onOpenEnvironment={(environmentId) =>
              openAuxDocument({ kind: 'environment', environmentId })
            }
            onOpenSecrets={() => openAuxDocument({ kind: 'secrets' })}
            onOpenCookies={() => {
              void loadCookies();
              openAuxDocument({ kind: 'cookies' });
            }}
            cookieJars={cookieJars}
            activeCookieJarId={activeCookieJarId}
            cookies={cookies}
            cookiesLoading={cookiesLoading}
            onDeleteSecret={(secretId) => void deleteSecret(secretId)}
            onSelectCookieJar={(jarId) => void loadCookies(jarId)}
            onRefreshCookies={() => void loadCookies()}
            onEditCookie={setEditingCookie}
            onDeleteCookie={(cookie) => void deleteCookieFromJar(cookie)}
            onRelink={(projectId) => void relinkWorkspace(projectId)}
            onRemoveLink={() => void removeWorkspaceLink()}
            onSetRelinkPickerOpen={setRelinkPickerOpen}
            onRetrySnapshot={() => void refreshActiveWorkspace()}
            onRetryHistory={() => {
              if (activeWorkspaceId) void loadHistory(activeWorkspaceId);
            }}
          />
        </ResizablePanel>

        <div className="api-workbench__editor">
          <ApiDocumentTabs
            openDocumentIds={openDocumentIds}
            documents={documents}
            activeRequestId={activeRequestId}
            auxTabs={auxTabs}
            activeAuxId={activeAux ? activeAuxId : null}
            sessions={sessions}
            onSelect={setActiveRequest}
            onClose={closeRequest}
            onSelectAux={(id) => {
              if (id === 'cookies') void loadCookies();
              setActiveAux(id);
            }}
            onCloseAux={closeAuxDocument}
          />

          {activeAux ? (
            <div className="api-workbench__aux">
              {activeAux.kind === 'secrets' ? (
                <SecretsEditor
                  secrets={secrets}
                  storageAvailable={secretStorageAvailable}
                  onSave={(label, value, persist) => void saveSecret(label, value, persist)}
                  onDelete={(secretId) => void deleteSecret(secretId)}
                />
              ) : null}
              {activeAux.kind === 'cookies' ? (
                <CookiesEditor
                  jars={cookieJars}
                  activeJarId={activeCookieJarId}
                  cookies={cookies}
                  loading={cookiesLoading}
                  onSelectJar={(jarId) => void loadCookies(jarId)}
                  onDelete={(cookie) => void deleteCookieFromJar(cookie)}
                  onClear={() => setClearCookiesOpen(true)}
                  onRefresh={() => void loadCookies()}
                  onEdit={setEditingCookie}
                />
              ) : null}
              {activeAux.kind === 'environment' && activeEnvironment ? (
                <EnvironmentEditor
                  environment={activeEnvironment}
                  secrets={secrets}
                  focusVariableName={pendingVariableFocus}
                  onFocusHandled={() => setPendingVariableFocus(null)}
                  isActive={activeEnvironmentId === activeEnvironment.environmentId}
                  onUpdate={(patch) => void updateEnvironment(activeEnvironment.environmentId, patch)}
                  onSetActive={() =>
                    setActiveEnvironment(
                      activeEnvironmentId === activeEnvironment.environmentId
                        ? null
                        : activeEnvironment.environmentId
                    )
                  }
                  onDelete={() => void deleteEnvironment(activeEnvironment.environmentId)}
                />
              ) : null}
            </div>
          ) : activeDocument ? (
            <div className={responseFocusActive ? 'api-workbench__split api-workbench__split--response-focused' : 'api-workbench__split'}>
              {responseFocusActive ? (
                <ResponseInspector
                  session={activeSession}
                  requestId={activeDocument.requestId}
                  focusMode
                  onToggleFocus={() => setResponseFocused(false)}
                />
              ) : (
                <>
                  <ResizablePanel
                    axis="vertical"
                    defaultSize={320}
                    minSize={180}
                    maxSize={720}
                    minSiblingSize={160}
                    storageKey="api-composer"
                    resizeLabel="Resize request composer"
                    className="api-workbench__composer-panel"
                  >
                    <RequestComposer
                      document={activeDocument}
                      secrets={secrets}
                      tlsProfiles={tlsProfiles}
                      oauthProfiles={oauthProfiles}
                      oauthTokens={oauthTokens}
                      session={activeSession}
                      introspecting={introspecting}
                      introspectError={introspectError}
                      schemaTypeCount={
                        graphqlSchemas[activeDocument.requestId]?.types.length ?? null
                      }
                      scriptValidation={scriptValidation}
                      scriptsEnabledGlobally={scriptsEnabledGlobally}
                      onValidateScript={(phase, source) =>
                        void validateScript(activeDocument.requestId, phase, source)
                      }
                      onReviewScripts={() => {
                        // The request's own collection node is the subtree the approval applies to.
                        const node = snapshot?.collections.find(
                          (entry) => entry.requestId === activeDocument.requestId
                        );
                        void openScriptApproval(node?.parentId ?? null);
                      }}
                      scope={variableScope}
                      onJumpToVariable={jumpToVariable}
                      onDraftChange={(patch) => updateDraft(activeDocument.requestId, patch)}
                      onSave={() => void saveRequest(activeDocument.requestId)}
                      onSend={() => void sendRequest(activeDocument.requestId)}
                      onConnect={() => void openStream(activeDocument.requestId)}
                      onCancel={(sessionId) => void cancelRequest(sessionId)}
                      onDisconnect={(sessionId) => void closeStream(sessionId)}
                      onIntrospect={() => void introspectGraphql(activeDocument.requestId)}
                      onManageOAuth={setOAuthDialog}
                      onManageTls={setTlsDialog}
                      proxyProfiles={proxyProfiles}
                      onManageProxy={setProxyDialog}
                    />
                  </ResizablePanel>

                  {isStream ? (
                <StreamConsole
                  protocol={streamProtocol}
                  session={activeSession}
                  onConnect={() => void openStream(activeDocument.requestId)}
                  onDisconnect={(sessionId) => void closeStream(sessionId)}
                  onSend={(sessionId, format, payload) =>
                    void sendStreamMessage(sessionId, format, payload)
                  }
                  onTogglePause={(sessionId, paused) => void setStreamPaused(sessionId, paused)}
                  onClear={clearStreamTranscript}
                />
                  ) : (
                    <ResponseInspector
                      session={activeSession}
                      requestId={activeDocument.requestId}
                      onToggleFocus={() => setResponseFocused(true)}
                    />
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="api-workbench__empty-editor">
              <EmptyState
                title="No request open"
                description="Create one, open an existing request with Ctrl+P, or bring in a collection you already have."
                actions={
                  <>
                    <Button
                      variant="primary"
                      onClick={() =>
                        void createCollection({
                          parentId: null,
                          kind: 'request',
                          name: 'New request',
                        })
                      }
                    >
                      New request
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!snapshot?.requests.length}
                      onClick={() => setQuickOpen(true)}
                    >
                      Open request…
                    </Button>
                    <Button variant="ghost" onClick={() => setImportOpen(true)}>
                      Import a collection
                    </Button>
                  </>
                }
              />
            </div>
          )}
        </div>
      </div>

      <ApiConfirmDialog />

      {shortcutsOpen ? <ApiShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}

      {quickOpen ? (
        <ApiQuickOpen
          snapshot={snapshot}
          onOpen={openRequest}
          onClose={() => setQuickOpen(false)}
        />
      ) : null}

      {importOpen ? (
        <ImportDialog
          snapshot={snapshot}
          preview={importPreview}
          busy={importBusy}
          error={importError}
          onInspect={(input) => void inspectImport(input)}
          onCommit={(input) => {
            void commitImport(input).then(() => setImportOpen(false));
          }}
          onCancel={() => {
            cancelImport();
            setImportOpen(false);
          }}
        />
      ) : null}

      {exportOpen ? (
        <ExportDialog
          snapshot={snapshot}
          activeRequestId={activeRequestId}
          selectedHistoryIds={history.items.map((entry) => entry.historyId)}
          plan={exportPlan}
          busy={exportBusy}
          error={exportError}
          onPlan={(format, scope) => void planExport(format, scope)}
          onCommit={(format, scope) => {
            void commitExport(format, scope).then(() => setExportOpen(false));
          }}
          onCancel={() => {
            cancelExport();
            setExportOpen(false);
          }}
        />
      ) : null}

      {runnerOpen ? (
        <RunnerDialog
          snapshot={snapshot}
          activeRequestId={activeRequestId}
          runData={runData}
          runDataBusy={runDataBusy}
          run={activeRun}
          error={runError}
          onChooseData={() => void chooseRunData()}
          onClearData={() => void clearRunData()}
          onStart={(config) => void startRun(config)}
          onCancelRun={() => void cancelRun()}
          onExportReport={(format) => void exportRunReport(format)}
          onDismissRun={dismissRun}
          onClose={() => setRunnerOpen(false)}
        />
      ) : null}

      {scriptApproval.open ? (
        <ScriptApprovalDialog
          collectionName={
            scriptApproval.collectionId
              ? (snapshot?.collections.find(
                  (node) => node.collectionId === scriptApproval.collectionId
                )?.name ?? 'this folder')
              : (snapshot?.summary.name ?? 'this workspace')
          }
          locations={scriptApproval.locations}
          busy={scriptApproval.busy}
          error={scriptApproval.error}
          onApprove={(enabled) => void approveScripts(enabled)}
          onCancel={closeScriptApproval}
        />
      ) : null}

      <Dialog
        open={clearCookiesOpen}
        title="Clear this cookie jar?"
        description={`${cookies.length} cookie${cookies.length === 1 ? '' : 's'} will be removed. Any session this workspace holds will be signed out.`}
        onClose={() => setClearCookiesOpen(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setClearCookiesOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void clearCookies();
                setClearCookiesOpen(false);
              }}
            >
              Clear jar
            </Button>
          </>
        }
      />

      {editingCookie !== undefined ? (
        <CookieEditorDialog
          cookie={editingCookie}
          onCancel={() => setEditingCookie(undefined)}
          onSave={(cookie) => {
            void saveCookie(cookie);
            setEditingCookie(undefined);
          }}
        />
      ) : null}

      {restoreOpen ? (
        <BackupDialog
          plan={restorePlan}
          report={restoreReport}
          busy={restoreBusy}
          error={restoreError}
          onBackup={() => void backupWorkspaces()}
          onChooseFile={() => void planRestore()}
          onCommit={(mode) => void commitRestore(mode)}
          onClose={() => {
            cancelRestore();
            setRestoreOpen(false);
          }}
        />
      ) : null}

      {proxyDialog !== undefined ? (
        <ProxyProfileDialog
          profile={proxyProfiles.find((entry) => entry.profileId === proxyDialog) ?? null}
          secrets={secrets}
          onCancel={() => setProxyDialog(undefined)}
          onSave={(input) => {
            void saveProxyProfile(input);
            setProxyDialog(undefined);
          }}
        />
      ) : null}

      {tlsDialog !== undefined ? (
        <TlsProfileDialog
          profile={editingTlsProfile}
          onCancel={() => setTlsDialog(undefined)}
          onSave={(input) => {
            void saveTlsProfile(input);
            setTlsDialog(undefined);
          }}
        />
      ) : null}

      {oauthDialog !== undefined ? (
        <OAuthDialog
          profile={editingOAuthProfile}
          status={oauthTokens.find((token) => token.profileId === editingOAuthProfile?.profileId)}
          secrets={secrets}
          phase={oauthPhases[editingOAuthProfile?.profileId ?? '']?.phase ?? 'idle'}
          errorMessage={oauthPhases[editingOAuthProfile?.profileId ?? '']?.errorMessage}
          onCancel={() => setOAuthDialog(undefined)}
          onSave={(input) => {
            void saveOAuthProfile(input);
            setOAuthDialog(undefined);
          }}
          onAuthorize={() => {
            if (editingOAuthProfile) void authorizeOAuth(editingOAuthProfile.profileId);
          }}
          onCancelAuthorize={() => {
            if (editingOAuthProfile) void cancelOAuth(editingOAuthProfile.profileId);
          }}
          onClearToken={() => {
            if (editingOAuthProfile) void clearOAuthToken(editingOAuthProfile.profileId);
          }}
        />
      ) : null}
    </div>
  );
}
