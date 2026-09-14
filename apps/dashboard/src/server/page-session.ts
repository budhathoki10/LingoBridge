import "server-only";
import { type AuthenticatedWebSession, resolveWebSession } from "@lingobridge/auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { cookieNames } from "./cookies";
import { getServices } from "./container";
import type { DashboardServices } from "./services";

export interface PageSession extends AuthenticatedWebSession {
  services: DashboardServices;
}

/** Resolved once per render; every protected layout and page shares the same lookup. */
export const getPageSession = cache(async (): Promise<PageSession | null> => {
  const services = await getServices();
  const store = await cookies();
  const token = store.get(cookieNames(services.config.secureCookies).session)?.value ?? null;
  const auth = await resolveWebSession(services.webAuth, token);
  return auth ? { ...auth, services } : null;
});

/**
 * The authoritative protected-route boundary. The edge proxy only redirects when no cookie is
 * present; this check validates the session against the database on every protected render.
 */
export async function requirePageSession(): Promise<PageSession> {
  const session = await getPageSession();
  if (!session) {
    const path = (await headers()).get("x-lingobridge-path") ?? "/overview";
    redirect(`/sign-in?returnTo=${encodeURIComponent(path)}`);
  }
  return session;
}

export async function getCspNonce(): Promise<string | undefined> {
  return (await headers()).get("x-nonce") ?? undefined;
}
