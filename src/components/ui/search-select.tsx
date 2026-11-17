"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { useApiQuery } from "@/services/client/query";
import { useDebounced } from "@/services/client/use-debounced";

interface Props<T> {
  id?: string;
  /** Text shown while nothing is being typed (the current selection). */
  selectedLabel: string;
  placeholder: string;
  ariaLabel: string;
  /** Search URL for a term (results come from the server, scoped to the caller). */
  url: (q: string) => string;
  items: (data: unknown) => T[];
  itemKey: (item: T) => string;
  render: (item: T) => ReactNode;
  onPick: (item: T) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  invalid?: boolean;
  describedBy?: string;
  small?: boolean;
  disabled?: boolean;
}

const popover = "absolute z-[60] border border-divider bg-bg shadow-[var(--shadow-md)]";

/**
 * Type-to-search picker on the shared query cache: an `.input` with a result
 * list in the same popover style as the top-bar search. Arrow keys move,
 * Enter picks, Escape closes.
 */
export function SearchSelect<T>(props: Props<T>) {
  const listId = useId();
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const term = useDebounced((text ?? "").trim());
  const q = useApiQuery<unknown>(open ? props.url(term) : null);
  const results = q.data ? props.items(q.data) : [];

  const pick = (item: T) => {
    props.onPick(item);
    setText(null);
    setOpen(false);
  };

  return (
    <div className="relative min-w-0">
      <input
        id={props.id}
        className={`input ${props.small ? "input-sm" : ""}`}
        role="combobox"
        aria-label={props.ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        autoComplete="off"
        disabled={props.disabled}
        placeholder={props.placeholder}
        value={text ?? props.selectedLabel}
        onFocus={(e) => {
          setOpen(true);
          setActive(0);
          e.currentTarget.select();
        }}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
            setText(null);
          }, 150)
        }
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (open && e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (open && e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (open && e.key === "Enter" && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            setText(null);
          } else props.onKeyDown?.(e);
        }}
      />
      {open ? (
        <div id={listId} role="listbox" className={`${popover} top-[calc(100%+2px)] right-0 left-0 max-h-[280px] min-w-[280px] overflow-y-auto py-[6px]`}>
          {results.map((item, i) => (
            <div
              key={props.itemKey(item)}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-[7px] text-[13px] ${i === active ? "bg-accent-100" : ""}`}
            >
              {props.render(item)}
            </div>
          ))}
          {q.loading ? <div className="px-3 py-[10px] text-[13px] text-neutral-700">Searching…</div> : null}
          {q.error ? <div className="px-3 py-[10px] text-[13px] text-danger-800">Search failed. Try again.</div> : null}
          {!q.loading && !q.error && results.length === 0 ? <div className="px-3 py-[10px] text-[13px] text-neutral-700">No matches.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
