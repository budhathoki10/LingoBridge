import { DownloadIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LoadingPage, SkeletonText } from "@/components/skeleton";
import { PAGE_COPY } from "@/lib/page-copy";
import { PRIVACY_COPY as COPY, deletePhrasesDescription } from "./copy";
import { StoredDataCard } from "./stored-data";

export default function PrivacyLoading() {
  return (
    <LoadingPage>
      <PageHeader
        loading
        description={PAGE_COPY.privacy.description}
        title={PAGE_COPY.privacy.title}
      />

      <section aria-hidden="true" className="card">
        <div className="card__header">
          <h2>{COPY.dataTitle}</h2>
        </div>
        <div className="setting">
          <div className="setting__text">
            <h3>{COPY.download.title}</h3>
            <p>{COPY.download.body}</p>
          </div>
          <div className="setting__control setting__control--end">
            <span className="button skeleton-mask">
              <DownloadIcon size={16} />
              {COPY.download.action}
            </span>
          </div>
        </div>
        <div className="setting">
          <div className="setting__text">
            <h3>{COPY.sync.title}</h3>
            <p>
              <SkeletonText>{COPY.sync.on}</SkeletonText>
            </p>
          </div>
          <div className="setting__control setting__control--end">
            <span className="button skeleton-mask">Turn off sync</span>
          </div>
        </div>
        <div className="setting">
          <div className="setting__text">
            <h3>{COPY.deletePhrases.title}</h3>
            <p>
              <SkeletonText>{deletePhrasesDescription(10)}</SkeletonText>
            </p>
          </div>
          <div className="setting__control setting__control--end">
            <span className="button button--danger-quiet skeleton-mask">
              {COPY.deletePhrases.action}
            </span>
          </div>
        </div>
      </section>

      <section aria-hidden="true" className="card">
        <div className="card__header">
          <h2>{COPY.deleteAccount.title}</h2>
        </div>
        <div className="card__body section">
          <p className="muted">{COPY.deleteAccount.body}</p>
          <div>
            <span className="button skeleton-mask">{COPY.deleteAccount.confirmIdentity}</span>
          </div>
          <p className="field__hint">
            <SkeletonText>{COPY.deleteAccount.reauthHint}</SkeletonText>
          </p>
        </div>
      </section>

      <StoredDataCard />
    </LoadingPage>
  );
}
