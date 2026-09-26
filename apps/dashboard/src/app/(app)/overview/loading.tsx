import { ArrowRightIcon, ChevronRightIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LoadingPage, SkeletonText } from "@/components/skeleton";
import { PAGE_COPY } from "@/lib/page-copy";

const STATS = ["Saved phrases", "Connected extensions", "Preferred language"] as const;

const RECENT = [
  ["Please bring the signed form to the office.", "कृपया हस्ताक्षर गरिएको फारम कार्यालयमा ल्याउनुहोस्।"],
  ["Where is the nearest pharmacy?", "सबैभन्दा नजिकको औषधि पसल कहाँ छ?"],
  ["The meeting moved to next Tuesday.", "बैठक अर्को मंगलबार सारिएको छ।"],
  ["Thank you very much", "धेरै धेरै धन्यवाद"],
] as const;

export default function OverviewLoading() {
  return (
    <LoadingPage className="page--overview">
      <PageHeader
        actions={
          <span aria-hidden="true" className="badge skeleton-mask">
            <span className="dot" />1 extension connected
          </span>
        }
        description={PAGE_COPY.overview.description}
        title={<SkeletonText>Welcome back, friend</SkeletonText>}
      />

      <section aria-hidden="true" className="stats overview-stats">
        {STATS.map((label) => (
          <div className="stat" key={label}>
            <span className="stat__top">
              <span className="stat__label">{label}</span>
              <span className="stat__icon skeleton-mask" />
            </span>
            <span className="stat__value">
              <SkeletonText>00</SkeletonText>
            </span>
            <span className="stat__meta">
              <SkeletonText>Syncing from extensions</SkeletonText>
            </span>
          </div>
        ))}
      </section>

      <section className="section">
        <div className="section__header">
          <h2>Recently saved</h2>
          <span aria-hidden="true" className="section__link skeleton-mask">
            View all 00 phrases
          </span>
        </div>
        <div aria-hidden="true" className="data-list">
          {RECENT.map(([source, translation]) => (
            <div className="row row--link" key={source}>
              <span className="row__phrase">
                <span className="row__source">
                  <SkeletonText>{source}</SkeletonText>
                </span>
                <span className="row__translation" lang="ne">
                  <SkeletonText>{translation}</SkeletonText>
                </span>
                <span className="row__meta">
                  <SkeletonText>en → ne · MyMemory · 20 Sept 2026</SkeletonText>
                </span>
              </span>
              <span className="row__actions">
                <ArrowRightIcon className="row__arrow" size={16} />
                <ChevronRightIcon className="row__chevron" size={18} />
              </span>
            </div>
          ))}
        </div>
      </section>
    </LoadingPage>
  );
}
