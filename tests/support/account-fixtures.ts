import type { PhraseContent } from "@lingobridge/contracts/account";
import {
  type Database,
  openInMemoryDatabase,
  type User,
  upsertUserFromIdentity,
} from "@lingobridge/database";
import { loadDashboardConfig } from "../../apps/dashboard/src/server/config";
import {
  createDashboardServices,
  type DashboardServices,
} from "../../apps/dashboard/src/server/services";

export const DASHBOARD_ORIGIN = "http://127.0.0.1:3000";
export const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
export const OTHER_EXTENSION_ID = "ponmlkjihgfedcbaponmlkjihgfedcba";
export const REDIRECT_URI = `https://${EXTENSION_ID}.chromiumapp.org/lingobridge`;

export class TestClock {
  current: Date;

  constructor(iso = "2026-09-14T10:00:00.000Z") {
    this.current = new Date(iso);
  }

  now = (): Date => new Date(this.current);

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export async function createUser(
  database: Database,
  email: string,
  now: Date,
  role: "user" | "admin" = "user",
): Promise<User> {
  return database.transaction((client) =>
    upsertUserFromIdentity(
      client,
      {
        displayName: email.split("@")[0] ?? null,
        email,
        emailVerified: true,
        issuer: "https://issuer.test",
        subject: `subject-${email}`,
      },
      role,
      now,
    ),
  );
}

let phraseCounter = 0;

export function phrase(overrides: Partial<PhraseContent> = {}): PhraseContent {
  phraseCounter += 1;
  return {
    id: `phrase-${phraseCounter}`,
    note: null,
    provider: "nvidia",
    savedAt: "2026-09-14T09:00:00.000Z",
    sourceLanguage: "en",
    sourceText: `Good morning ${phraseCounter}`,
    targetLanguage: "ne",
    translatedText: `शुभ प्रभात ${phraseCounter}`,
    ...overrides,
  };
}

export interface TestDashboard {
  clock: TestClock;
  database: Database;
  services: DashboardServices;
}

export async function createTestDashboard(
  environment: Record<string, string> = {},
): Promise<TestDashboard> {
  const clock = new TestClock();
  const database = await openInMemoryDatabase();
  const config = loadDashboardConfig({
    LINGOBRIDGE_ADMIN_EMAILS: "admin@example.test",
    LINGOBRIDGE_ALLOWED_EXTENSION_IDS: EXTENSION_ID,
    LINGOBRIDGE_AUTH_MODE: "development",
    LINGOBRIDGE_DASHBOARD_ORIGIN: DASHBOARD_ORIGIN,
    LINGOBRIDGE_SESSION_SECRET: "test-session-secret-that-is-long-enough-123",
    NODE_ENV: "test",
    ...environment,
  });
  const services = await createDashboardServices(config, {
    database,
    fetch: async () => new Response("offline", { status: 503 }),
    now: clock.now,
  });
  return { clock, database, services };
}

/** Parses Set-Cookie headers into a Cookie request header value. */
export function cookieHeader(response: Response, existing = ""): string {
  const jar = new Map<string, string>();
  for (const part of existing.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name) jar.set(name, value.join("="));
  }
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const [name, ...value] = (pair ?? "").split("=");
    if (!name) continue;
    if (/Max-Age=0/u.test(cookie)) jar.delete(name);
    else jar.set(name, value.join("="));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * Drives the complete development sign-in through the real handlers: start, provider form, callback.
 * Returns the browser cookie jar after the dashboard session cookie is set.
 */
export async function signInThroughHandlers(
  dashboard: TestDashboard,
  email: string,
  returnTo = "/overview",
): Promise<{ cookies: string; csrfToken: string }> {
  const { handleCallback, handleSignInStart } = await import(
    "../../apps/dashboard/src/server/handlers/auth"
  );
  const { resolveWebSession } = await import("@lingobridge/auth");
  const { readCookie, cookieNames } = await import("../../apps/dashboard/src/server/cookies");

  const start = await handleSignInStart(
    new Request(`${DASHBOARD_ORIGIN}/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`),
    dashboard.services,
  );
  let cookies = cookieHeader(start);
  const authorize = new URL(start.headers.get("Location") ?? "");
  const provider = dashboard.services.developmentIdentity;
  if (!provider) throw new Error("Development identity provider is not enabled.");
  const callback = new URL(
    provider.issueCode(authorize.searchParams, { email, name: email.split("@")[0] ?? "" }),
  );

  const completed = await handleCallback(
    new Request(callback.toString(), { headers: { Cookie: cookies } }),
    dashboard.services,
  );
  if (
    completed.status !== 303 ||
    !completed.headers.get("Location")?.startsWith(`${DASHBOARD_ORIGIN}${returnTo}`)
  ) {
    throw new Error(`Sign-in failed: ${completed.headers.get("Location")}`);
  }
  cookies = cookieHeader(completed, cookies);
  const token = readCookie(cookies, cookieNames(false).session);
  const auth = await resolveWebSession(dashboard.services.webAuth, token);
  if (!auth) throw new Error("Session did not resolve after sign-in.");
  return { cookies, csrfToken: auth.csrfToken };
}
