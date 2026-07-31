import { IPC_CHANNELS } from '@shared/contracts/channels';
import {
  apiCancelRequestSchema,
  apiCloseStreamSchema,
  apiCommitImportSchema,
  apiDiscardImportSchema,
  apiExportSchema,
  apiInspectImportSchema,
  apiCreateCollectionSchema,
  apiDeleteOAuthProfileSchema,
  apiDeleteTlsProfileSchema,
  apiIntrospectGraphqlSchema,
  apiOAuthProfileRefSchema,
  apiOpenStreamSchema,
  apiSaveOAuthProfileSchema,
  apiSaveTlsProfileSchema,
  apiSendStreamMessageSchema,
  apiSetStreamPausedSchema,
  apiStreamIdSchema,
  apiCreateEnvironmentSchema,
  apiCreateWorkspaceSchema,
  apiDeleteCollectionSchema,
  apiDeleteEnvironmentSchema,
  apiDeleteRequestSchema,
  apiDeleteSecretSchema,
  apiDeleteWorkspaceSchema,
  apiDirtyDraftCountSchema,
  apiEmptyRequestSchema,
  apiHistoryIdRequestSchema,
  apiSaveRequestSchema,
  apiSaveSecretSchema,
  apiSendRequestSchema,
  apiUpdateCollectionSchema,
  apiUpdateEnvironmentSchema,
  apiUpdateWorkspaceSchema,
  apiWorkspaceIdRequestSchema,
  apiApproveScriptsSchema,
  apiExportRunReportSchema,
  apiListScriptLocationsSchema,
  apiRunDataIdSchema,
  apiRunIdSchema,
  apiStartRunSchema,
  apiValidateScriptSchema,
  apiBackupSchema,
  apiClearCookiesSchema,
  apiCommitRestoreSchema,
  apiDeleteCookieSchema,
  apiDeleteProxyProfileSchema,
  apiListCookiesSchema,
  apiRestorePlanSchema,
  apiSaveProxyProfileSchema,
  apiSaveCookieSchema,
} from '@shared/validation/apiWorkbench';
import type { AppServices } from './serviceContracts';

type RegisterFn = <T, R>(
  channel: string,
  operation: string,
  handler: (args: T) => Promise<R>
) => void;

