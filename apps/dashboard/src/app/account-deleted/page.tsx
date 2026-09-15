import { getDeletionReceipt } from "@lingobridge/database";
import type { Metadata } from "next";
import Link from "next/link";
import { BridgeMark } from "@/components/icons";
import { formatDate, formatDateTime } from "@/lib/format";
import { getServices } from "@/server/container";

export const metadata: Metadata = { title: "Account deleted" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The receipt holds dates and an id only; it reveals nothing about the deleted account. */
export default async function AccountDeletedPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const receiptId = typeof params.receipt === "string" ? params.receipt : "";
  const services = await getServices();
  const receipt = /^[0-9a-f-]{36}$/u.test(receiptId)
    ? await getDeletionReceipt(services.database, receiptId)
    : null;

  return (
    <main className="standalone">
      <div className="standalone__card standalone__card--wide">
        <span className="brand">
          <span className="brand__mark">
            <BridgeMark size={14} />
          </span>
          LingoBridge
        </span>
        {receipt ? (
          <>
            <div className="standalone__heading">
              <h1>Your account was deleted</h1>
              <p>
                Synced phrases, preferences, and every extension connection were removed. Keep this
                receipt if you need to reference the request.
              </p>
            </div>
            <dl className="definition-list">
              <div>
                <dt>Receipt</dt>
                <dd className="lang-pair">{receipt.id}</dd>
              </div>
              <div>
                <dt>Requested</dt>
                <dd>{formatDateTime(receipt.requestedAt)}</dd>
              </div>
              <div>
                <dt>Content deleted</dt>
                <dd>{formatDateTime(receipt.contentDeletedAt)}</dd>
              </div>
              <div>
                <dt>Account record removed</dt>
                <dd>
                  {receipt.accountPurgedAt
                    ? formatDateTime(receipt.accountPurgedAt)
                    : `By ${formatDate(receipt.accountPurgeAfter)}`}
                </dd>
              </div>
            </dl>
            <p className="callout">
              Each extension that was connected signs out on its next sync and asks whether to keep
              the phrases saved on that device. Translation keeps working without an account.
            </p>
          </>
        ) : (
          <div className="standalone__heading">
            <h1>Receipt not found</h1>
            <p>This link doesn’t match a deletion receipt.</p>
          </div>
        )}
        <Link className="button" href="/sign-in">
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
