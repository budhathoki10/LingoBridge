import { isRecentlyAuthenticated } from "@lingobridge/auth";
import {
  ACCOUNT_PURGE_WINDOW_MILLISECONDS,
  getAccountOverview,
  TOMBSTONE_RETENTION_MILLISECONDS,
} from "@lingobridge/database";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePageSession } from "@/server/page-session";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";
import { PrivacyActions } from "./privacy-actions";

export const metadata: Metadata = { title: "Privacy and data" };

const DAY = 24 * 60 * 60 * 1_000;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PrivacyPage({ searchParams }: { searchParams: SearchParams }) {
  const { services, session, user } = await requirePageSession();
  const params = await searchParams;
  const now = services.now();
  const overview = await getAccountOverview(services.database, user.id, now);
  const reauth = typeof params.reauth === "string" ? params.reauth : null;

  return (
    <div className="page">
      <PageHeader
        description="Download what LingoBridge stores for this account, stop syncing, or delete it."
        title="Privacy and data"
      />

      <PrivacyActions
        phraseCount={overview.phraseCount}
        phraseSyncEnabled={overview.preferences.phraseSyncEnabled}
        preferencesRevision={overview.preferences.revision}
        reauthProblem={reauth === "mismatch" ? "mismatch" : reauth === "failed" ? "failed" : null}
        recentlyAuthenticated={isRecentlyAuthenticated(session, now)}
      />

      <section aria-labelledby="stored-title" className="card">
        <div className="card__header">
          <h2 id="stored-title">What this account stores</h2>
        </div>
        <div className="card__body">
          <dl className="definition-list">
            <div>
              <dt>Stored</dt>
              <dd>
                Your sign-in identity and email, phrases and words you explicitly saved, synced
                preferences, and the name and activity dates of each connected extension.
              </dd>
            </div>
            <div>
              <dt>Never stored</dt>
              <dd>
                Translations you didn’t save, page addresses, browsing history, website permissions,
                and the text of anything you only selected.
              </dd>
            </div>
            <div>
              <dt>Translation providers</dt>
              <dd>
                NVIDIA Nemotron translates first. If it cannot answer in time, MyMemory translates
                and receives the gateway contact email in its request. NVIDIA Riva is tried last,
                only for a supported language direction. Explain and word lookups use NVIDIA
                Nemotron, with an OpenRouter model as the backup. Each result shows which provider
                produced it.
              </dd>
            </div>
            <div>
              <dt>Deleted phrases</dt>
              <dd>
                Text is erased immediately. A marker with no text is kept for{" "}
                {Math.round(TOMBSTONE_RETENTION_MILLISECONDS / DAY)} days so other devices also
                remove the phrase.
              </dd>
            </div>
            <div>
              <dt>Deleted accounts</dt>
              <dd>
                Phrases, preferences, and sessions are removed at once. An empty account record
                without your email or name is purged within{" "}
                {Math.round(ACCOUNT_PURGE_WINDOW_MILLISECONDS / DAY)} days.
              </dd>
            </div>
            <div>
              <dt>Privacy policy</dt>
              <dd className="tabular">Version {PRIVACY_POLICY_VERSION}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  );
}
