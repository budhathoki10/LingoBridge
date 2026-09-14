import { isRecentlyAuthenticated } from "@lingobridge/auth";
import {
  phraseIdSchema,
  phraseNoteSchema,
  processingPreferenceSchema,
  revisionSchema,
} from "@lingobridge/contracts/account";
import { languageCodeSchema } from "@lingobridge/contracts";
import {
  deleteAccount,
  deleteAllPhrases,
  deletePhrases,
  exportAccount,
  listAllLivePhrases,
  revokeAllExtensionSessions,
  revokeExtensionSession,
  updateDashboardPreferences,
  updatePhraseNote,
} from "@lingobridge/database";
import { z } from "zod";
import { ACCOUNT_DELETION_CONFIRMATION, DELETE_ALL_CONFIRMATION } from "../../lib/privacy";
import { clearCookie, cookieNames } from "../cookies";
import { errorResponse, jsonResponse, readJsonBody } from "../http";
import { authenticateDashboardRequest } from "../request-auth";
import type { DashboardServices } from "../services";

async function mutation<Schema extends z.ZodType>(
  request: Request,
  services: DashboardServices,
  schema: Schema,
) {
  const auth = await authenticateDashboardRequest(request, services, { mutation: true });
  if (!auth.ok) return { ok: false as const, response: auth.response };
  const body = await readJsonBody(request, 64 * 1_024);
  if (!body.ok) return { ok: false as const, response: body.response };
  const parsed = schema.safeParse(body.value);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: errorResponse("invalid-request", "The request is not valid."),
    };
  }
  return { auth, data: parsed.data as z.infer<Schema>, ok: true as const };
}

const noteSchema = z
  .object({
    baseRevision: revisionSchema.min(1),
    note: phraseNoteSchema.nullable(),
    phraseId: phraseIdSchema,
  })
  .strict();

/** POST /api/dashboard/phrases/note */
export async function handleUpdateNote(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const input = await mutation(request, services, noteSchema);
  if (!input.ok) return input.response;
  const note = input.data.note?.trim() ? input.data.note.trim() : null;
  const outcome = await updatePhraseNote(
    services.database,
    input.auth.auth.user.id,
    { baseRevision: input.data.baseRevision, note, phraseId: input.data.phraseId },
    services.now(),
  );
  if (outcome.status === "not-found")
    return errorResponse("not-found", "That phrase no longer exists.");
  if (outcome.status === "conflict") {
    return jsonResponse(
      { code: "conflict", message: "This phrase changed elsewhere.", phrase: outcome.phrase },
      { status: 409 },
    );
  }
  return jsonResponse({ phrase: outcome.phrase });
}

const deleteSchema = z.union([
  z.object({ phraseIds: z.array(phraseIdSchema).min(1).max(500) }).strict(),
  z.object({ all: z.literal(true), confirmation: z.literal(DELETE_ALL_CONFIRMATION) }).strict(),
]);

/** POST /api/dashboard/phrases/delete — selected phrases, or every synced phrase with confirmation. */
export async function handleDeletePhrases(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const input = await mutation(request, services, deleteSchema);
  if (!input.ok) return input.response;
  const userId = input.auth.auth.user.id;
  const deleted =
    "all" in input.data
      ? await deleteAllPhrases(services.database, userId, services.now())
      : await deletePhrases(services.database, userId, input.data.phraseIds, services.now());
  return jsonResponse({ deleted });
}

const preferencesSchema = z
  .object({
    baseRevision: revisionSchema,
    phraseSyncEnabled: z.boolean().optional(),
    preferredTargetLanguage: languageCodeSchema.nullable().optional(),
    processingPreference: processingPreferenceSchema.nullable().optional(),
  })
  .strict();

/** POST /api/dashboard/preferences — only allowlisted, syncable fields exist in the schema. */
export async function handleUpdatePreferences(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const input = await mutation(request, services, preferencesSchema);
  if (!input.ok) return input.response;
  const { baseRevision, ...patch } = input.data;
  const outcome = await updateDashboardPreferences(
    services.database,
    input.auth.auth.user.id,
    { baseRevision, patch },
    services.now(),
  );
  if (outcome.status === "conflict") {
    return jsonResponse(
      {
        code: "conflict",
        message: "Preferences changed on another device. The latest values are shown.",
        preferences: outcome.preferences,
      },
      { status: 409 },
    );
  }
  return jsonResponse({ preferences: outcome.preferences });
}

const revokeSchema = z.union([
  z.object({ sessionId: z.string().uuid() }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

/** POST /api/dashboard/extensions/revoke */
export async function handleRevokeExtension(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const input = await mutation(request, services, revokeSchema);
  if (!input.ok) return input.response;
  const userId = input.auth.auth.user.id;
  if ("all" in input.data) {
    const revoked = await revokeAllExtensionSessions(
      services.database,
      userId,
      "user",
      services.now(),
    );
    return jsonResponse({ revoked });
  }
  const revoked = await revokeExtensionSession(
    services.database,
    userId,
    input.data.sessionId,
    services.now(),
  );
  if (!revoked)
    return errorResponse("not-found", "That connection was not found or is already revoked.");
  return jsonResponse({ revoked: 1 });
}

/** GET /api/dashboard/export?scope=phrases|account */
export async function handleExport(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const auth = await authenticateDashboardRequest(request, services, { mutation: false });
  if (!auth.ok) return auth.response;
  const scope =
    new URL(request.url).searchParams.get("scope") === "account" ? "account" : "phrases";
  const now = services.now();
  const userId = auth.auth.user.id;
  const body =
    scope === "account"
      ? await exportAccount(services.database, userId, now)
      : {
          exportedAt: now.toISOString(),
          phrases: await listAllLivePhrases(services.database, userId),
          version: 1,
        };
  if (!body) return errorResponse("not-found", "The account is no longer available.");
  const filename = `lingobridge-${scope}-${now.toISOString().slice(0, 10)}.json`;
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const accountDeletionSchema = z
  .object({ confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION) })
  .strict();

/**
 * POST /api/dashboard/account/delete — requires a sign-in within the recent-authentication window
 * and the typed confirmation. Content is removed and every session revoked in one transaction.
 */
export async function handleDeleteAccount(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const input = await mutation(request, services, accountDeletionSchema);
  if (!input.ok) return input.response;
  if (!isRecentlyAuthenticated(input.auth.auth.session, services.now())) {
    return jsonResponse(
      {
        code: "reauthentication-required",
        message: "Confirm it’s you before deleting the account.",
      },
      { status: 403 },
    );
  }
  const result = await deleteAccount(services.database, input.auth.auth.user.id, services.now());
  const names = cookieNames(services.config.secureCookies);
  return jsonResponse(
    { receiptId: result.receipt.id },
    { headers: { "Set-Cookie": clearCookie(names.session, services.config.secureCookies) } },
  );
}
