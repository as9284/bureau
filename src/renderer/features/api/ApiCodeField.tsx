import type { ReactElement, ReactNode } from 'react';
import { CodeEditor } from '@renderer/features/files/CodeEditor';

type Props = {
  label: string;
  value: string;
  /** CodeMirror language id (`json`, `javascript`, `xml`, `html`, …). Empty = plain text. */
  languageId: string;
  onChange(value: string): void;
  readOnly?: boolean;
  error?: ReactNode;
  /** When false, hides the line-number gutter (compact API fields). Default true. */
  lineNumbers?: boolean;
};

/**
 * Labelled CodeMirror field for API workbench surfaces (body, scripts, GraphQL).
 * Tab indents, brackets match, and language highlighting follows Bureau tokens.
 */
export function ApiCodeField({
  label,
  value,
  languageId,
  onChange,
  readOnly = false,
  error,
  lineNumbers = true,
}: Props): ReactElement {
  return (
    <div className="api-code-field">
      <div className="api-field-label" aria-hidden="true">
        {label}
      </div>
      <div className="api-code-field__editor">
        <CodeEditor
          value={value}
          languageId={languageId}
          readOnly={readOnly}
          lineNumbers={lineNumbers}
          wordWrap
          aria-label={label}
          className="api-code-field__cm"
          onChange={onChange}
        />
      </div>
      {error ? (
        <p className="api-field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