/** API workbench IPC handlers. Sender trust is enforced by the shared `register` wrapper. */
export function registerApiHandlers(services: AppServices, register: RegisterFn): void {
  register(IPC_CHANNELS.API_LIST_WORKSPACES, 'api.listWorkspaces', async (args: unknown) => {
    apiEmptyRequestSchema.parse(args ?? {});
    return services.api.listWorkspaces();
  });

  register(IPC_CHANNELS.API_GET_STATUS, 'api.getStatus', async (args: unknown) => {
    apiEmptyRequestSchema.parse(args ?? {});
    return services.api.getStatus();
  });

  register(IPC_CHANNELS.API_GET_WORKSPACE, 'api.getWorkspace', async (args: unknown) => {
    const input = apiWorkspaceIdRequestSchema.parse(args ?? {});
    const snapshot = await services.api.getWorkspace(input.workspaceId);
    if (!snapshot) {
      return {
        ok: false,
        error: {
          code: 'API_WORKSPACE_NOT_FOUND',
          message: 'API workspace not found.',
          operation: 'api.getWorkspace',
          subjectId: input.workspaceId,
          retryable: false,
        },
      };
    }
    return { ok: true, snapshot };
  });

  register(IPC_CHANNELS.API_CREATE_WORKSPACE, 'api.createWorkspace', async (args: unknown) => {
    const input = apiCreateWorkspaceSchema.parse(args ?? {});
    const snapshot = await services.api.createWorkspace(input);
    return { ok: true, workspaceId: snapshot.summary.workspaceId };
  });

  register(IPC_CHANNELS.API_UPDATE_WORKSPACE, 'api.updateWorkspace', async (args: unknown) => {
    const input = apiUpdateWorkspaceSchema.parse(args ?? {});
    const result = await services.api.updateWorkspace(input);
    if (!result.ok) return result;
    return { ok: true, revision: result.snapshot.summary.revision };
  });

  register(IPC_CHANNELS.API_DELETE_WORKSPACE, 'api.deleteWorkspace', async (args: unknown) => {
    const input = apiDeleteWorkspaceSchema.parse(args ?? {});
    return services.api.deleteWorkspace(input.workspaceId, input.expectedRevision);
  });

  register(IPC_CHANNELS.API_CREATE_COLLECTION, 'api.createCollection', async (args: unknown) => {
    const input = apiCreateCollectionSchema.parse(args ?? {});
    const result = await services.api.createCollection(input);
    if (!result.ok) return result;
    return {
      ok: true,
      collectionId: result.collectionId,
      requestId: result.requestId,
    };
  });

  register(IPC_CHANNELS.API_UPDATE_COLLECTION, 'api.updateCollection', async (args: unknown) => {
    const input = apiUpdateCollectionSchema.parse(args ?? {});
    const result = await services.api.updateCollection(input);
    if (!result.ok) return result;
    const node = result.snapshot.collections.find((entry) => entry.collectionId === input.collectionId);
    return { ok: true, revision: node?.revision ?? result.snapshot.summary.revision };
  });

  register(IPC_CHANNELS.API_DELETE_COLLECTION, 'api.deleteCollection', async (args: unknown) => {
    const input = apiDeleteCollectionSchema.parse(args ?? {});
    const result = await services.api.deleteCollection(
      input.workspaceId,
      input.collectionId,
      input.expectedRevision
    );
    if (!result.ok) return result;
    return { ok: true };
  });

  register(IPC_CHANNELS.API_SAVE_REQUEST, 'api.saveRequest', async (args: unknown) => {
    const input = apiSaveRequestSchema.parse(args ?? {});
    const result = await services.api.saveRequest(input);
    if (!result.ok) return result;
    const request = result.snapshot.requests.find((entry) => entry.requestId === input.requestId);
    return { ok: true, revision: request?.revision ?? result.snapshot.summary.revision };
  });

  register(IPC_CHANNELS.API_DELETE_REQUEST, 'api.deleteRequest', async (args: unknown) => {
    const input = apiDeleteRequestSchema.parse(args ?? {});
    const result = await services.api.deleteRequest(
      input.workspaceId,
      input.requestId,
      input.expectedRevision
    );
    if (!result.ok) return result;
    return { ok: true };
  });

  register(IPC_CHANNELS.API_CREATE_ENVIRONMENT, 'api.createEnvironment', async (args: unknown) => {
    const input = apiCreateEnvironmentSchema.parse(args ?? {});
    const result = await services.api.createEnvironment(input);
    if (!result.ok) return result;
    return { ok: true, environmentId: result.environmentId };
  });

  register(IPC_CHANNELS.API_UPDATE_ENVIRONMENT, 'api.updateEnvironment', async (args: unknown) => {
    const input = apiUpdateEnvironmentSchema.parse(args ?? {});
    const result = await services.api.updateEnvironment(input);
    if (!result.ok) return result;
    const environment = result.snapshot.environments.find(
      (entry) => entry.environmentId === input.environmentId
    );
    return { ok: true, revision: environment?.revision ?? result.snapshot.summary.revision };
  });

  register(IPC_CHANNELS.API_DELETE_ENVIRONMENT, 'api.deleteEnvironment', async (args: unknown) => {
    const input = apiDeleteEnvironmentSchema.parse(args ?? {});
    const result = await services.api.deleteEnvironment(
      input.workspaceId,
      input.environmentId,
      input.expectedRevision
    );
    if (!result.ok) return result;
    return { ok: true };
  });

  register(IPC_CHANNELS.API_LIST_SECRETS, 'api.listSecrets', async (args: unknown) => {
    apiEmptyRequestSchema.parse(args ?? {});
    return { secrets: services.api.listSecrets() };
  });

  register(IPC_CHANNELS.API_SAVE_SECRET, 'api.saveSecret', async (args: unknown) => {
    const input = apiSaveSecretSchema.parse(args ?? {});
    const result = await services.api.saveSecret(input);
    if (!result.ok) return result;
    return { ok: true, secretId: result.summary.secretId };
  });

  register(IPC_CHANNELS.API_DELETE_SECRET, 'api.deleteSecret', async (args: unknown) => {
    const input = apiDeleteSecretSchema.parse(args ?? {});
    return services.api.deleteSecret(input.secretId);
  });

  register(IPC_CHANNELS.API_LIST_HISTORY, 'api.listHistory', async (args: unknown) => {
    const input = apiWorkspaceIdRequestSchema.parse(args ?? {});
    return { items: services.api.listHistory(input.workspaceId) };
  });

  register(IPC_CHANNELS.API_GET_HISTORY_ENTRY, 'api.getHistoryEntry', async (args: unknown) => {
    const input = apiHistoryIdRequestSchema.parse(args ?? {});
    const result = await services.api.getHistoryEntry(input.historyId);
    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: 'API_REQUEST_NOT_FOUND',
          message: 'History entry not found.',
          operation: 'api.getHistoryEntry',
          subjectId: input.historyId,
          retryable: false,
        },
      };
    }
    return { ok: true, entry: result.summary };
  });

  register(IPC_CHANNELS.API_SEND_REQUEST, 'api.sendRequest', async (args: unknown) => {
    const input = apiSendRequestSchema.parse(args ?? {});
    return services.api.sendRequest(input);
  });

  register(IPC_CHANNELS.API_CANCEL_REQUEST, 'api.cancelRequest', async (args: unknown) => {
    const input = apiCancelRequestSchema.parse(args ?? {});
    return services.api.cancelRequest(input);
  });

  register(IPC_CHANNELS.API_SET_DIRTY_DRAFT_COUNT, 'api.setDirtyDraftCount', async (args: unknown) => {
    const input = apiDirtyDraftCountSchema.parse(args ?? {});
    services.api.setDirtyDraftCount(input.count);
  });

  /* ---------------------------------------------------- Phase 2: streams and protocols */

  register(IPC_CHANNELS.API_OPEN_STREAM, 'api.openStream', async (args: unknown) =>
    services.api.openStream(apiOpenStreamSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_SEND_STREAM_MESSAGE, 'api.sendStreamMessage', async (args: unknown) =>
    services.api.sendStreamMessage(apiSendStreamMessageSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_CLOSE_STREAM, 'api.closeStream', async (args: unknown) =>
    services.api.closeStream(apiCloseStreamSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_SET_STREAM_PAUSED, 'api.setStreamPaused', async (args: unknown) =>
    services.api.setStreamPaused(apiSetStreamPausedSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_GET_STREAM_SNAPSHOT, 'api.getStreamSnapshot', async (args: unknown) =>
    services.api.getStreamSnapshot(apiStreamIdSchema.parse(args ?? {}).sessionId)
  );

  register(IPC_CHANNELS.API_INTROSPECT_GRAPHQL, 'api.introspectGraphql', async (args: unknown) =>
    services.api.introspectGraphql(apiIntrospectGraphqlSchema.parse(args ?? {}))
  );

  /* ---------------------------------------------------- Phase 2: TLS and OAuth profiles */

  register(IPC_CHANNELS.API_SAVE_TLS_PROFILE, 'api.saveTlsProfile', async (args: unknown) =>
    services.api.saveTlsProfile(apiSaveTlsProfileSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_DELETE_TLS_PROFILE, 'api.deleteTlsProfile', async (args: unknown) =>
    services.api.deleteTlsProfile(apiDeleteTlsProfileSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_SAVE_OAUTH_PROFILE, 'api.saveOAuthProfile', async (args: unknown) =>
    services.api.saveOAuthProfile(apiSaveOAuthProfileSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_DELETE_OAUTH_PROFILE, 'api.deleteOAuthProfile', async (args: unknown) =>
    services.api.deleteOAuthProfile(apiDeleteOAuthProfileSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_AUTHORIZE_OAUTH, 'api.authorizeOAuth', async (args: unknown) =>
    services.api.authorizeOAuth(apiOAuthProfileRefSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_CANCEL_OAUTH, 'api.cancelOAuth', async (args: unknown) =>
    services.api.cancelOAuth(apiOAuthProfileRefSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_CLEAR_OAUTH_TOKEN, 'api.clearOAuthToken', async (args: unknown) =>
    services.api.clearOAuthToken(apiOAuthProfileRefSchema.parse(args ?? {}))
  );

  /* ---------------------------------------------------- Phase 3: import and export */

  register(IPC_CHANNELS.API_INSPECT_IMPORT, 'api.inspectImport', async (args: unknown) =>
    services.api.inspectImport(apiInspectImportSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_COMMIT_IMPORT, 'api.commitImport', async (args: unknown) =>
    services.api.commitImport(apiCommitImportSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_DISCARD_IMPORT, 'api.discardImport', async (args: unknown) => {
    services.api.discardImport(apiDiscardImportSchema.parse(args ?? {}).previewId);
  });

  register(IPC_CHANNELS.API_PLAN_EXPORT, 'api.planExport', async (args: unknown) =>
    services.api.planExport(apiExportSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_COMMIT_EXPORT, 'api.commitExport', async (args: unknown) =>
    services.api.commitExport(apiExportSchema.parse(args ?? {}))
  );

  /* ------------------------------------- Phase 4: script sandbox and collection runner */

  register(IPC_CHANNELS.API_VALIDATE_SCRIPT, 'api.validateScript', async (args: unknown) =>
    services.api.validateScript(apiValidateScriptSchema.parse(args ?? {}))
  );

  register(
    IPC_CHANNELS.API_LIST_SCRIPT_LOCATIONS,
    'api.listScriptLocations',
    async (args: unknown) =>
      services.api.listScriptLocations(apiListScriptLocationsSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_APPROVE_SCRIPTS, 'api.approveScripts', async (args: unknown) =>
    services.api.approveScripts(apiApproveScriptsSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_LOAD_RUN_DATA, 'api.loadRunData', async (args: unknown) =>
    services.api.loadRunData(apiWorkspaceIdRequestSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_CLEAR_RUN_DATA, 'api.clearRunData', async (args: unknown) => {
    services.api.clearRunData(apiRunDataIdSchema.parse(args ?? {}).dataSetId);
  });

  register(IPC_CHANNELS.API_START_RUN, 'api.startRun', async (args: unknown) =>
    services.api.startRun(apiStartRunSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_CANCEL_RUN, 'api.cancelRun', async (args: unknown) =>
    services.api.cancelRun(apiRunIdSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_GET_RUN_REPORT, 'api.getRunReport', async (args: unknown) =>
    services.api.getRunReport(apiRunIdSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_EXPORT_RUN_REPORT, 'api.exportRunReport', async (args: unknown) =>
    services.api.exportRunReport(apiExportRunReportSchema.parse(args ?? {}))
  );

  /* ------------------------------ Phase 5: proxy, cookies, backup and restore */

  register(IPC_CHANNELS.API_SAVE_PROXY_PROFILE, 'api.saveProxyProfile', async (args: unknown) =>
    services.api.saveProxyProfile(apiSaveProxyProfileSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_DELETE_PROXY_PROFILE, 'api.deleteProxyProfile', async (args: unknown) =>
    services.api.deleteProxyProfile(apiDeleteProxyProfileSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_LIST_COOKIE_JARS, 'api.listCookieJars', async (args: unknown) => ({
    jars: services.api.listCookieJars(apiWorkspaceIdRequestSchema.parse(args ?? {}).workspaceId),
  }));

  register(IPC_CHANNELS.API_LIST_COOKIES, 'api.listCookies', async (args: unknown) => ({
    cookies: services.api.listCookies(apiListCookiesSchema.parse(args ?? {})),
  }));

  register(IPC_CHANNELS.API_DELETE_COOKIE, 'api.deleteCookie', async (args: unknown) =>
    services.api.deleteCookie(apiDeleteCookieSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_CLEAR_COOKIES, 'api.clearCookies', async (args: unknown) =>
    services.api.clearCookies(apiClearCookiesSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_SAVE_COOKIE, 'api.saveCookie', async (args: unknown) =>
    services.api.saveCookie(apiSaveCookieSchema.parse(args ?? {}))
  );

  register(IPC_CHANNELS.API_BACKUP_WORKSPACES, 'api.backupWorkspaces', async (args: unknown) => {
    apiBackupSchema.parse(args ?? {});
    return services.api.backupWorkspaces();
  });

  register(IPC_CHANNELS.API_PLAN_RESTORE, 'api.planRestore', async (args: unknown) => {
    apiRestorePlanSchema.parse(args ?? {});
    return services.api.planRestore();
  });

  register(IPC_CHANNELS.API_COMMIT_RESTORE, 'api.commitRestore', async (args: unknown) =>
    services.api.commitRestore(apiCommitRestoreSchema.parse(args ?? {}))
  );
}
