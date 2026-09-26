import { getPreferences } from "@lingobridge/database";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PAGE_COPY } from "@/lib/page-copy";
import { loadTargetLanguages } from "@/server/languages";
import { requirePageSession } from "@/server/page-session";
import { PREFERENCES_COPY } from "./copy";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: PAGE_COPY.preferences.title };

export default async function PreferencesPage() {
  const { services, user } = await requirePageSession();
  const [preferences, languages] = await Promise.all([
    getPreferences(services.database, user.id),
    loadTargetLanguages(services.config.gatewayUrl),
  ]);

  return (
    <div className="page">
      <PageHeader
        description={PAGE_COPY.preferences.description}
        title={PAGE_COPY.preferences.title}
      />
      <PreferencesForm initial={preferences} languages={languages} />
      <section aria-labelledby="device-only" className="card">
        <div className="card__header">
          <h2 id="device-only">{PREFERENCES_COPY.deviceOnly.title}</h2>
        </div>
        <div className="card__body">
          <p className="muted">{PREFERENCES_COPY.deviceOnly.body}</p>
        </div>
      </section>
    </div>
  );
}
