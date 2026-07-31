import { useMemo } from 'react';
import { Dropdown } from '@renderer/components/Dropdown';
import { TextField } from '@renderer/components/TextField';
import { Button } from '@renderer/components/Button';
import type { ApiGraphqlOptions, ApiRequestDefinition } from '@shared/contracts/apiWorkbench';
import {
  DEFAULT_GRAPHQL_OPTIONS,
  parseOperationNames,
  validateGraphqlVariables,
} from './apiFormat';
import { ApiCodeField } from './ApiCodeField';

type Props = {
  draft: ApiRequestDefinition;
  introspecting: boolean;
  introspectError: string | null;
  schemaTypeCount: number | null;
  onChange(options: ApiGraphqlOptions): void;
  onIntrospect(): void;
};

export function GraphqlComposer({
  draft,
  introspecting,
  introspectError,
  schemaTypeCount,
  onChange,
  onIntrospect,
}: Props) {
  const options = draft.protocolOptions.graphql ?? DEFAULT_GRAPHQL_OPTIONS;
  const operations = useMemo(() => parseOperationNames(options.query), [options.query]);

  const variablesError = useMemo(
    () => validateGraphqlVariables(options.variables),
    [options.variables]
  );

  return (
    <div className="api-graphql">
      <div className="api-graphql__row">
        <Dropdown
          label="Transport"
          value={options.transport}
          options={[
            { value: 'POST', label: 'POST' },
            { value: 'GET', label: 'GET (queries only)' },
            { value: 'WS', label: 'WebSocket subscription' },
          ]}
          onChange={(transport) =>
            onChange({ ...options, transport: transport as ApiGraphqlOptions['transport'] })
          }
        />
        {operations.length > 1 ? (
          <Dropdown
            label="Operation"
            value={options.operationName ?? operations[0]}
            options={operations.map((name) => ({ value: name, label: name }))}
            onChange={(operationName) => onChange({ ...options, operationName })}
          />
        ) : (
          <div className="api-graphql__field">
            <label className="api-field-label" htmlFor="api-graphql-operation">
              Operation name
            </label>
            <TextField
              id="api-graphql-operation"
              className="mono"
              value={options.operationName ?? ''}
              placeholder="Optional"
              onChange={(event) =>
                onChange({ ...options, operationName: event.target.value || undefined })
              }
            />
          </div>
        )}
        <div className="api-graphql__schema">
          <Button
            size="compact"
            variant="secondary"
            loading={introspecting}
            disabled={introspecting || !draft.urlTemplate.trim()}
            onClick={onIntrospect}
          >
            Introspect schema
          </Button>
          {schemaTypeCount !== null ? (
            <span className="api-graphql__schema-meta mono">{schemaTypeCount} types cached</span>
          ) : null}
        </div>
      </div>

      {introspectError ? (
        <div className="api-banner api-banner--danger" role="alert">
          <strong>Introspection failed</strong>
          <span>{introspectError}</span>
        </div>
      ) : null}

      <ApiCodeField
        label="Query or mutation"
        languageId="javascript"
        value={options.query}
        onChange={(query) => onChange({ ...options, query })}
      />

      <ApiCodeField
        label="Variables (JSON)"
        languageId="json"
        value={options.variables}
        onChange={(variables) => onChange({ ...options, variables })}
        error={variablesError}
      />
    </div>
  );
}
