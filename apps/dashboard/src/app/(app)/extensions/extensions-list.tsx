"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/dialog";
import { BrowserIcon } from "@/components/icons";
import { useDashboardApi, useToast } from "@/components/providers";
import { formatDate, formatRelative, plural } from "@/lib/format";

export interface SessionView {
  connectedAt: string;
  deviceLabel: string;
  expired: boolean;
  id: string;
  lastUsedAt: string;
  revokedAt: string | null;
  revokedReason: "user" | "refresh-reuse" | "account-deleted" | null;
}

function statusBadge(session: SessionView) {
  if (session.revokedAt) {
    return (
      <span className="badge">
        {session.revokedReason === "refresh-reuse" ? "Revoked for safety" : "Revoked"}
      </span>
    );
  }
  if (session.expired) return <span className="badge badge--warning">Expired</span>;
  return (
    <span className="badge badge--success">
      <span className="dot" />
      Active
    </span>
  );
}

export function ExtensionsList({ now, sessions }: { now: string; sessions: SessionView[] }) {
  const api = useDashboardApi();
  const toast = useToast();
  const router = useRouter();
  const nowDate = new Date(now);
  const [target, setTarget] = useState<SessionView | "all" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = sessions.filter((session) => !session.revokedAt && !session.expired);
  const inactive = sessions.filter((session) => session.revokedAt || session.expired);

  async function confirmRevoke() {
    if (!target) return;
    setBusy(true);
    setError(null);
    const result = await api<{ revoked: number }>(
      "/api/dashboard/extensions/revoke",
      target === "all" ? { all: true } : { sessionId: target.id },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setTarget(null);
    toast({
      message:
        target === "all"
          ? `Disconnected ${plural(result.data.revoked, "extension")}`
          : `Disconnected ${target.deviceLabel}`,
      tone: "neutral",
    });
    router.refresh();
  }

  if (sessions.length === 0) {
    return (
      <div className="empty">
        <h2>No extensions connected</h2>
        <p>
          In the LingoBridge popup, choose <strong>Connect dashboard</strong>. Chrome opens a
          sign-in window; after you approve, the connection appears here and saved phrases start
          syncing.
        </p>
      </div>
    );
  }

  const renderSession = (session: SessionView) => {
    const inactiveSession = Boolean(session.revokedAt) || session.expired;
    return (
      <li className={`session${inactiveSession ? " session--revoked" : ""}`} key={session.id}>
        <span aria-hidden="true" className="session__icon">
          <BrowserIcon size={18} />
        </span>
        <div className="session__body">
          <div className="session__text">
            <span className="session__title">
              {session.deviceLabel}
              {statusBadge(session)}
            </span>
            <span className="session__meta">
              Connected {formatDate(session.connectedAt)} ·{" "}
              {session.revokedAt
                ? `Revoked ${formatDate(session.revokedAt)}`
                : `Last used ${formatRelative(session.lastUsedAt, nowDate).toLowerCase()}`}
            </span>
          </div>
          {inactiveSession ? null : (
            <button
              className="button button--danger-quiet button--small"
              onClick={() => setTarget(session)}
              type="button"
            >
              Revoke
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <section aria-labelledby="active-title" className="card">
        <div className="card__header">
          <h2 id="active-title">
            Active <span className="muted tabular">{active.length}</span>
          </h2>
          {active.length > 1 ? (
            <button
              className="button button--danger-quiet button--small"
              onClick={() => setTarget("all")}
              type="button"
            >
              Revoke all
            </button>
          ) : null}
        </div>
        {active.length === 0 ? (
          <div className="card__body">
            <p className="muted">
              No active connections. Connect again from the extension popup whenever you’re ready.
            </p>
          </div>
        ) : (
          <ul className="session-list">{active.map(renderSession)}</ul>
        )}
      </section>

      {inactive.length > 0 ? (
        <section aria-labelledby="history-title" className="card">
          <div className="card__header">
            <h2 id="history-title">Revoked and expired</h2>
          </div>
          <ul className="session-list">{inactive.map(renderSession)}</ul>
        </section>
      ) : null}

      <ConfirmDialog
        busy={busy}
        confirmLabel={
          target === "all" ? `Revoke ${plural(active.length, "extension")}` : "Revoke connection"
        }
        description={
          target === "all"
            ? `Every connected extension is refused on its next sync. Phrases already saved on those devices stay there.`
            : `${target ? target.deviceLabel : "This extension"} is refused on its next sync. Its local phrases stay on that device, and it can connect again later.`
        }
        error={error}
        onCancel={() => {
          setTarget(null);
          setError(null);
        }}
        onConfirm={() => void confirmRevoke()}
        open={target !== null}
        title={target === "all" ? "Revoke all connections?" : "Revoke this connection?"}
      />
    </>
  );
}
