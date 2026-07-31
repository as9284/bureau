import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  scopeSuggestions,
  scanTemplate,
  type VariableScope,
  type VariableToken,
} from './variablePreview';

type Props = {
  id?: string;
  value: string;
  scope: VariableScope;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  onChange(next: string): void;
  onKeyDown?(event: ReactKeyboardEvent<HTMLInputElement>): void;
};

/** The `{{` that opens a completion, if the caret sits inside an unclosed one. */
function openTokenStart(value: string, caret: number): number | null {
  const before = value.slice(0, caret);
  const start = before.lastIndexOf('{{');
  if (start === -1) return null;
  // A closed token before the caret means we are past it, not inside it.
  if (before.slice(start).includes('}}')) return null;
  return start;
}

/**
 * A single-line field that understands `{{variables}}`.
 *
 * Tokens are tinted by whether they resolve in the current scope, and typing `{{` offers the
 * variables in scope. The tint is drawn by a mirror layer sitting under a transparent input — the
 * two must keep identical metrics, which is why both are mono and share
 * `.api-variable-field__mirror` / `.control-input` padding.
 */
export function VariableField({
  id,
  value,
  scope,
  placeholder,
  ariaLabel,
  className,
  disabled = false,
  onChange,
  onKeyDown,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ start: number; query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const scan = scanTemplate(value, scope);
  const suggestions = menu
    ? scopeSuggestions(scope).filter((entry) =>
        entry.name.toLowerCase().includes(menu.query.toLowerCase())
      )
    : [];

  // The mirror does not scroll with the input on its own.
  const syncScroll = (): void => {
    if (mirrorRef.current && inputRef.current) {
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };
  useLayoutEffect(syncScroll, [value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [menu?.query]);

  const closeMenu = (): void => setMenu(null);

  const refreshMenu = (next: string, caret: number): void => {
    const start = openTokenStart(next, caret);
    if (start === null) {
      closeMenu();
      return;
    }
    setMenu({ start, query: next.slice(start + 2, caret) });
  };

  const accept = (name: string): void => {
    if (!menu) return;
    const input = inputRef.current;
    const caret = input?.selectionStart ?? value.length;
    // Swallow a `}}` the user already typed rather than doubling it.
    const tail = value.slice(caret);
    const closed = tail.startsWith('}}');
    const next = `${value.slice(0, menu.start)}{{${name}}}${closed ? tail.slice(2) : tail}`;
    onChange(next);
    closeMenu();
    const nextCaret = menu.start + name.length + 4;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (menu && suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          return (current + delta + suggestions.length) % suggestions.length;
        });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        accept(suggestions[activeIndex].name);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        return;
      }
    }
    onKeyDown?.(event);
  };

  const listboxId = id ? `${id}-variables` : undefined;

  return (
    <div className={['api-variable-field', className].filter(Boolean).join(' ')}>
      <div className="api-variable-field__mirror" ref={mirrorRef} aria-hidden="true">
        {renderTokens(value, scan.tokens)}
      </div>
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="control-input mono api-variable-field__input"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        role={menu && suggestions.length > 0 ? 'combobox' : undefined}
        aria-expanded={menu && suggestions.length > 0 ? true : undefined}
        aria-controls={menu && suggestions.length > 0 ? listboxId : undefined}
        onChange={(event) => {
          onChange(event.target.value);
          refreshMenu(event.target.value, event.target.selectionStart ?? 0);
        }}
        onKeyUp={(event) => {
          // Caret moves without an edit still open or close the menu.
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
            refreshMenu(value, event.currentTarget.selectionStart ?? 0);
          }
        }}
        onKeyDown={handleKeyDown}
        onScroll={syncScroll}
        onBlur={() => {
          // A click on a suggestion lands after blur; let it through first.
          window.setTimeout(closeMenu, 120);
        }}
      />

      {menu && suggestions.length > 0 ? (
        <ul className="api-variable-field__menu" id={listboxId} role="listbox">
          {suggestions.map((entry, index) => (
            <li key={entry.name} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                className={`api-variable-field__option${index === activeIndex ? ' is-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => accept(entry.name)}
              >
                <span className="api-variable-field__option-name mono">{entry.name}</span>
                <span className="api-variable-field__option-meta">
                  {entry.secret ? 'secret' : entry.origin}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Splits the raw text into plain runs and tinted token spans. */
function renderTokens(value: string, tokens: VariableToken[]) {
  const parts: Array<{ key: string; text: string; status?: VariableToken['status'] }> = [];
  let cursor = 0;
  for (const [index, token] of tokens.entries()) {
    if (token.start > cursor) {
      parts.push({ key: `text-${index}`, text: value.slice(cursor, token.start) });
    }
    parts.push({
      key: `token-${index}`,
      text: value.slice(token.start, token.end),
      status: token.status,
    });
    cursor = token.end;
  }
  if (cursor < value.length) parts.push({ key: 'text-tail', text: value.slice(cursor) });

  return parts.map((part) =>
    part.status ? (
      <span key={part.key} className={`api-variable-token is-${part.status}`}>
        {part.text}
      </span>
    ) : (
      <span key={part.key}>{part.text}</span>
    )
  );
}
