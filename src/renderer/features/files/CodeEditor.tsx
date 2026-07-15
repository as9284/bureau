import { useEffect, useRef } from 'react';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import {
  bracketMatching,
  HighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  StreamLanguage,
} from '@codemirror/language';
import { tags } from '@lezer/highlight';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import {
  highlightSelectionMatches,
  searchKeymap,
} from '@codemirror/search';

type CodeEditorProps = {
  value: string;
  languageId: string;
  readOnly: boolean;
  wordWrap?: boolean;
  onChange(value: string): void;
  onCursor?(line: number, column: number): void;
};

async function languageExtension(languageId: string): Promise<Extension> {
  const stream = (parser: unknown): Extension => StreamLanguage.define(parser as never);
  switch (languageId) {
    case 'javascript': return (await import('@codemirror/lang-javascript')).javascript({ jsx: true });
    case 'typescript': return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true });
    case 'json': return (await import('@codemirror/lang-json')).json();
    case 'html': return (await import('@codemirror/lang-html')).html();
    case 'css': return (await import('@codemirror/lang-css')).css();
    case 'scss': return stream((await import('@codemirror/legacy-modes/mode/sass')).sass);
    case 'less': return stream((await import('@codemirror/legacy-modes/mode/css')).less);
    case 'markdown': return (await import('@codemirror/lang-markdown')).markdown();
    case 'python': return (await import('@codemirror/lang-python')).python();
    case 'sql': return (await import('@codemirror/lang-sql')).sql();
    case 'java': return (await import('@codemirror/lang-java')).java();
    case 'cpp': return (await import('@codemirror/lang-cpp')).cpp();
    case 'rust': return (await import('@codemirror/lang-rust')).rust();
    case 'php': return (await import('@codemirror/lang-php')).php();
    case 'shell': return stream((await import('@codemirror/legacy-modes/mode/shell')).shell);
    case 'powershell': return stream((await import('@codemirror/legacy-modes/mode/powershell')).powerShell);
    case 'yaml': return stream((await import('@codemirror/legacy-modes/mode/yaml')).yaml);
    case 'toml': return stream((await import('@codemirror/legacy-modes/mode/toml')).toml);
    case 'xml': return stream((await import('@codemirror/legacy-modes/mode/xml')).xml);
    case 'kotlin': return stream((await import('@codemirror/legacy-modes/mode/clike')).kotlin);
    case 'dart': return stream((await import('@codemirror/legacy-modes/mode/clike')).dart);
    case 'csharp': return stream((await import('@codemirror/legacy-modes/mode/clike')).csharp);
    case 'go': return stream((await import('@codemirror/legacy-modes/mode/go')).go);
    case 'ruby': return stream((await import('@codemirror/legacy-modes/mode/ruby')).ruby);
    default: return [];
  }
}

function readToken(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function tokenHighlightStyle(): Extension {
  const keyword = readToken('--color-accent-primary', '#7c9cff');
  const string = readToken('--color-status-success', '#6db87a');
  const comment = readToken('--color-text-muted', '#858585');
  const number = readToken('--color-status-warning', '#c9a24d');
  const typeName = readToken('--color-status-info', '#7c9cff');
  const meta = readToken('--color-text-secondary', '#b4b4b4');
  const invalid = readToken('--color-status-danger', '#d46a6a');
  const primary = readToken('--color-text-primary', '#ededed');
  return syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: keyword },
    { tag: [tags.string, tags.special(tags.string), tags.regexp], color: string },
    { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: comment, fontStyle: 'italic' },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: number },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.self], color: typeName },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.definition(tags.function(tags.variableName))], color: typeName },
    { tag: [tags.propertyName, tags.attributeName, tags.labelName], color: meta },
    { tag: [tags.variableName, tags.name, tags.literal, tags.punctuation, tags.operator, tags.derefOperator, tags.separator], color: primary },
    { tag: [tags.meta, tags.modifier, tags.annotation, tags.processingInstruction], color: meta },
    { tag: tags.invalid, color: invalid },
    { tag: tags.heading, color: keyword, fontWeight: '600' },
    { tag: tags.link, color: typeName },
    { tag: tags.url, color: string },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: '600' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
  ]), { fallback: true });
}

