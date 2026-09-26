import { listExtensionSessions } from "@lingobridge/database";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PAGE_COPY } from "@/lib/page-copy";
import { requirePageSession } from "@/server/page-session";
import { ExtensionsList } from "./extensions-list";

export const metadata: Metadata = { title: PAGE_COPY.extensions.title };

export default async function ExtensionsPage() {
  const { services, user } = await requirePageSession();
  const now = services.now();
  const sessions = await listExtensionSessions(services.database, user.id);

  return (
    <div className="page">
      <PageHeader
        description={PAGE_COPY.extensions.description}
        title={PAGE_COPY.extensions.title}
      />
      <ExtensionsList
        now={now.toISOString()}
        sessions={sessions.map((session) => ({
          connectedAt: session.createdAt,
          deviceLabel: session.deviceLabel,
          expired: Date.parse(session.expiresAt) <= now.getTime(),
          id: session.id,
          lastUsedAt: session.lastUsedAt,
          revokedAt: session.revokedAt,
          revokedReason: session.revokedReason,
        }))}
      />
    </div>
  );
}
