import { isRecentlyAuthenticated } from "@lingobridge/auth";
import { getAccountSummary } from "@lingobridge/database";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PAGE_COPY } from "@/lib/page-copy";
import { requirePageSession } from "@/server/page-session";
import { PrivacyActions } from "./privacy-actions";
import { StoredDataCard } from "./stored-data";

export const metadata: Metadata = { title: PAGE_COPY.privacy.title };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PrivacyPage({ searchParams }: { searchParams: SearchParams }) {
  const { services, session, user } = await requirePageSession();
  const params = await searchParams;
  const now = services.now();
  const summary = await getAccountSummary(services.database, user.id);
  const reauth = typeof params.reauth === "string" ? params.reauth : null;

  return (
    <div className="page">
      <PageHeader description={PAGE_COPY.privacy.description} title={PAGE_COPY.privacy.title} />

      <PrivacyActions
        phraseCount={summary.phraseCount}
        phraseSyncEnabled={summary.preferences.phraseSyncEnabled}
        preferencesRevision={summary.preferences.revision}
        reauthProblem={reauth === "mismatch" ? "mismatch" : reauth === "failed" ? "failed" : null}
        recentlyAuthenticated={isRecentlyAuthenticated(session, now)}
      />

      <StoredDataCard />
    </div>
  );
}
