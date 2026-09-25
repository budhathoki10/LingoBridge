import { parseConnectionRequest } from "@lingobridge/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { CheckIcon, CloseIcon } from "@/components/icons";
import { getPageSession } from "@/server/page-session";

export const metadata: Metadata = { title: "Connect extension" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PROBLEMS: Record<string, string> = {
  "invalid-challenge": "The request is missing its security challenge.",
  "invalid-device-label": "The device name in the request isn’t valid.",
  "invalid-redirect": "The request didn’t come from an approved LingoBridge extension.",
  "invalid-state": "The request is missing its security state.",
};

/**
 * Consent screen for connecting one Chrome installation. Nothing is issued until the signed-in
 * user presses Connect; the decision posts back with the session's CSRF token.
 *
 * This window can hold a different sign-in from the person's dashboard tab, so it offers the
 * provider's account chooser and comes back here with the same request once the switch completes.
 */
export default async function ConnectExtensionPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }

  const connectPath = `/extension/connect?${params.toString()}`;
  const session = await getPageSession();
  if (!session) {
    redirect(`/sign-in?returnTo=${encodeURIComponent(connectPath)}`);
  }

  const parsed = parseConnectionRequest(params, session.services.extensionAuth.allowedExtensionIds);

  return (
    <main className="standalone">
      <div className="standalone__card standalone__card--wide">
        <Brand />

        {parsed.ok ? (
          <>
            <div className="standalone__heading">
              <h1>Connect {parsed.request.deviceLabel}?</h1>
              <p>
                This extension will sync with{" "}
                <strong>{session.user.email ?? session.user.displayName ?? "your account"}</strong>.
                You can revoke it any time from Connected extensions.
              </p>
              <p className="standalone__switch">
                Not the right account?{" "}
                <a
                  href={`/auth/sign-in?prompt=select_account&returnTo=${encodeURIComponent(connectPath)}`}
                >
                  Use a different account
                </a>
              </p>
            </div>

            <div className="section">
              <h2>What syncs</h2>
              <ul className="checklist checklist--yes">
                <li>
                  <CheckIcon className="checklist__icon" size={16} />
                  <span>Phrases you explicitly choose to save, and notes on them</span>
                </li>
                <li>
                  <CheckIcon className="checklist__icon" size={16} />
                  <span>Your preferred translation language and phrase-sync setting</span>
                </li>
              </ul>
            </div>
            <div className="section">
              <h2>What never leaves this device</h2>
              <ul className="checklist checklist--no">
                <li>
                  <CloseIcon className="checklist__icon" size={16} />
                  <span>Translations you don’t save, page addresses, and browsing history</span>
                </li>
                <li>
                  <CloseIcon className="checklist__icon" size={16} />
                  <span>Website access, disabled sites, and sensitive-text choices</span>
                </li>
              </ul>
            </div>

            <div className="section">
              <h2>Online translation</h2>
              <p className="connect-disclosure">
                Connecting also enables Online translation on this Chrome. When you choose
                Translate, the selected text and language pair go first to NVIDIA Nemotron. If it
                cannot answer, MyMemory translates, and NVIDIA Riva is tried last for supported
                languages. OpenRouter is used only as a Romanized Nepali backup. Unsaved
                translations are not added to your account.{" "}
                <a href="/privacy-policy">Privacy details</a>
              </p>
            </div>

            <form action="/extension/connect/decision" className="button-row" method="post">
              <input name="csrf" type="hidden" value={session.csrfToken} />
              <input name="request" type="hidden" value={params.toString()} />
              <button className="button" name="decision" type="submit" value="deny">
                Cancel
              </button>
              <button
                className="button button--primary"
                name="decision"
                type="submit"
                value="approve"
              >
                Connect extension
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="standalone__heading">
              <h1>This connection request can’t be used</h1>
              <p>
                {PROBLEMS[parsed.problem]} Close this window and choose Connect dashboard in the
                extension again.
              </p>
            </div>
            <p className="callout">
              If this keeps happening, the extension may not be approved for this dashboard. No
              connection was made.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
