import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { requirePageSession } from "@/server/page-session";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const { csrfToken, user } = await requirePageSession();
  return (
    <AppShell
      csrfToken={csrfToken}
      user={{ displayName: user.displayName, email: user.email, isAdmin: user.role === "admin" }}
    >
      {children}
    </AppShell>
  );
}
