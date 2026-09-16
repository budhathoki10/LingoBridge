import { z } from "zod";
import { languageCodeSchema, MAX_TRANSLATION_CODE_POINTS, providerSchema } from "./index.js";

/**
 * Account, extension-session, and synchronization contracts shared by the dashboard API and the
 * extension. Only explicitly saved phrases and allowlisted preferences appear here: there is no
 * shape for translation history, page URLs, site permissions, or sensitive-text decisions.
 */

export const DASHBOARD_API_ROUTES = {
  extensionRevoke: "/api/v1/extension/revoke",
  extensionToken: "/api/v1/extension/token",
  sync: "/api/v1/sync",
  vocabulary: "/api/v1/vocabulary",
} as const;

export const EXTENSION_CONNECT_PATH = "/extension/connect";

export const MAX_PHRASE_NOTE_CODE_POINTS = 500;
export const MAX_SYNC_MUTATIONS = 100;
export const MAX_SYNC_CHANGES = 200;
export const MAX_SYNCED_PHRASES_PER_USER = 5_000;
export const MAX_ACCOUNT_API_REQUEST_BYTES = 256 * 1_024;

const utf8Encoder = new TextEncoder();
const CONTROL_CHARACTERS = /\p{Cc}/u;

function boundedText(maximumCodePoints: number) {
  return z.string().superRefine((text, context) => {
    if (text.trim().length === 0) {
      context.addIssue({ code: "custom", message: "Text cannot be empty" });
    }
    if (Array.from(text).length > maximumCodePoints) {
      context.addIssue({
        code: "custom",
        message: `Text cannot exceed ${maximumCodePoints} code points`,
      });
    }
    if (utf8Encoder.encode(text).byteLength > maximumCodePoints * 4) {
      context.addIssue({ code: "custom", message: "Text is too large" });
    }
  });
}

export const phraseIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/u, "Expected a stable phrase identifier");
export const mutationIdSchema = z.string().uuid();
export const revisionSchema = z.number().int().min(0).max(2_147_483_647);
/** Digits continue incremental sync; an "r" prefix continues a full resynchronization. */
export const syncCursorSchema = z.string().regex(/^r?\d{1,19}$/u, "Expected a sync cursor");

export const phraseTextSchema = boundedText(MAX_TRANSLATION_CODE_POINTS);
export const phraseNoteSchema = z
  .string()
  .max(MAX_PHRASE_NOTE_CODE_POINTS * 4)
  .refine((note) => Array.from(note).length <= MAX_PHRASE_NOTE_CODE_POINTS, {
    message: `A note cannot exceed ${MAX_PHRASE_NOTE_CODE_POINTS} characters`,
  });
export const phraseProviderSchema = z.union([providerSchema, z.literal("unknown")]);

export const savedWordSchema = z
  .object({
    contextMeaning: z.string().trim().min(1).max(500),
    example: z.string().trim().min(1).max(300),
    id: phraseIdSchema,
    meaning: z.string().trim().min(1).max(500),
    partOfSpeech: z.string().trim().min(1).max(40),
    pronunciation: z.string().trim().min(1).max(160).nullable(),
    savedAt: z.string().datetime({ offset: true }),
    sourceLanguage: languageCodeSchema,
    sourceText: boundedText(1_000),
    targetLanguage: languageCodeSchema,
    translation: z.string().trim().min(1).max(300),
    word: z.string().trim().min(1).max(100),
  })
  .strict();

export const vocabularyUpsertRequestSchema = z.object({ word: savedWordSchema }).strict();
export const vocabularyUpsertResponseSchema = z.object({ word: savedWordSchema }).strict();

export const deviceLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((label) => !CONTROL_CHARACTERS.test(label), {
    message: "A device label cannot contain control characters",
  });

export const processingPreferenceSchema = z.enum(["online", "on-device"]);

/** Content the extension may send for a phrase. Timestamps and revisions belong to the server. */
export const phraseContentSchema = z
  .object({
    id: phraseIdSchema,
    note: phraseNoteSchema.nullable(),
    provider: phraseProviderSchema,
    savedAt: z.string().datetime({ offset: true }),
    sourceLanguage: languageCodeSchema,
    sourceText: phraseTextSchema,
    targetLanguage: languageCodeSchema,
    translatedText: phraseTextSchema,
  })
  .strict();

export const livePhraseRecordSchema = phraseContentSchema
  .extend({
    revision: revisionSchema.min(1),
    state: z.literal("live"),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/** A deletion carries no phrase text, so a tombstone never retains what the user removed. */
export const phraseTombstoneSchema = z
  .object({
    deletedAt: z.string().datetime({ offset: true }),
    id: phraseIdSchema,
    revision: revisionSchema.min(1),
    state: z.literal("deleted"),
  })
  .strict();

export const phraseRecordSchema = z.discriminatedUnion("state", [
  livePhraseRecordSchema,
  phraseTombstoneSchema,
]);

export const syncedPreferencesSchema = z
  .object({
    phraseSyncEnabled: z.boolean(),
    preferredTargetLanguage: languageCodeSchema.nullable(),
    processingPreference: processingPreferenceSchema.nullable(),
    revision: revisionSchema,
    updatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const preferencePatchSchema = z
  .object({
    preferredTargetLanguage: languageCodeSchema.nullable(),
    processingPreference: processingPreferenceSchema.nullable(),
  })
  .strict();

export const syncMutationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      baseRevision: revisionSchema,
      kind: z.literal("upsert-phrase"),
      mutationId: mutationIdSchema,
      phrase: phraseContentSchema,
    })
    .strict(),
  z
    .object({
      baseRevision: revisionSchema,
      kind: z.literal("delete-phrase"),
      mutationId: mutationIdSchema,
      phraseId: phraseIdSchema,
    })
    .strict(),
  z
    .object({
      baseRevision: revisionSchema,
      kind: z.literal("update-preferences"),
      mutationId: mutationIdSchema,
      preferences: preferencePatchSchema,
    })
    .strict(),
]);

