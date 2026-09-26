import { PageHeader } from "@/components/page-header";
import { LoadingPage, SkeletonText } from "@/components/skeleton";
import { PAGE_COPY } from "@/lib/page-copy";
import { PREFERENCES_COPY as COPY } from "./copy";

export default function PreferencesLoading() {
  return (
    <LoadingPage>
      <PageHeader
        loading
        description={PAGE_COPY.preferences.description}
        title={PAGE_COPY.preferences.title}
      />

      <div aria-hidden="true" className="card">
        <div className="setting">
          <div className="setting__text">
            <h2>{COPY.language.title}</h2>
            <p>{COPY.language.help}</p>
          </div>
          <div className="setting__control field">
            <div className="select skeleton-mask" />
          </div>
        </div>
        <div className="setting">
          <div className="setting__text">
            <h2>{COPY.processing.title}</h2>
            <p>{COPY.processing.help}</p>
          </div>
          <div className="setting__control radio-group">
            {[COPY.processing.online, COPY.processing.onDevice].map((option) => (
              <div className="radio skeleton-mask" key={option.label}>
                <span />
                <span>
                  {option.label}
                  <small>{option.detail}</small>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="setting">
          <div className="setting__text">
            <h2>{COPY.sync.title}</h2>
            <p>{COPY.sync.help}</p>
          </div>
          <div className="setting__control setting__control--end">
            <span className="switch skeleton-mask" />
          </div>
        </div>
        <div className="card__footer">
          <p className="muted">
            <SkeletonText>Last changed 20 Sept 2026, 10:00</SkeletonText>
          </p>
          <span className="button-row">
            <span className="button skeleton-mask">Discard</span>
            <span className="button button--primary skeleton-mask">Save preferences</span>
          </span>
        </div>
      </div>

      <section aria-labelledby="device-only-loading" className="card">
        <div className="card__header">
          <h2 id="device-only-loading">{COPY.deviceOnly.title}</h2>
        </div>
        <div className="card__body">
          <p className="muted">{COPY.deviceOnly.body}</p>
        </div>
      </section>
    </LoadingPage>
  );
}
