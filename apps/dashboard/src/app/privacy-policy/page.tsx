import {
  ACCOUNT_PURGE_WINDOW_MILLISECONDS,
  TOMBSTONE_RETENTION_MILLISECONDS,
} from "@lingobridge/database";
import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { PRIVACY_POLICY_VERSION } from "@/lib/privacy";

// The Chrome Web Store and every visitor must reach this without signing in. It sits outside the
// protected route prefixes in proxy.ts on purpose: "/privacy" is the signed-in account page, and
// this public policy lives at a different path so the two never shadow each other.
export const metadata: Metadata = {
  description:
    "What LingoBridge sends, stores, and deletes, and which translation providers receive the text you choose to translate.",
  robots: { follow: true, index: true },
  title: "Privacy policy",
};

// Read at request time so the operator's contact address is configuration, not code.
export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1_000;
const MARKER_DAYS = Math.round(TOMBSTONE_RETENTION_MILLISECONDS / DAY);
const PURGE_DAYS = Math.round(ACCOUNT_PURGE_WINDOW_MILLISECONDS / DAY);

const CONTACT_EMAIL = () => process.env.LINGOBRIDGE_CONTACT_EMAIL?.trim() || null;

export default function PrivacyPolicyPage() {
  const contactEmail = CONTACT_EMAIL();

  return (
    <main className="policy">
      <article className="policy__document">
        <header className="policy__header">
          <Brand href="/" />
          <p className="policy__eyebrow">Privacy policy</p>
          <h1>Your text is translated only when you ask.</h1>
          <p className="policy__lead">
            LingoBridge translates text you select on a web page. This page explains exactly what
            leaves your device, who receives it, what we keep, and how to delete it. Version{" "}
            {PRIVACY_POLICY_VERSION}.
          </p>
        </header>

        <section aria-labelledby="sent">
          <h2 id="sent">What is sent when you translate</h2>
          <p>
            Selecting text only shows a small icon. Nothing is sent until you click it and accept
            Online translation. From then on, each translation sends only the text you chose, its
            language pair, and the minimum request details needed to protect the service from abuse.
          </p>
          <p>
            That request goes to the LingoBridge gateway, our own server. The gateway, not your
            browser, contacts the translation providers, so providers never see your device.
          </p>
        </section>

        <section aria-labelledby="providers">
          <h2 id="providers">Who processes your text</h2>
          <ul>
            <li>
              <strong>MyMemory</strong> translates first. Every request to MyMemory also carries a
              LingoBridge operator contact email address, in the provider’s <code>de</code>{" "}
              parameter.
            </li>
            <li>
              <strong>NVIDIA</strong> (Riva Translate 4B Instruct v2) is a single fallback, tried
              once and only for language directions it supports, when MyMemory fails or reaches its
              quota.
            </li>
            <li>
              <strong>Romanized Nepali.</strong> If the text looks like Nepali typed in English
              letters, the gateway first asks NVIDIA Nemotron 3 Ultra, or OpenRouter once if NVIDIA
              fails, to rewrite it in Nepali script, then translates the result as above.
            </li>
            <li>
              <strong>Explain and word lookups</strong> send only the text you clicked on, its
              translation, and the two language codes to NVIDIA Nemotron 3 Ultra, with a model on
              OpenRouter as backup. Explain asks for its own permission the first time and never
              runs unless you click it. Free OpenRouter models are run by other companies whose
              terms may allow them to log or learn from requests, so do not explain text you would
              not share.
            </li>
          </ul>
          <p>
            Each result shows which provider produced it. We do not sell your text or use it for
            advertising, credit, or lending decisions, and it is sent to these providers only to
            produce the translation you asked for.
          </p>
          <p>
            Provider policies:{" "}
            <a href="https://mymemory.translated.net/terms-and-conditions" rel="noreferrer">
              MyMemory
            </a>
            ,{" "}
            <a
              href="https://build.nvidia.com/nvidia/riva-translate-4b-instruct-v2/modelcard"
              rel="noreferrer"
            >
              NVIDIA
            </a>
            ,{" "}
            <a href="https://openrouter.ai/privacy" rel="noreferrer">
              OpenRouter
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="keep">
          <h2 id="keep">What LingoBridge keeps</h2>
          <p>
            The gateway does not create translation history. Its logs record only the request
            method, path, status, duration, and a random request number, and never the source,
            translated, or explained text. Your network address is used in memory to limit abuse and
            is not written to those logs. Our hosting providers may keep their own standard network
            logs.
          </p>
          <p>
            A random installation identifier is generated and kept inside the extension. It is sent
            with requests so the gateway can apply abuse limits.
          </p>
        </section>

        <section aria-labelledby="device">
          <h2 id="device">What stays on your device</h2>
          <p>
            Your preferred and favorite languages, whether Selection Magic is on, which sites you
            turned it off for, your Online translation consent, and phrases you save without an
            account are stored in the extension’s local storage. Site access is optional and
            requested per site; revoking it removes the icon and stops selection handling.
          </p>
        </section>

        <section aria-labelledby="account">
          <h2 id="account">Optional account</h2>
          <p>
            Translation works without an account. If you sign in with Google to use the dashboard,
            we store your sign-in identity and email address, the phrases and words you explicitly
            save, your synchronized preferences, and the name and last-used date of each connected
            extension. The extension keeps a revocable session token so it can sync; tokens are
            never shown in the dashboard.
          </p>
          <p>
            We never store translations you did not save, page addresses, browsing history, website
            permissions, cookies, password fields, or the text of anything you only selected.
          </p>
        </section>

        <section aria-labelledby="control">
          <h2 id="control">Your controls and deletion</h2>
          <ul>
            <li>Turn Online translation off in the extension popup at any time.</li>
            <li>Revoke site access in Chrome to remove the icon from a site immediately.</li>
            <li>Revoke any connected extension from the dashboard.</li>
            <li>Export everything stored for your account, and stop synchronization.</li>
            <li>
              Delete a phrase and its text is erased at once. An empty marker is kept for{" "}
              {MARKER_DAYS} days so your other devices also remove it.
            </li>
            <li>
              Delete your account and your phrases, preferences, and sessions are removed at once.
              An empty account record without your email or name is purged within {PURGE_DAYS} days.
            </li>
          </ul>
          <p>
            Deleting your account does not clear the extension’s local storage. Remove the
            extension, or its site data, to clear that.
          </p>
        </section>

        <section aria-labelledby="contact">
          <h2 id="contact">Contact</h2>
          <p>
            {contactEmail ? (
              <>
                Questions or deletion requests:{" "}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
              </>
            ) : (
              "Questions or deletion requests can be sent through the developer contact shown on the LingoBridge listing in the Chrome Web Store."
            )}{" "}
            Changes to this policy are published here with a new version number.
          </p>
        </section>

        <footer className="policy__footer">
          <Link href="/sign-in">Sign in to your dashboard</Link>
        </footer>
      </article>
    </main>
  );
}