function tokenTheme(): Extension {
  const token = (name: string, fallback: string) => readToken(name, fallback);
  return [
    EditorView.theme({
      '&': {
        height: '100%',
        color: token('--color-text-primary', 'CanvasText'),
        backgroundColor: token('--color-surface-canvas', 'Canvas'),
        fontFamily: token('--font-family-mono', 'monospace'),
        fontSize: token('--font-size-body', '13px'),
      },
      '.cm-content': { caretColor: token('--color-accent-primary', 'Highlight'), padding: token('--space-2', '8px') + ' 0' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: token('--color-accent-primary', 'Highlight') },
      '&.cm-focused': { outline: 'none' },
      '&.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: token('--color-accent-soft', 'Highlight') },
      '.cm-selectionBackground': { backgroundColor: token('--color-surface-selected', 'Highlight') },
      '.cm-activeLine': { backgroundColor: token('--color-surface-hover', 'transparent') },
      '.cm-gutters': {
        color: token('--color-text-muted', 'GrayText'),
        backgroundColor: token('--color-surface-sunken', 'Canvas'),
        borderRight: `1px solid ${token('--color-border-subtle', 'GrayText')}`,
      },
      '.cm-activeLineGutter': { color: token('--color-text-secondary', 'CanvasText'), backgroundColor: token('--color-surface-hover', 'transparent') },
      '.cm-foldPlaceholder': { color: token('--color-text-muted', 'GrayText'), backgroundColor: token('--color-surface-raised', 'Canvas'), borderColor: token('--color-border-default', 'GrayText') },
      '.cm-panels': { color: token('--color-text-primary', 'CanvasText'), backgroundColor: token('--color-surface-raised', 'Canvas') },
      '.cm-panels.cm-panels-top': { borderBottomColor: token('--color-border-default', 'GrayText') },
      '.cm-panel input': { color: token('--color-text-primary', 'CanvasText'), backgroundColor: token('--color-surface-sunken', 'Canvas'), border: `1px solid ${token('--color-border-default', 'GrayText')}` },
      '.cm-tooltip': { color: token('--color-text-primary', 'CanvasText'), backgroundColor: token('--color-surface-overlay', 'Canvas'), borderColor: token('--color-border-default', 'GrayText') },
    }, { dark: document.documentElement.dataset.theme !== 'light' }),
    tokenHighlightStyle(),
  ];
}

export function CodeEditor({ value, languageId, readOnly, wordWrap = false, onChange, onCursor }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  const cursorRef = useRef(onCursor);
  const language = useRef(new Compartment());
  const theme = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const initial = useRef({ value, readOnly, wordWrap });
  changeRef.current = onChange;
  cursorRef.current = onCursor;

  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: initial.current.value,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(),
        drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true), indentOnInput(),
        bracketMatching(), closeBrackets(),
        highlightActiveLine(), highlightSelectionMatches(), indentUnit.of('  '),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
        language.current.of([]), theme.current.of(tokenTheme()),
        editable.current.of([EditorState.readOnly.of(initial.current.readOnly), EditorView.editable.of(!initial.current.readOnly)]),
        wrapping.current.of(initial.current.wordWrap ? EditorView.lineWrapping : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changeRef.current(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            cursorRef.current?.(line.number, head - line.from + 1);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    const observer = new MutationObserver(() => view.dispatch({ effects: theme.current.reconfigure(tokenTheme()) }));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-density', 'class'] });
    return () => { observer.disconnect(); view.destroy(); viewRef.current = null; };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapping.current.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
  }, [wordWrap]);

  useEffect(() => {
    let cancelled = false;
    void languageExtension(languageId).then((extension) => {
      if (!cancelled && viewRef.current) viewRef.current.dispatch({ effects: language.current.reconfigure(extension) });
    });
    return () => { cancelled = true; };
  }, [languageId]);

  return <div ref={hostRef} className="files-editor" aria-label="File editor" />;
}
