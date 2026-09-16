import { listSavedWords } from "@lingobridge/database";
import type { Metadata } from "next";
import { DownloadIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requirePageSession } from "@/server/page-session";
import { VocabularyView } from "./vocabulary-view";

export const metadata: Metadata = { title: "My vocabulary" };

export default async function VocabularyPage() {
  const { services, user } = await requirePageSession();
  const words = await listSavedWords(services.database, user.id);
  return (
    <div className="page">
      <PageHeader
        actions={
          words.length > 0 ? (
            <a className="button" href="/api/dashboard/export?scope=vocabulary">
              <DownloadIcon size={16} />
              Export
            </a>
          ) : null
        }
        description="Words you explicitly saved after requesting word-level understanding."
        title="My vocabulary"
      />
      <VocabularyView words={words} />
    </div>
  );
}
