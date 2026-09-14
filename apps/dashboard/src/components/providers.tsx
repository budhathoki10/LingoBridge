"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CloseIcon } from "./icons";

/* ---------- CSRF-aware requests ---------- */

const CsrfContext = createContext<string>("");

export type ApiResult<T> =
  | { data: T; ok: true; status: number }
  | { data: Record<string, unknown> | null; message: string; ok: false; status: number };

export function useDashboardApi() {
  const csrf = useContext(CsrfContext);
  return useCallback(
    async <T,>(
      path: string,
      body: unknown,
      init: { keepalive?: boolean } = {},
    ): Promise<ApiResult<T>> => {
      let response: Response;
      try {
        response = await fetch(path, {
          body: JSON.stringify(body),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          keepalive: init.keepalive,
          method: "POST",
        });
      } catch {
        return {
          data: null,
          message: "You appear to be offline. Check your connection and try again.",
          ok: false,
          status: 0,
        };
      }
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (response.ok) return { data: payload as T, ok: true, status: response.status };
      const message =
        typeof payload?.message === "string"
          ? payload.message
          : response.status === 401
            ? "Your session ended. Sign in again."
            : "Something went wrong. Try again.";
      return { data: payload, message, ok: false, status: response.status };
    },
    [csrf],
  );
}

/* ---------- Toasts ---------- */

interface Toast {
  action?: { label: string; onAction: () => void };
  id: number;
  message: string;
  onExpire?: () => void;
  tone: "neutral" | "danger";
}

type ToastInput = Omit<Toast, "id"> & { durationMs?: number };

const ToastContext = createContext<(toast: ToastInput) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

function ToastView({
  toast,
  dismiss,
}: {
  dismiss: (id: number, expired: boolean) => void;
  toast: Toast;
}) {
  return (
    <div className={`toast${toast.tone === "danger" ? " toast--danger" : ""}`} role="status">
      <span className="toast__message">{toast.message}</span>
      {toast.action ? (
        <button
          className="button button--small"
          onClick={() => {
            toast.action?.onAction();
            dismiss(toast.id, false);
          }}
          type="button"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        aria-label="Dismiss notification"
        className="button button--ghost button--small button--icon"
        onClick={() => dismiss(toast.id, true)}
        type="button"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

export function DashboardProviders({
  children,
  csrfToken,
}: {
  children: ReactNode;
  csrfToken: string;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const dismiss = useCallback((id: number, expired: boolean) => {
    const toast = toastsRef.current.find((entry) => entry.id === id);
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((entry) => entry.id !== id));
    if (expired) toast?.onExpire?.();
  }, []);

  const push = useCallback(
    ({ durationMs = 5_000, ...toast }: ToastInput) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id, true), durationMs),
      );
    },
    [dismiss],
  );

  // Pending deferred actions (such as an undoable delete) commit if the page is hidden or closed.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== "hidden") return;
      for (const toast of toastsRef.current) {
        if (toast.onExpire) dismiss(toast.id, true);
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [dismiss]);

  const value = useMemo(() => push, [push]);

  return (
    <CsrfContext.Provider value={csrfToken}>
      <ToastContext.Provider value={value}>
        {children}
        <div aria-live="polite" className="toasts">
          {toasts.map((toast) => (
            <ToastView dismiss={dismiss} key={toast.id} toast={toast} />
          ))}
        </div>
      </ToastContext.Provider>
    </CsrfContext.Provider>
  );
}

export function useCsrfToken() {
  return useContext(CsrfContext);
}
