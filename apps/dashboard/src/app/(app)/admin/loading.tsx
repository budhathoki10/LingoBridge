import { PageHeader } from "@/components/page-header";
import { LoadingPage, SkeletonText } from "@/components/skeleton";
import { PAGE_COPY } from "@/lib/page-copy";

const METRICS = ["Requests", "Success rate", "Median latency", "95th percentile"] as const;

export default function AdminLoading() {
  return (
    <LoadingPage>
      <PageHeader loading description={PAGE_COPY.admin.description} title={PAGE_COPY.admin.title} />

      <div aria-hidden="true" className="filter-summary">
        <SkeletonText>
          Window started 20 Sept 2026, 10:00 · Updated 20 Sept 2026, 10:05
        </SkeletonText>
        <span className="badge skeleton-mask">Live providers</span>
      </div>

      <section aria-hidden="true" className="section">
        <h2>Providers</h2>
        <div className="provider-grid">
          {["NVIDIA Riva Translate", "MyMemory"].map((name) => (
            <div className="card" key={name}>
              <div className="card__header">
                <h3>
                  <SkeletonText>{name}</SkeletonText>
                </h3>
                <span className="badge skeleton-mask">
                  <span className="dot" />
                  Healthy
                </span>
              </div>
              <dl className="card__body">
                {METRICS.map((metric) => (
                  <div className="metric-row" key={metric}>
                    <dt>{metric}</dt>
                    <dd>
                      <SkeletonText>0,000</SkeletonText>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </LoadingPage>
  );
}