export const syncRequestSchema = z
  .object({
    cursor: syncCursorSchema.nullable(),
    mutations: z.array(syncMutationSchema).max(MAX_SYNC_MUTATIONS),
  })
  .strict()
  .superRefine((request, context) => {
    const seen = new Set<string>();
    for (const [index, mutation] of request.mutations.entries()) {
      if (seen.has(mutation.mutationId)) {
        context.addIssue({
          code: "custom",
          message: "Mutation identifiers must be unique within a request",
          path: ["mutations", index, "mutationId"],
        });
      }
      seen.add(mutation.mutationId);
    }
  });

export const syncMutationStatusSchema = z.enum(["applied", "conflict", "rejected"]);
export const syncRejectionReasonSchema = z.enum(["sync-disabled", "limit-reached"]);

export const syncMutationResultSchema = z
  .object({
    mutationId: mutationIdSchema,
    phrase: phraseRecordSchema.nullable(),
    preferences: syncedPreferencesSchema.nullable(),
    reason: syncRejectionReasonSchema.nullable(),
    status: syncMutationStatusSchema,
  })
  .strict();

export const syncResponseSchema = z
  .object({
    changes: z
      .object({
        phrases: z.array(phraseRecordSchema).max(MAX_SYNC_CHANGES),
        preferences: syncedPreferencesSchema.nullable(),
      })
      .strict(),
    cursor: syncCursorSchema,
    /**
     * Set when the cursor was absent or older than retained tombstones. The client collects every
     * phrase id across the pages that follow and, once hasMore is false, removes previously synced
     * local phrases the server no longer has.
     */
    fullResync: z.boolean(),
    hasMore: z.boolean(),
    phraseSyncEnabled: z.boolean(),
    results: z.array(syncMutationResultSchema).max(MAX_SYNC_MUTATIONS),
  })
  .strict();

export const extensionTokenRequestSchema = z.discriminatedUnion("grantType", [
  z
    .object({
      code: z.string().min(32).max(128),
      codeVerifier: z
        .string()
        .regex(/^[A-Za-z0-9._~-]{43,128}$/u, "Expected an RFC 7636 code verifier"),
      grantType: z.literal("authorization_code"),
      redirectUri: z.string().url().max(200),
    })
    .strict(),
  z
    .object({
      grantType: z.literal("refresh_token"),
      refreshToken: z.string().min(32).max(128),
    })
    .strict(),
]);

export const connectedAccountSchema = z
  .object({
    displayName: z.string().max(120).nullable(),
    email: z.string().max(320).nullable(),
  })
  .strict();

export const extensionTokenResponseSchema = z
  .object({
    accessToken: z.string().min(32).max(128),
    accessTokenExpiresAt: z.string().datetime({ offset: true }),
    account: connectedAccountSchema,
    refreshToken: z.string().min(32).max(128),
    sessionExpiresAt: z.string().datetime({ offset: true }),
    sessionId: z.string().uuid(),
  })
  .strict();

export const accountApiErrorCodeSchema = z.enum([
  "invalid-request",
  "unauthorized",
  "session-expired",
  "session-revoked",
  "invalid-grant",
  "forbidden",
  "not-found",
  "conflict",
  "rate-limited",
  "internal-error",
]);

export const accountApiErrorSchema = z
  .object({
    code: accountApiErrorCodeSchema,
    message: z.string().min(1).max(240),
    retryable: z.boolean(),
  })
  .strict();

export type AccountApiError = z.infer<typeof accountApiErrorSchema>;
export type AccountApiErrorCode = z.infer<typeof accountApiErrorCodeSchema>;
export type ConnectedAccount = z.infer<typeof connectedAccountSchema>;
export type ExtensionTokenRequest = z.infer<typeof extensionTokenRequestSchema>;
export type ExtensionTokenResponse = z.infer<typeof extensionTokenResponseSchema>;
export type LivePhraseRecord = z.infer<typeof livePhraseRecordSchema>;
export type PhraseContent = z.infer<typeof phraseContentSchema>;
export type PhraseRecord = z.infer<typeof phraseRecordSchema>;
export type PhraseTombstone = z.infer<typeof phraseTombstoneSchema>;
export type PreferencePatch = z.infer<typeof preferencePatchSchema>;
export type ProcessingPreference = z.infer<typeof processingPreferenceSchema>;
export type SyncedPreferences = z.infer<typeof syncedPreferencesSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type SyncMutationResult = z.infer<typeof syncMutationResultSchema>;
export type SyncRejectionReason = z.infer<typeof syncRejectionReasonSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;
export type SyncResponse = z.infer<typeof syncResponseSchema>;
export type SavedWordRecord = z.infer<typeof savedWordSchema>;
