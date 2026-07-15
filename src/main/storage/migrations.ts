import type { ProjectCatalogueFileV1, SettingsFileV1 } from './schemas';

export type PersistedFile = ProjectCatalogueFileV1 | SettingsFileV1;

export function assertKnownSchemaVersion(value: PersistedFile): void {
  if (value.schemaVersion !== 1) {
    throw new Error(
      `Incompatible data schema version ${value.schemaVersion}. This application only supports version 1.`
    );
  }
}
