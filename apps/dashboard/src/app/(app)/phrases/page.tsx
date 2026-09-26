import { listPhrases, summarizePhraseLanguages } from "@lingobridge/database";
import type { Metadata } from "next";
import { DownloadIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { PAGE_COPY } from "@/lib/page-copy";
import { requirePageSession } from "@/server/page-session";
import { PhrasesView } from "./phrases-view";

export const metadata: Metadata = { title: PAGE_COPY.phrases.title };

const PAGE_SIZE = 25;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.slice(0, 200) ?? "";
}

function parseDay(value: string, endOfDay: boolean): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export default async function PhrasesPage({ searchParams }: { searchParams: SearchParams }) {
  const { services, user } = await requirePageSession();
  const params = await searchParams;

  const filters = {
    from: single(params.from),
    q: single(params.q),
    sort: single(params.sort) === "oldest" ? ("oldest" as const) : ("newest" as const),
    source: single(params.source),
    target: single(params.target),
    to: single(params.to),
  };
  const requestedPage = Math.max(1, Number.parseInt(single(params.page), 10) || 1);

  const [summary, result] = await Promise.all([
    summarizePhraseLanguages(services.database, user.id),
    listPhrases(services.database, user.id, {
      limit: PAGE_SIZE,
      offset: (requestedPage - 1) * PAGE_SIZE,
      query: filters.q,
      savedFrom: parseDay(filters.from, false),
      savedTo: parseDay(filters.to, true),
      sort: filters.sort,
      sourceLanguage: filters.source || undefined,
      targetLanguage: filters.target || undefined,
    }),
  ]);

  return (
    <div className="page">
      <PageHeader
        actions={
          summary.total > 0 ? (
            <a className="button" href="/api/dashboard/export?scope=phrases">
              <DownloadIcon size={16} />
              Export
            </a>
          ) : null
        }
        description={PAGE_COPY.phrases.description}
        title={PAGE_COPY.phrases.title}
      />
      <PhrasesView
        filters={filters}
        page={requestedPage}
        pageSize={PAGE_SIZE}
        phrases={result.phrases}
        sourceLanguages={summary.sourceLanguages}
        targetLanguages={summary.targetLanguages}
        total={result.total}
        totalSaved={summary.total}
      />
    </div>
  );
}
