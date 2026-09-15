"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

interface ConfirmDialogProps {
  busy?: boolean;
  children?: ReactNode;
  confirmDisabled?: boolean;
  confirmLabel: string;
  description: ReactNode;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  tone?: "danger" | "primary";
}

/**
 * Native <dialog> with showModal(): the browser provides the focus trap, inert background, and
 * Escape handling. Focus returns to whatever opened it. The confirm button names the action.
 */
export function ConfirmDialog({
  busy = false,
  children,
  confirmDisabled = false,
  confirmLabel,
  description,
  error,
  onCancel,
  onConfirm,
  open,
  title,
  tone = "danger",
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocus.current?.focus();
    }
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes the native dialog
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !busy) onCancel();
      }}
      ref={ref}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !confirmDisabled) onConfirm();
        }}
      >
        <div className="dialog__body">
          <h2 id={titleId}>{title}</h2>
          <div id={descriptionId}>
            {typeof description === "string" ? <p>{description}</p> : description}
          </div>
          {children}
          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog__footer">
          <button className="button" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            aria-disabled={confirmDisabled || busy}
            className={`button ${tone === "danger" ? "button--danger" : "button--primary"}`}
            type="submit"
          >
            {busy ? <span aria-hidden="true" className="spinner" /> : null}
            {confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
