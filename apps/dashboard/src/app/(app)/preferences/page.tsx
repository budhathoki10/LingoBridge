import { getPreferences } from "@lingobridge/database";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { loadTargetLanguages } from "@/server/languages";
import { requirePageSession } from "@/server/page-session";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "Preferences" };

export default async function PreferencesPage() {
  const { services, user } = await requirePageSession();
  const [preferences, languages] = await Promise.all([
    getPreferences(services.database, user.id),
    loadTargetLanguages(services.config.gatewayUrl),
  ]);

  return (
    <div className="page">
      <PageHeader
        description="These settings sync to every connected extension. Settings tied to one browser stay on that device."
        title="Preferences"
      />
      <PreferencesForm initial={preferences} languages={languages} />
      <section aria-labelledby="device-only" className="card">
        <div className="card__header">
          <h2 id="device-only">Kept on each device</h2>
        </div>
        <div className="card__body">
          <p className="muted">
            Website access for Selection Magic, disabled websites, sensitive-text confirmations, and
            Online consent never leave the browser where you chose them. Change them from the
            extension popup on that device.
          </p>
        </div>
      </section>
    </div>
  );
}
