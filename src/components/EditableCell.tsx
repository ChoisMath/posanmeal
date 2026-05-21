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
    if (draft === value) {
      setEditing(false);
      return;
    }
    const err = validate?.(draft);
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const r = await onSave(draft);
    setSaving(false);
    if (r.ok) {
      setEditing(false);
    } else if (r.message) {
      toast.error(r.message);
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
