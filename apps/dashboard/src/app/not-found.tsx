import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Brand } from "@/components/brand";

// Noindex comes from the root layout; Next.js also answers with a 404 status.
export const metadata: Metadata = { title: "Page not found" };

export default async function NotFound() {
  // Render per request, like the landing page: a prerendered page carries no CSP nonce, so the
  // browser blocked every script on it.
  await connection();
  return (
    <main className="standalone">
      <div className="standalone__card">
        <Brand href="/" />
        <div className="standalone__heading">
          <h1>Page not found</h1>
          <p>
            This address doesn’t exist, or your account doesn’t have access to it. Check the link,
            or continue from one of these pages.
          </p>
        </div>
        <div className="standalone__actions">
          <Link className="button button--primary" href="/">
            Back to home
          </Link>
          <Link className="button" href="/overview">
            Open dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
