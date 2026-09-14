import { listExtensionSessions } from "@lingobridge/database";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePageSession } from "@/server/page-session";
import { ExtensionsList } from "./extensions-list";

export const metadata: Metadata = { title: "Connected extensions" };

export default async function ExtensionsPage() {
  const { services, user } = await requirePageSession();
  const now = services.now();
  const sessions = await listExtensionSessions(services.database, user.id);

  return (
    <div className="page">
      <PageHeader
        description="Each Chrome installation you approved has its own connection. Revoking one refuses its very next sync, and its local phrases stay on that device."
        title="Connected extensions"
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
