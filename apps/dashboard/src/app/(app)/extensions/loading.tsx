import { BrowserIcon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { LoadingPage, SkeletonText } from "@/components/skeleton";
import { PAGE_COPY } from "@/lib/page-copy";

export default function ExtensionsLoading() {
  return (
    <LoadingPage>
      <PageHeader
        description={PAGE_COPY.extensions.description}
        title={PAGE_COPY.extensions.title}
      />

      <section aria-hidden="true" className="card">
        <div className="card__header">
          <h2>
            Active <SkeletonText>0</SkeletonText>
          </h2>
        </div>
        <ul className="session-list">
          <li className="session">
            <span className="session__icon">
              <BrowserIcon size={18} />
            </span>
            <div className="session__body">
              <div className="session__text">
                <span className="session__title">
                  <SkeletonText>Chrome on Windows</SkeletonText>
                  <span className="badge skeleton-mask">
                    <span className="dot" />
                    Active
                  </span>
                </span>
                <span className="session__meta">
                  <SkeletonText>Connected 20 Sept 2026 · Last used 30 min ago</SkeletonText>
                </span>
              </div>
              <span className="button button--danger-quiet button--small skeleton-mask">
                Revoke
              </span>
            </div>
          </li>
        </ul>
      </section>
    </LoadingPage>
  );
}
