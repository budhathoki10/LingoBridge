import { DownloadIcon, PreferencesIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LoadingPage, SkeletonText } from "@/components/skeleton";
import { PAGE_COPY } from "@/lib/page-copy";

const FILTERS = ["Source", "Target", "Saved after", "Saved before"] as const;

const ROWS = [
  ["Please bring the signed form to the office.", "कृपया हस्ताक्षर गरिएको फारम कार्यालयमा ल्याउनुहोस्।"],
  ["Where is the nearest pharmacy?", "सबैभन्दा नजिकको औषधि पसल कहाँ छ?"],
  ["The meeting moved to next Tuesday.", "बैठक अर्को मंगलबार सारिएको छ।"],
  ["Thank you very much", "धेरै धेरै धन्यवाद"],
  ["Your application is under review.", "तपाईंको निवेदन समीक्षामा छ।"],
] as const;

export default function PhrasesLoading() {
  return (
    <LoadingPage>
      <PageHeader
        actions={
          <span aria-hidden="true" className="button skeleton-mask">
            <DownloadIcon size={16} />
            Export
          </span>
        }
        description={PAGE_COPY.phrases.description}
        title={PAGE_COPY.phrases.title}
      />

      <section aria-hidden="true" className="toolbar">
        <div className="toolbar__row">
          <div className="toolbar__search">
            <SearchIcon className="toolbar__search-icon" size={16} />
            <div className="input skeleton-mask" />
          </div>
          <span className="button toolbar__filter-toggle skeleton-mask">
            <PreferencesIcon size={16} />
            Filters
          </span>
          <div className="toolbar__filters" data-open="false">
            {FILTERS.map((label) => (
              <div className="filter" key={label}>
                <span className="filter__label">{label}</span>
                <div className="select skeleton-mask" />
              </div>
            ))}
          </div>
        </div>
        <div className="filter-summary">
          <SkeletonText>1–25 of 60 phrases</SkeletonText>
          <span className="button-row">
            <div className="select button--small skeleton-mask">Newest first</div>
          </span>
        </div>
      </section>

      <div aria-hidden="true" className="data-list">
        <div className="data-list__head">
          <span className="row__select">
            <span className="skeleton-mask skeleton-checkbox" />
          </span>
          <span>Phrase</span>
          <span>Languages</span>
          <span>Provider</span>
          <span>Saved</span>
          <span />
        </div>
        {ROWS.map(([source, translation]) => (
          <div className="row" key={source}>
            <span className="row__select">
              <span className="skeleton-mask skeleton-checkbox" />
            </span>
            <div className="row__phrase">
              <span className="row__text">
                <span className="row__source">
                  <SkeletonText>{source}</SkeletonText>
                </span>
                <span className="row__translation" lang="ne">
                  <SkeletonText>{translation}</SkeletonText>
                </span>
              </span>
              <span className="row__meta row__meta--compact">
                <SkeletonText>en → ne · MyMemory · 20 Sept 2026</SkeletonText>
              </span>
              <span className="note-button row__reveal skeleton-mask">Add note</span>
            </div>
            <span className="row__cell">
              <SkeletonText>en → ne</SkeletonText>
            </span>
            <span className="row__cell">
              <SkeletonText>MyMemory</SkeletonText>
            </span>
            <span className="row__cell">
              <SkeletonText>20 Sept 2026</SkeletonText>
            </span>
            <span className="row__actions">
              <span className="button button--ghost button--small button--icon row__reveal" />
            </span>
          </div>
        ))}
      </div>
    </LoadingPage>
  );
}
