import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { sanitizeReturnPath } from "@lingobridge/auth";
import { BridgeMark } from "@/components/icons";
import { getServices } from "@/server/container";
import { getPageSession } from "@/server/page-session";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "invalid-state": "That sign-in link expired or was already used. Start again.",
  "invalid-token": "Your identity provider’s response couldn’t be verified. Start again.",
  "provider-denied": "Sign-in was cancelled at your identity provider.",
  "provider-unavailable": "Your identity provider couldn’t be reached. Try again in a moment.",
  "rate-limited": "Too many sign-in attempts from this network. Wait a minute and try again.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const returnTo = sanitizeReturnPath(typeof params.returnTo === "string" ? params.returnTo : null);
  if (await getPageSession()) redirect(returnTo);

  const services = await getServices();
  const error =
    typeof params.error === "string" ? (ERRORS[params.error] ?? ERRORS["invalid-state"]) : null;
  const signedOut = params.signedOut === "1";
  const development = services.config.authMode === "development";

  return (
    <main className="standalone">
      <div className="standalone__card">
        <span className="brand">
          <span className="brand__mark">
            <BridgeMark size={14} />
          </span>
          LingoBridge
        </span>
        <div className="standalone__heading">
          <h1>Sign in to your dashboard</h1>
          <p>
            Review phrases you saved in the extension and manage the devices connected to your
            account.
          </p>
        </div>

        {error ? (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        ) : null}
        {signedOut && !error ? (
          <p className="callout" role="status">
            You’re signed out. Extensions connected to this account were disconnected too.
          </p>
        ) : null}

        {/* A link, not a form: CSP form-action also applies to the redirect to the provider. */}
        <a
          className="button button--primary"
          href={`/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
        >
          Continue with {services.config.oidc.providerName}
        </a>

        {development ? (
          <p className="callout callout--warning">
            Development sign-in is active. Any email works and no password is checked. It can’t run
            in production.
          </p>
        ) : null}

        <p className="standalone__footer">
          Translation works without an account. Only phrases you choose to save are synced.
        </p>
      </div>
    </main>
  );
}
