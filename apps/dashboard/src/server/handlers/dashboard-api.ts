import { isRecentlyAuthenticated } from "@lingobridge/auth";
import {
  phraseIdSchema,
  phraseNoteSchema,
  processingPreferenceSchema,
  revisionSchema,
} from "@lingobridge/contracts/account";
import { languageCodeSchema } from "@lingobridge/contracts";
import {
  type AccountExport,
  deleteAccount,
  deleteAllPhrases,
  deletePhrases,
  exportAccount,
  listAllLivePhrases,
  revokeAllExtensionSessions,
  revokeExtensionSession,
  updateDashboardPreferences,
  updatePhraseNote,
  deleteSavedWords,
  listSavedWords,
} from "@lingobridge/database";
import type { LivePhraseRecord, SavedWordRecord } from "@lingobridge/contracts/account";
import ExcelJS from "exceljs";
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

const vocabularyDeleteSchema = z.object({ ids: z.array(phraseIdSchema).min(1).max(500) }).strict();

export async function handleDeleteVocabulary(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const input = await mutation(request, services, vocabularyDeleteSchema);
  if (!input.ok) return input.response;
  const deleted = await deleteSavedWords(
    services.database,
    input.auth.auth.user.id,
    input.data.ids,
  );
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

function formatPhrases(phrases: readonly LivePhraseRecord[]): string[] {
  const lines: string[] = [];
  for (const [index, phrase] of phrases.entries()) {
    if (index > 0) lines.push("", "----------------------------------------", "");
    lines.push("Source:", phrase.sourceText, "", "Translation:", phrase.translatedText);
  }
  return lines;
}

async function buildVocabularyWorkbook(words: readonly SavedWordRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LingoBridge";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Vocabulary");
  sheet.columns = [
    { header: "Word", key: "word", width: 20 },
    { header: "Translation", key: "translation", width: 20 },
    { header: "Meaning", key: "meaning", width: 40 },
    { header: "Part of speech", key: "partOfSpeech", width: 16 },
    { header: "In this context", key: "contextMeaning", width: 40 },
    { header: "Example", key: "example", width: 40 },
    { header: "Pronunciation", key: "pronunciation", width: 18 },
    { header: "Saved at", key: "savedAt", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const word of words) {
    sheet.addRow({
      contextMeaning: word.contextMeaning,
      example: word.example,
      meaning: word.meaning,
      partOfSpeech: word.partOfSpeech,
      pronunciation: word.pronunciation ?? "",
      savedAt: word.savedAt,
      translation: word.translation,
      word: word.word,
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function buildPhraseWorkbook(phrases: readonly LivePhraseRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LingoBridge";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Saved phrases");
  sheet.columns = [
    { header: "Source", key: "source", width: 50 },
    { header: "Translation", key: "translation", width: 50 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const phrase of phrases) {
    sheet.addRow({ source: phrase.sourceText, translation: phrase.translatedText });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function formatAccountExport(exported: AccountExport): string {
  const preferences = exported.preferences;
  const lines = [
    "LingoBridge Account Data",
    `Exported: ${exported.exportedAt}`,
    "",
    "ACCOUNT",
    `Display name: ${exported.account.displayName ?? "Not provided"}`,
    `Email: ${exported.account.email ?? "Not provided"}`,
    `Role: ${exported.account.role}`,
    `Created: ${exported.account.createdAt}`,
    "",
    "PREFERENCES",
    `Preferred target language: ${preferences.preferredTargetLanguage ?? "Not set"}`,
    `Processing preference: ${preferences.processingPreference ?? "Not set"}`,
    `Phrase sync: ${preferences.phraseSyncEnabled ? "Enabled" : "Disabled"}`,
    `Updated: ${preferences.updatedAt ?? "Never"}`,
    `Revision: ${preferences.revision}`,
    "",
    `CONNECTED EXTENSIONS (${exported.extensionSessions.length})`,
  ];
  if (exported.extensionSessions.length === 0) lines.push("None");
  for (const [index, session] of exported.extensionSessions.entries()) {
    lines.push(
      "",
      `Extension ${index + 1}`,
      `Device: ${session.deviceLabel}`,
      `Connected: ${session.connectedAt}`,
      `Last used: ${session.lastUsedAt}`,
      `Revoked: ${session.revokedAt ?? "No"}`,
    );
  }
  lines.push("", `SAVED PHRASES (${exported.phrases.length})`, ...formatPhrases(exported.phrases));
  lines.push("", `SAVED VOCABULARY (${exported.vocabulary.length})`);
  for (const word of exported.vocabulary) {
    lines.push("", word.word, word.translation, word.meaning);
  }
  return `${lines.join("\n")}\n`;
}

/** GET /api/dashboard/export?scope=phrases|vocabulary|account */
export async function handleExport(
  request: Request,
  services: DashboardServices,
): Promise<Response> {
  const auth = await authenticateDashboardRequest(request, services, { mutation: false });
  if (!auth.ok) return auth.response;
  const requestedScope = new URL(request.url).searchParams.get("scope");
  const scope =
    requestedScope === "account"
      ? "account"
      : requestedScope === "vocabulary"
        ? "vocabulary"
        : "phrases";
  const now = services.now();
  const userId = auth.auth.user.id;
  if (scope === "vocabulary") {
    const words = await listSavedWords(services.database, userId);
    const buffer = await buildVocabularyWorkbook(words);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="lingobridge-vocabulary-${now.toISOString().slice(0, 10)}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (scope === "phrases") {
    const phrases = await listAllLivePhrases(services.database, userId);
    const buffer = await buildPhraseWorkbook(phrases);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="lingobridge-phrases-${now.toISOString().slice(0, 10)}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const exported = await exportAccount(services.database, userId, now);
  if (!exported) return errorResponse("not-found", "The account is no longer available.");
  const text = formatAccountExport(exported);
  const filename = `lingobridge-account-${now.toISOString().slice(0, 10)}.txt`;
  return new Response(text, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/plain; charset=utf-8",
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
