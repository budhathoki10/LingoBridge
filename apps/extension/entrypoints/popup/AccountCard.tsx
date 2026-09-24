import { useEffect, useState } from "react";
import {
  ACCOUNT_STATUS_STORAGE_KEY,
  type AccountMessageResult,
  type AccountMessageType,
  type AccountStatus,
  normalizeAccountStatus,
} from "../../lib/account-status";
import { DASHBOARD_ORIGIN } from "../../lib/dashboard-config";
import { ExternalIcon } from "./Icons";

function relativeTime(value: string | null): string {
  if (!value) return "not yet";
  const minutes = Math.round((Date.now() - Date.parse(value)) / 60_000);
  if (Number.isNaN(minutes)) return "not yet";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : new Date(value).toLocaleDateString();
}

async function send(type: AccountMessageType): Promise<AccountMessageResult> {
  try {
    const result = (await browser.runtime.sendMessage({ type })) as
      | AccountMessageResult
      | undefined;
    return result ?? { message: "The extension didn’t respond. Try again.", ok: false };
  } catch {
    return { message: "The extension didn’t respond. Try again.", ok: false };
  }
}

/**
 * Dashboard connection controls. The popup never sees a token: it asks the background worker to
 * act and renders the credential-free status the worker writes to storage.
 */
export function AccountCard() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [busy, setBusy] = useState<AccountMessageType | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void browser.storage.local.get(ACCOUNT_STATUS_STORAGE_KEY).then((stored) => {
      const current = normalizeAccountStatus(stored[ACCOUNT_STATUS_STORAGE_KEY]);
      if (active) setStatus(current);
      // Opening the popup checks the connection, so a dashboard sign-out shows here right away
      // instead of at the next periodic sync. The result arrives through the stored status.
      if (current.connection === "connected" && !current.syncing) {
        void send("lingobridge:account:sync-now");
      }
    });
    const onChange = (changes: Record<string, Browser.storage.StorageChange>, area: string) => {
      if (area === "local" && changes[ACCOUNT_STATUS_STORAGE_KEY]) {
        setStatus(normalizeAccountStatus(changes[ACCOUNT_STATUS_STORAGE_KEY].newValue));
      }
    };
    browser.storage.onChanged.addListener(onChange);
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(onChange);
    };
  }, []);

  async function act(type: AccountMessageType) {
    setBusy(type);
    setNotice(null);
    const result = await send(type);
    setBusy(null);
    if (!result.ok && result.message) setNotice(result.message);
  }

  if (!status) {
    return (
      <section aria-busy="true" className="card account-card">
        <h2 className="card__title">Dashboard sync</h2>
        <p className="card__text">Checking connection…</p>
      </section>
    );
  }

  if (status.connection === "revoked") {
    return (
      <section className="card card--warning account-card">
        <div className="card__heading">
          <h2 className="card__title">Dashboard disconnected</h2>
          <span className="badge badge--warning">Action needed</span>
        </div>
        <p className="card__text">
          This extension is no longer connected to your account. Choose what happens to the phrases
          saved on this device.
        </p>
        <div className="card__actions">
          <button
            className="btn btn--primary"
            disabled={busy !== null}
            onClick={() => void act("lingobridge:account:keep-local")}
            type="button"
          >
            Keep phrases here
          </button>
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() => void act("lingobridge:account:delete-local")}
            type="button"
          >
            Delete local phrases
          </button>
        </div>
      </section>
    );
  }

  if (status.connection !== "connected") {
    const connecting = status.connection === "connecting";
    const error = notice || status.lastError;
    return (
      <section className="card account-card">
        <h2 className="card__title">Dashboard sync</h2>
        <p className="card__text">
          Connect your dashboard account to enable translation and sync the phrases you save across
          devices.
        </p>
        {connecting ? (
          <p className="card__text" role="status">
            Finish in the Chrome sign-in window. Retry connection brings it back, or opens a new one
            if it was closed.
          </p>
        ) : null}
        {error ? (
          <p className="card__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="card__actions">
          <button
            className="btn btn--primary"
            disabled={busy !== null}
            onClick={() => void act("lingobridge:account:connect")}
            type="button"
          >
            {busy === "lingobridge:account:connect" ? (
              <span aria-hidden="true" className="spinner" />
            ) : null}
            {connecting ? "Retry connection" : "Connect dashboard"}
          </button>
        </div>
      </section>
    );
  }

  const who = status.account?.email ?? status.account?.displayName ?? "your account";
  const syncing = status.syncing || busy === "lingobridge:account:sync-now";
  const waiting = status.pendingChanges > 0 ? ` · ${status.pendingChanges} waiting` : "";
  const showError = Boolean(status.lastError) && !syncing;
  let detail: string;
  if (syncing) detail = "Syncing…";
  else if (!status.phraseSyncEnabled) detail = "Phrase sync is off for this account.";
  else detail = `Synced ${relativeTime(status.lastSyncedAt)}${waiting}`;

  return (
    <section className="card account-card">
      <div className="card__heading">
        <h2 className="card__title">Dashboard sync</h2>
        {syncing ? (
          <span className="badge badge--muted">Syncing</span>
        ) : status.lastError ? (
          <span className="badge badge--warning">Needs attention</span>
        ) : (
          <span className="badge">Connected</span>
        )}
      </div>
      <p className="card__text">
        Signed in as <strong>{who}</strong>
      </p>
      <p aria-live="polite" className="card__text">
        {detail}
      </p>
      {showError ? (
        <p className="card__error" role="alert">
          {status.lastError}
          {status.nextAttemptAt
            ? " It will retry automatically."
            : " Choose Sync now to try again."}
        </p>
      ) : null}
      {notice ? (
        <p className="card__error" role="alert">
          {notice}
        </p>
      ) : null}
      <div className="card__actions">
        <button
          className="btn btn--primary"
          disabled={busy !== null || syncing}
          onClick={() => void act("lingobridge:account:sync-now")}
          type="button"
        >
          {syncing ? <span aria-hidden="true" className="spinner" /> : null}
          Sync now
        </button>
        <a className="btn" href={`${DASHBOARD_ORIGIN}/overview`} rel="noreferrer" target="_blank">
          Open dashboard
          <ExternalIcon size={14} />
        </a>
        <button
          className="btn btn--ghost"
          disabled={busy !== null}
          onClick={() => void act("lingobridge:account:disconnect")}
          type="button"
        >
          Disconnect
        </button>
      </div>
    </section>
  );
}
