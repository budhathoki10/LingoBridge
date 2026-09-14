import { useEffect, useState } from "react";
import {
  ACCOUNT_STATUS_STORAGE_KEY,
  type AccountMessageResult,
  type AccountMessageType,
  type AccountStatus,
  normalizeAccountStatus,
} from "../../lib/account-status";
import { DASHBOARD_ORIGIN } from "../../lib/dashboard-config";

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
      <section aria-busy="true" className="account-card">
        <h2>Dashboard sync</h2>
        <p className="account-card__text">Checking connection…</p>
      </section>
    );
  }

  if (status.connection === "revoked") {
    return (
      <section className="account-card account-card--warning">
        <h2>Dashboard disconnected</h2>
        <p className="account-card__text">
          This extension is no longer connected to your account. Choose what happens to the phrases
          saved on this device.
        </p>
        <div className="account-card__actions">
          <button
            disabled={busy !== null}
            onClick={() => void act("lingobridge:account:keep-local")}
            type="button"
          >
            Keep phrases here
          </button>
          <button
            className="account-card__quiet"
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
    return (
      <section className="account-card">
        <h2>Dashboard sync</h2>
        <p className="account-card__text">
          Connect to sync phrases already saved on this device and phrases you save later. They
          become visible on the web and your other connected devices. Translation works without an
          account.
        </p>
        {connecting ? (
          <p className="account-card__text" role="status">
            Finish in the Chrome sign-in window. Retry connection brings that window forward.
          </p>
        ) : null}
        {notice || status.lastError ? (
          <p className="account-card__error" role="alert">
            {notice || status.lastError}
          </p>
        ) : null}
        <div className="account-card__actions">
          <button
            disabled={busy !== null}
            onClick={() => void act("lingobridge:account:connect")}
            type="button"
          >
            {connecting ? "Retry connection" : "Connect dashboard"}
          </button>
        </div>
      </section>
    );
  }

  const who = status.account?.email ?? status.account?.displayName ?? "your account";
  const syncing = status.syncing || busy === "lingobridge:account:sync-now";
  let detail: string;
  if (syncing) detail = "Syncing…";
  else if (!status.phraseSyncEnabled) detail = "Phrase sync is off for this account.";
  else if (status.lastError && status.nextAttemptAt) detail = `${status.lastError}`;
  else detail = `Synced ${relativeTime(status.lastSyncedAt)}`;

  return (
    <section className="account-card">
      <div className="account-card__heading">
        <h2>Dashboard sync</h2>
        <span
          className={`account-card__badge${status.lastError ? " account-card__badge--warning" : ""}`}
        >
          {status.lastError ? "Needs attention" : "Connected"}
        </span>
      </div>
      <p className="account-card__text">
        Signed in as <strong>{who}</strong>
      </p>
      <p
        aria-live="polite"
        className={status.lastError && !syncing ? "account-card__error" : "account-card__text"}
      >
        {detail}
        {status.pendingChanges > 0 && !syncing ? ` · ${status.pendingChanges} waiting` : ""}
      </p>
      {notice ? (
        <p className="account-card__error" role="alert">
          {notice}
        </p>
      ) : null}
      <div className="account-card__actions">
        <button
          disabled={busy !== null || syncing}
          onClick={() => void act("lingobridge:account:sync-now")}
          type="button"
        >
          Sync now
        </button>
        <a
          className="account-card__link"
          href={`${DASHBOARD_ORIGIN}/overview`}
          rel="noreferrer"
          target="_blank"
        >
          Open dashboard
        </a>
        <button
          className="account-card__quiet"
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
