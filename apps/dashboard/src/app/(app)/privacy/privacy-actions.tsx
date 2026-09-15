"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/dialog";
import { DownloadIcon } from "@/components/icons";
import { useDashboardApi, useToast } from "@/components/providers";
import { plural } from "@/lib/format";
import { ACCOUNT_DELETION_CONFIRMATION, DELETE_ALL_CONFIRMATION } from "@/lib/privacy";

type Pending = "delete-phrases" | "stop-sync" | "delete-account" | null;

export function PrivacyActions({
  phraseCount,
  phraseSyncEnabled,
  preferencesRevision,
  reauthProblem,
  recentlyAuthenticated,
}: {
  phraseCount: number;
  phraseSyncEnabled: boolean;
  preferencesRevision: number;
  reauthProblem: "mismatch" | "failed" | null;
  recentlyAuthenticated: boolean;
}) {
  const api = useDashboardApi();
  const toast = useToast();
  const router = useRouter();
  const confirmId = useId();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  function open(action: Pending) {
    setPending(action);
    setTyped("");
    setError(null);
  }

  async function run() {
    setBusy(true);
    setError(null);
    if (pending === "delete-phrases") {
      const result = await api<{ deleted: number }>("/api/dashboard/phrases/delete", {
        all: true,
        confirmation: DELETE_ALL_CONFIRMATION,
      });
      setBusy(false);
      if (!result.ok) return setError(result.message);
      setPending(null);
      toast({
        message: `Deleted ${plural(result.data.deleted, "synced phrase")}`,
        tone: "neutral",
      });
      router.refresh();
      return;
    }
    if (pending === "stop-sync") {
      const result = await api("/api/dashboard/preferences", {
        baseRevision: preferencesRevision,
        phraseSyncEnabled: !phraseSyncEnabled,
      });
      setBusy(false);
      if (!result.ok) {
        return setError(
          result.status === 409
            ? "Settings changed on another device. Reload and try again."
            : result.message,
        );
      }
      setPending(null);
      toast({
        message: phraseSyncEnabled ? "Phrase sync turned off" : "Phrase sync turned on",
        tone: "neutral",
      });
      router.refresh();
      return;
    }
    if (pending === "delete-account") {
      const result = await api<{ receiptId: string }>("/api/dashboard/account/delete", {
        confirmation: ACCOUNT_DELETION_CONFIRMATION,
      });
      if (!result.ok) {
        setBusy(false);
        if (result.data?.code === "reauthentication-required") {
          window.location.href = "/auth/reauthenticate?returnTo=/privacy%23delete-account";
          return;
        }
        return setError(result.message);
      }
      window.location.replace(
        `/account-deleted?receipt=${encodeURIComponent(result.data.receiptId)}`,
      );
    }
  }

  return (
    <>
      <section aria-labelledby="data-title" className="card">
        <div className="card__header">
          <h2 id="data-title">Your data</h2>
        </div>
        <div className="setting">
          <div className="setting__text">
            <h3>Download account data</h3>
            <p>
              Your account details, preferences, saved phrases, and connected-extension history, as
              JSON.
            </p>
          </div>
          <div className="setting__control setting__control--end">
            <a className="button" href="/api/dashboard/export?scope=account">
              <DownloadIcon size={16} />
              Download
            </a>
          </div>
        </div>
        <div className="setting">
          <div className="setting__text">
            <h3>Phrase sync</h3>
            <p>
              {phraseSyncEnabled
                ? "Connected extensions upload phrases you save. Turn this off to keep new phrases only on each device."
                : "Off. New phrases stay only on the device where you saved them."}
            </p>
          </div>
          <div className="setting__control setting__control--end">
            <button className="button" onClick={() => open("stop-sync")} type="button">
              {phraseSyncEnabled ? "Turn off sync" : "Turn on sync"}
            </button>
          </div>
        </div>
        <div className="setting">
          <div className="setting__text">
            <h3>Delete synced phrases</h3>
            <p>
              {phraseCount === 0
                ? "No synced phrases are stored."
                : `Removes ${plural(phraseCount, "phrase")} from this account and from connected extensions at their next sync.`}
            </p>
          </div>
          <div className="setting__control setting__control--end">
            <button
              className="button button--danger-quiet"
              disabled={phraseCount === 0}
              onClick={() => open("delete-phrases")}
              type="button"
            >
              Delete all phrases
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="delete-account-title" className="card" id="delete-account">
        <div className="card__header">
          <h2 id="delete-account-title">Delete account</h2>
        </div>
        <div className="card__body section">
          <p className="muted">
            Deletes every synced phrase and preference, disconnects every extension, and signs you
            out. Phrases saved inside the extension on each device are not touched; each device asks
            whether to keep them.
          </p>
          {reauthProblem === "mismatch" ? (
            <p className="callout callout--danger" role="alert">
              You confirmed with a different account. Sign in with the account you want to delete.
            </p>
          ) : null}
          {reauthProblem === "failed" ? (
            <p className="callout callout--danger" role="alert">
              We couldn’t confirm it was you. Try again.
            </p>
          ) : null}
          <div>
            {recentlyAuthenticated ? (
              <button
                className="button button--danger"
                onClick={() => open("delete-account")}
                type="button"
              >
                Delete account
              </button>
            ) : (
              <a className="button" href="/auth/reauthenticate?returnTo=/privacy%23delete-account">
                Confirm it’s you to continue
              </a>
            )}
          </div>
          {recentlyAuthenticated ? null : (
            <p className="field__hint">
              For your protection, deleting an account needs a sign-in from the last 5 minutes.
            </p>
          )}
        </div>
      </section>

      <ConfirmDialog
        busy={busy}
        confirmDisabled={typed.trim().toLowerCase() !== DELETE_ALL_CONFIRMATION}
        confirmLabel={`Delete ${plural(phraseCount, "phrase")}`}
        description="Synced phrases are removed from this account and from connected extensions when they next sync. This can’t be undone."
        error={error}
        onCancel={() => setPending(null)}
        onConfirm={() => void run()}
        open={pending === "delete-phrases"}
        title="Delete all synced phrases?"
      >
        <div className="field">
          <label className="field__label" htmlFor={`${confirmId}-phrases`}>
            Type <strong>{DELETE_ALL_CONFIRMATION}</strong> to confirm
          </label>
          <input
            autoComplete="off"
            className="input"
            id={`${confirmId}-phrases`}
            onChange={(event) => setTyped(event.target.value)}
            value={typed}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        busy={busy}
        confirmLabel={phraseSyncEnabled ? "Turn off sync" : "Turn on sync"}
        description={
          phraseSyncEnabled
            ? "Extensions stop uploading new phrases. Phrases already synced stay in this account until you delete them."
            : "Connected extensions start uploading phrases you save again."
        }
        error={error}
        onCancel={() => setPending(null)}
        onConfirm={() => void run()}
        open={pending === "stop-sync"}
        title={phraseSyncEnabled ? "Turn off phrase sync?" : "Turn on phrase sync?"}
        tone="primary"
      />

      <ConfirmDialog
        busy={busy}
        confirmDisabled={typed.trim().toLowerCase() !== ACCOUNT_DELETION_CONFIRMATION}
        confirmLabel="Delete account"
        description={
          <p>
            This deletes {plural(phraseCount, "synced phrase")}, your preferences, and every
            extension connection, then signs you out. This can’t be undone.
          </p>
        }
        error={error}
        onCancel={() => setPending(null)}
        onConfirm={() => void run()}
        open={pending === "delete-account"}
        title="Delete your LingoBridge account?"
      >
        <div className="field">
          <label className="field__label" htmlFor={`${confirmId}-account`}>
            Type <strong>{ACCOUNT_DELETION_CONFIRMATION}</strong> to confirm
          </label>
          <input
            autoComplete="off"
            className="input"
            id={`${confirmId}-account`}
            onChange={(event) => setTyped(event.target.value)}
            value={typed}
          />
        </div>
      </ConfirmDialog>
    </>
  );
}
