"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type SaveResult = { ok: true } | { ok: false; message: string };

interface CommonProps {
  value: string;
  onSave: (next: string) => Promise<SaveResult>;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

interface EditableTextCellProps extends CommonProps {
  inputType?: "text" | "number";
  placeholder?: string;
  validate?: (next: string) => string | null;
}

export function EditableTextCell({
  value,
  onSave,
  ariaLabel,
  className,
  disabled,
  inputType = "text",
  placeholder,
  validate,
}: EditableTextCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committingRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      inputRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [editing]);

  function enter() {
    if (disabled) return;
    setDraft(value);
    setEditing(true);
  }

  async function commit() {
    if (committingRef.current) return;
    if (draft === value) {
      setEditing(false);
      return;
    }
    const err = validate?.(draft);
    if (err) {
      toast.error(err);
      return;
    }
    committingRef.current = true;
    setSaving(true);
    try {
      const r = await onSave(draft);
      if (r.ok) {
        setEditing(false);
      } else if (r.message) {
        toast.error(r.message);
      }
    } catch {
      toast.error("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
      committingRef.current = false;
    }
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className={className}>
        <input
          ref={inputRef}
          type={inputType}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={saving}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="w-full px-1 py-0.5 rounded ring-1 ring-primary bg-background outline-none whitespace-nowrap text-sm disabled:opacity-60"
        />
      </div>
    );
  }

  return (
    <div
      className={className}
      onClick={enter}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          enter();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled}
    >
      <span
        className={`block px-1 py-0.5 rounded min-h-7 whitespace-nowrap text-sm ${
          disabled ? "text-muted-foreground" : "cursor-pointer hover:bg-muted/40"
        } ${value === "" && placeholder ? "text-muted-foreground italic" : ""}`}
      >
        {value === "" ? placeholder ?? "—" : value}
      </span>
    </div>
  );
}

interface EditableSelectCellProps extends CommonProps {
  options: Array<{ value: string; label: string }>;
  emptyLabel?: string;
}

export function EditableSelectCell({
  value,
  onSave,
  ariaLabel,
  className,
  disabled,
  options,
  emptyLabel,
}: EditableSelectCellProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const committingRef = useRef(false);

  useEffect(() => {
    if (editing && selectRef.current) {
      selectRef.current.focus();
      selectRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [editing]);

  function enter() {
    if (disabled) return;
    setEditing(true);
  }

  async function commitWith(next: string) {
    if (committingRef.current) return;
    if (next === value) {
      setEditing(false);
      return;
    }
    committingRef.current = true;
    setSaving(true);
    try {
      const r = await onSave(next);
      if (r.ok) {
        setEditing(false);
      } else if (r.message) {
        toast.error(r.message);
      } else {
        // Cancelled with no message — close to reset the controlled select to value prop
        setEditing(false);
      }
    } catch {
      toast.error("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
      committingRef.current = false;
    }
  }

  function cancel() {
    setEditing(false);
  }

  const displayLabel =
    options.find((o) => o.value === value)?.label ?? (value === "" ? emptyLabel ?? "—" : value);

  if (editing) {
    return (
      <div className={className}>
        <select
          ref={selectRef}
          value={value}
          onChange={(e) => commitWith(e.target.value)}
          onBlur={() => {
            if (!committingRef.current) setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          disabled={saving}
          aria-label={ariaLabel}
          className="w-full px-1 py-0.5 rounded ring-1 ring-primary bg-background outline-none whitespace-nowrap text-sm disabled:opacity-60"
        >
          {(emptyLabel != null || value === "") && (
            <option value="">{emptyLabel ?? "—"}</option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div
      className={className}
      onClick={enter}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          enter();
        }
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={disabled}
    >
      <span
        className={`block px-1 py-0.5 rounded min-h-7 whitespace-nowrap text-sm ${
          disabled ? "text-muted-foreground" : "cursor-pointer hover:bg-muted/40"
        } ${value === "" ? "text-muted-foreground" : ""}`}
      >
        {displayLabel}
      </span>
    </div>
  );
}
