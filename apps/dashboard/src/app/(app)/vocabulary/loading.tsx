import { DownloadIcon, SearchIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LoadingPage, SkeletonText } from "@/components/skeleton";
import { PAGE_COPY } from "@/lib/page-copy";

const WORDS = [
  ["appointment", "noun", "भेटघाट", "A time arranged to meet someone."],
  ["signed", "adjective", "हस्ताक्षर गरिएको", "Marked with a person's signature."],
  ["nearest", "adjective", "सबैभन्दा नजिकको", "Closest in distance."],
  ["renovate", "verb", "मर्मत गर्नु", "To repair and improve a building."],
] as const;

export default function VocabularyLoading() {
  return (
    <LoadingPage>
      <PageHeader
        actions={
          <span aria-hidden="true" className="button skeleton-mask">
            <DownloadIcon size={16} />
            Export
          </span>
        }
        description={PAGE_COPY.vocabulary.description}
        title={PAGE_COPY.vocabulary.title}
      />

      <section aria-hidden="true" className="toolbar">
        <div className="toolbar__row">
          <div className="toolbar__search">
            <SearchIcon className="toolbar__search-icon" size={16} />
            <div className="input skeleton-mask" />
          </div>
        </div>
        <div className="filter-summary">
          <SkeletonText>1–25 of 40 words</SkeletonText>
        </div>
      </section>

      <div aria-hidden="true" className="data-list">
        {WORDS.map(([word, partOfSpeech, translation, meaning]) => (
          <div className="row row--vocab" key={word}>
            <div className="vocab">
              <div className="vocab__line">
                <strong className="vocab__word">
                  <SkeletonText>{word}</SkeletonText>
                </strong>
                <span className="vocab__pos skeleton-mask">{partOfSpeech}</span>
              </div>
              <span className="row__translation" lang="ne">
                <SkeletonText>{translation}</SkeletonText>
              </span>
              <span className="vocab__meaning">
                <SkeletonText>{meaning}</SkeletonText>
              </span>
              <span className="row__meta">
                <SkeletonText>en → ne · 20 Sept 2026</SkeletonText>
              </span>
            </div>
            <span className="row__actions">
              <span className="button button--ghost button--small button--icon row__reveal" />
            </span>
          </div>
        ))}
      </div>
    </LoadingPage>
  );
}
