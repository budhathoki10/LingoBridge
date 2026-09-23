import { countSavedWords, listSavedWordsPage } from "@lingobridge/database";
import type { Metadata } from "next";
import { DownloadIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { requirePageSession } from "@/server/page-session";
import { VocabularyView } from "./vocabulary-view";

export const metadata: Metadata = { title: "My vocabulary" };

const PAGE_SIZE = 25;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.slice(0, 200) ?? "";
}

export default async function VocabularyPage({ searchParams }: { searchParams: SearchParams }) {
  const { services, user } = await requirePageSession();
  const params = await searchParams;
  const query = single(params.q);
  const page = Math.max(1, Number.parseInt(single(params.page), 10) || 1);
  const [totalSaved, result] = await Promise.all([
    countSavedWords(services.database, user.id),
    listSavedWordsPage(services.database, user.id, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      query,
    }),
  ]);
  return (
    <div className="page">
      <PageHeader
        actions={
          totalSaved > 0 ? (
            <a className="button" href="/api/dashboard/export?scope=vocabulary">
              <DownloadIcon size={16} />
              Export
            </a>
          ) : null
        }
        description="Words you explicitly saved after requesting word-level understanding."
        title="My vocabulary"
      />
      <VocabularyView
        page={page}
        pageSize={PAGE_SIZE}
        query={query}
        total={result.total}
        totalSaved={totalSaved}
        words={result.words}
      />
    </div>
  );
}
