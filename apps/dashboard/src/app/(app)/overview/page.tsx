import { getAccountOverview } from "@lingobridge/database";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  BrowserIcon,
  ExtensionsIcon,
  PhrasesIcon,
  PreferencesIcon,
} from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { formatDate, formatRelative, languageName, plural, providerLabel } from "@/lib/format";
import { CHROME_WEB_STORE_URL } from "@/lib/links";
import { requirePageSession } from "@/server/page-session";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { services, user } = await requirePageSession();
  const now = services.now();
  const overview = await getAccountOverview(services.database, user.id, now);
  const connected = overview.activeExtensionSessions > 0;
  const firstName = user.displayName?.split(" ")[0];

  return (
    <div className="page page--overview">
      <PageHeader
        actions={
          <span className={`badge ${connected ? "badge--success" : "badge--warning"}`}>
            <span className="dot" />
            {connected
              ? `${plural(overview.activeExtensionSessions, "extension")} connected`
              : "Setup incomplete"}
          </span>
        }
        description="Phrases you chose to save in the extension, and the devices allowed to sync them."
        title={firstName ? `Welcome back, ${firstName}` : "Overview"}
      />

      {connected ? null : (
        <section aria-labelledby="setup-title" className="card setup-card">
          <div className="card__header">
            <h2 id="setup-title">Connect the extension to start syncing</h2>
            <span className="badge badge--warning">
              <span className="dot" />
              Not connected
            </span>
          </div>
          <div className="card__body">
            <ol className="steps">
              <li>
                <span>
                  Open the LingoBridge popup in Chrome. Translation keeps working without an
                  account.
                </span>
              </li>
              <li>
                <span>
                  Choose <strong>Connect dashboard</strong> and approve the connection on this
                  account.
                </span>
              </li>
              <li>
                <span>
                  Phrases you save from then on appear here. Nothing you only translate is ever
                  uploaded.
                </span>
              </li>
            </ol>
          </div>
          <div className="card__footer">
            <a
              className="button button--primary"
              href={CHROME_WEB_STORE_URL}
              rel="noreferrer"
              target="_blank"
            >
              <BrowserIcon size={16} />
              Get the Chrome extension
            </a>
          </div>
        </section>
      )}

      <section aria-label="Account summary" className="stats overview-stats">
        <Link className="stat" href="/phrases">
          <span className="stat__top">
            <span className="stat__label">Saved phrases</span>
            <span aria-hidden="true" className="stat__icon">
              <PhrasesIcon size={16} />
            </span>
          </span>
          <span className="stat__value">{overview.phraseCount.toLocaleString("en")}</span>
          <span className="stat__meta">
            {overview.preferences.phraseSyncEnabled
              ? "Syncing from connected extensions"
              : "Phrase sync is off"}
          </span>
        </Link>
        <Link className="stat" href="/extensions">
          <span className="stat__top">
            <span className="stat__label">Connected extensions</span>
            <span aria-hidden="true" className="stat__icon">
              <ExtensionsIcon size={16} />
            </span>
          </span>
          <span className="stat__value">{overview.activeExtensionSessions}</span>
          <span className="stat__meta">
            {connected
              ? `Last active ${formatRelative(overview.lastExtensionActivityAt, now).toLowerCase()}`
              : "None yet"}
          </span>
        </Link>
        <Link className="stat" href="/preferences">
          <span className="stat__top">
            <span className="stat__label">Preferred language</span>
            <span aria-hidden="true" className="stat__icon">
              <PreferencesIcon size={16} />
            </span>
          </span>
          <span className="stat__value">
            {languageName(overview.preferences.preferredTargetLanguage)}
          </span>
          <span className="stat__meta">
            {overview.preferences.processingPreference === "on-device"
              ? "On-device processing"
              : "Online translation"}
          </span>
        </Link>
      </section>

      <section aria-labelledby="recent-title" className="section">
        <div className="section__header">
          <h2 id="recent-title">Recently saved</h2>
          {overview.phraseCount > 0 ? (
            <Link href="/phrases">View all {plural(overview.phraseCount, "phrase")}</Link>
          ) : null}
        </div>

        {overview.recentPhrases.length === 0 ? (
          <div className="empty">
            <h3>No saved phrases yet</h3>
            <p>
              After translating a selection in the extension, choose Save phrase. Saved phrases sync
              here once the extension is connected.
            </p>
          </div>
        ) : (
          <div className="data-list">
            {overview.recentPhrases.map((phrase) => (
              <Link
                className="row row--link"
                href={`/phrases?q=${encodeURIComponent(phrase.sourceText.slice(0, 60))}`}
                key={phrase.id}
              >
                <span className="row__phrase">
                  <span className="row__source" dir="auto" lang={phrase.sourceLanguage}>
                    {phrase.sourceText}
                  </span>
                  <span className="row__translation" dir="auto" lang={phrase.targetLanguage}>
                    {phrase.translatedText}
                  </span>
                  <span className="row__meta">
                    <span className="lang-pair">
                      {phrase.sourceLanguage} → {phrase.targetLanguage}
                    </span>
                    <span>{providerLabel(phrase.provider)}</span>
                    <time dateTime={phrase.savedAt}>{formatDate(phrase.savedAt)}</time>
                  </span>
                </span>
                <span className="row__actions">
                  <ArrowRightIcon size={16} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
