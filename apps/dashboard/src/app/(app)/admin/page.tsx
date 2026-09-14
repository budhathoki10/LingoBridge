import type { OperationsMetrics, ProviderOperations } from "@lingobridge/contracts/operations";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { requirePageSession } from "@/server/page-session";

export const metadata: Metadata = { title: "Operations" };

const PROVIDER_NAMES: Record<ProviderOperations["provider"], string> = {
  fake: "Fake provider",
  google: "Google Cloud Translation",
  none: "Rejected before a provider",
  nvidia: "NVIDIA Riva Translate",
};

const OUTCOME_LABELS: Record<keyof ProviderOperations["outcomes"], string> = {
  cancelled: "Cancelled",
  "invalid-request": "Invalid request",
  "provider-error": "Provider error",
  "rate-limited": "Rate limited",
  success: "Success",
  timeout: "Timeout",
  "unsupported-pair": "Unsupported pair",
};

function percent(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function milliseconds(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("en")} ms`;
}

function providerStatus(provider: ProviderOperations, metrics: OperationsMetrics) {
  if (provider.provider === "none") return null;
  const warnings = metrics.warnings.filter((warning) => warning.provider === provider.provider);
  if (warnings.some((warning) => warning.code === "provider-down")) {
    return (
      <span className="badge badge--danger">
        <span className="dot" />
        Failing
      </span>
    );
  }
  if (warnings.length > 0) {
    return (
      <span className="badge badge--warning">
        <span className="dot" />
        Degraded
      </span>
    );
  }
  return (
    <span className="badge badge--success">
      <span className="dot" />
      Healthy
    </span>
  );
}

/**
 * Aggregate, content-free operations view. The page is rendered only for a server-verified admin
 * role, and its data comes from a contract that has no field capable of holding user text.
 */
export default async function AdminPage() {
  const { services, user } = await requirePageSession();
  if (user.role !== "admin") notFound();

  const result = await services.fetchOperationsMetrics();

  return (
    <div className="page">
      <PageHeader
        description="Provider health and usage totals for this gateway instance. No selected, translated, or saved text is ever shown here."
        title="Operations"
      />

      {result.kind === "disabled" ? (
        <div className="empty">
          <h2>Operations metrics are not configured</h2>
          <p>
            Set the same LINGOBRIDGE_OPERATIONS_METRICS_TOKEN on the gateway and the dashboard, then
            restart both.
          </p>
        </div>
      ) : null}

      {result.kind === "unavailable" ? (
        <div className="callout callout--danger" role="alert">
          <strong>
            {result.gatewayHealthy ? "Metrics could not be read" : "The gateway is unreachable"}
          </strong>
          <span>
            {result.gatewayHealthy
              ? "The gateway is running but refused or returned invalid metrics. Check that both services use the same metrics token."
              : "Translation requests are likely failing. Check the gateway process and its logs."}
          </span>
        </div>
      ) : null}

      {result.kind === "ok" ? (
        <>
          <div className="filter-summary">
            <span>
              Window started {formatDateTime(result.metrics.windowStartedAt)} · Updated{" "}
              {formatDateTime(result.metrics.generatedAt)}
            </span>
            <span
              className={`badge ${result.metrics.translationMode === "live" ? "badge--accent" : ""}`}
            >
              {result.metrics.translationMode === "live" ? "Live providers" : "Fake provider mode"}
            </span>
          </div>

          {result.metrics.warnings.length > 0 ? (
            <section aria-labelledby="warnings-title" className="section">
              <h2 id="warnings-title">Warnings</h2>
              <div className="section">
                {result.metrics.warnings.map((warning) => (
                  <p
                    className="callout callout--warning"
                    key={`${warning.code}-${warning.provider}`}
                  >
                    {warning.message}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {result.metrics.providers.length === 0 ? (
            <div className="empty">
              <h2>No translation requests yet</h2>
              <p>Totals appear after the gateway handles its first translation in this window.</p>
            </div>
          ) : (
            <>
              <section aria-labelledby="providers-title" className="section">
                <h2 id="providers-title">Providers</h2>
                <div className="provider-grid">
                  {result.metrics.providers.map((provider) => (
                    <article className="card" key={provider.provider}>
                      <div className="card__header">
                        <h3>{PROVIDER_NAMES[provider.provider]}</h3>
                        {providerStatus(provider, result.metrics)}
                      </div>
                      <dl className="card__body">
                        <div className="metric-row">
                          <dt>Requests</dt>
                          <dd>{provider.requests.toLocaleString("en")}</dd>
                        </div>
                        <div className="metric-row">
                          <dt>Success rate</dt>
                          <dd>{percent(provider.outcomes.success, provider.requests)}</dd>
                        </div>
                        {provider.provider === "none" ? null : (
                          <>
                            <div className="metric-row">
                              <dt>Median latency</dt>
                              <dd>{milliseconds(provider.latencyMedianMs)}</dd>
                            </div>
                            <div className="metric-row">
                              <dt>95th percentile</dt>
                              <dd>{milliseconds(provider.latencyP95Ms)}</dd>
                            </div>
                            <div className="metric-row">
                              <dt>Billable characters</dt>
                              <dd>{provider.billableCharacters.toLocaleString("en")}</dd>
                            </div>
                          </>
                        )}
                        {provider.provider === "google" ? (
                          <div className="metric-row">
                            <dt>Backup attempts</dt>
                            <dd>
                              {provider.fallbackAttempts.toLocaleString("en")} (
                              {percent(provider.fallbackSuccesses, provider.fallbackAttempts)}{" "}
                              succeeded)
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </article>
                  ))}
                </div>
              </section>

              <section aria-labelledby="outcomes-title" className="section">
                <h2 id="outcomes-title">Outcomes</h2>
                <div className="simple-table-wrap">
                  <table className="simple-table">
                    <thead>
                      <tr>
                        <th scope="col">Outcome</th>
                        {result.metrics.providers.map((provider) => (
                          <th className="numeric" key={provider.provider} scope="col">
                            {PROVIDER_NAMES[provider.provider]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(Object.keys(OUTCOME_LABELS) as (keyof typeof OUTCOME_LABELS)[]).map(
                        (outcome) => (
                          <tr key={outcome}>
                            <th scope="row">{OUTCOME_LABELS[outcome]}</th>
                            {result.metrics.providers.map((provider) => (
                              <td className="numeric" key={provider.provider}>
                                {provider.outcomes[outcome].toLocaleString("en")}
                              </td>
                            ))}
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section aria-labelledby="pairs-title" className="section">
                <h2 id="pairs-title">Language pairs</h2>
                {result.metrics.languagePairs.length === 0 ? (
                  <p className="muted">No language pairs recorded in this window.</p>
                ) : (
                  <div className="simple-table-wrap">
                    <table className="simple-table">
                      <thead>
                        <tr>
                          <th scope="col">Direction</th>
                          <th scope="col">Provider</th>
                          <th className="numeric" scope="col">
                            Requests
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.metrics.languagePairs.slice(0, 50).map((pair) => (
                          <tr
                            key={`${pair.provider}-${pair.sourceLanguage}-${pair.targetLanguage}`}
                          >
                            <td>
                              <span className="lang-pair">
                                {pair.sourceLanguage} → {pair.targetLanguage}
                              </span>
                            </td>
                            <td>{PROVIDER_NAMES[pair.provider]}</td>
                            <td className="numeric">{pair.requests.toLocaleString("en")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
