import type { ClientSession, Collection, Db, Document, MongoClient } from "mongodb";

/**
 * The handle every store receives. Outside a transaction `session` is absent; inside one, every
 * read and write must pass it so the operation joins the transaction's snapshot.
 */
export interface DbClient {
  readonly db: Db;
  readonly session?: ClientSession;
}

export interface Database extends DbClient {
  close(): Promise<void>;
  transaction<T>(work: (client: DbClient) => Promise<T>): Promise<T>;
}

export interface UserDocument {
  _id: string;
  changeSeq: number;
  createdAt: Date;
  deletedAt: Date | null;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  identityIssuer: string;
  identitySubject: string;
  lockVersion: number;
  role: "user" | "admin";
  tombstonePurgeSeq: number;
  updatedAt: Date;
}

export interface PreferencesDocument {
  _id: string;
  changeSeq: number;
  phraseSyncEnabled: boolean;
  preferredTargetLanguage: string | null;
  processingPreference: "online" | "on-device" | null;
  revision: number;
  updatedAt: Date | null;
}

export interface PhraseDocument {
  changeSeq: number;
  deletedAt: Date | null;
  id: string;
  note: string | null;
  provider: string | null;
  revision: number;
  savedAt: Date;
  sourceLanguage: string | null;
  sourceText: string | null;
  targetLanguage: string | null;
  translatedText: string | null;
  updatedAt: Date;
  userId: string;
}

export interface LoginAttemptDocument {
  _id: string;
  browserBindingHash: string;
  codeVerifier: string;
  consumedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  nonce: string;
  purpose: "sign-in" | "reauthenticate";
  returnTo: string;
  stateHash: string;
  userId: string | null;
}

export interface WebSessionDocument {
  _id: string;
  absoluteExpiresAt: Date;
  authenticatedAt: Date;
  createdAt: Date;
  idleExpiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  tokenHash: string;
  userId: string;
}

export interface ExtensionAuthorizationCodeDocument {
  _id: string;
  codeChallenge: string;
  consumedAt: Date | null;
  createdAt: Date;
  deviceLabel: string;
  expiresAt: Date;
  extensionId: string;
  redirectUri: string;
  userId: string;
}

export interface ExtensionSessionDocument {
  _id: string;
  accessExpiresAt: Date;
  accessTokenHash: string;
  createdAt: Date;
  deviceLabel: string;
  expiresAt: Date;
  extensionId: string;
  lastUsedAt: Date;
  /** Absent until the first rotation, so the unique partial index ignores new sessions. */
  previousRefreshTokenHash?: string;
  refreshTokenHash: string;
  revokedAt: Date | null;
  revokedReason: "user" | "refresh-reuse" | "account-deleted" | null;
  userId: string;
}

export interface SyncMutationDocument {
  createdAt: Date;
  mutationId: string;
  phraseId: string | null;
  reason: string | null;
  status: "applied" | "conflict" | "rejected";
  userId: string;
}

export interface DeletionReceiptDocument {
  _id: string;
  accountPurgeAfter: Date;
  accountPurgedAt: Date | null;
  contentDeletedAt: Date;
  requestedAt: Date;
  userId: string;
}

export interface VocabularyDocument {
  contextMeaning: string;
  example: string;
  id: string;
  meaning: string;
  partOfSpeech: string;
  pronunciation: string | null;
  savedAt: Date;
  sourceLanguage: string;
  sourceText: string;
  targetLanguage: string;
  translation: string;
  userId: string;
  word: string;
}

export interface CollectionDocuments {
  deletionReceipts: DeletionReceiptDocument;
  extensionAuthorizationCodes: ExtensionAuthorizationCodeDocument;
  extensionSessions: ExtensionSessionDocument;
  loginAttempts: LoginAttemptDocument;
  phrases: PhraseDocument;
  preferences: PreferencesDocument;
  syncMutations: SyncMutationDocument;
  users: UserDocument;
  vocabulary: VocabularyDocument;
  webSessions: WebSessionDocument;
}

export type CollectionName = keyof CollectionDocuments;

export function collection<Name extends CollectionName>(
  client: DbClient,
  name: Name,
): Collection<CollectionDocuments[Name] & Document> {
  return client.db.collection<CollectionDocuments[Name] & Document>(name);
}

/** Options that bind an operation to the caller's transaction when there is one. */
export function inSession(client: DbClient): { session?: ClientSession } {
  return client.session ? { session: client.session } : {};
}

export function createMongoDatabase(
  mongo: MongoClient,
  databaseName: string,
  onClose?: () => Promise<void>,
): Database {
  const db = mongo.db(databaseName);
  return {
    db,
    close: async () => {
      await mongo.close();
      await onClose?.();
    },
    async transaction(work) {
      const session = mongo.startSession();
      try {
        // withTransaction retries transient write conflicts, which is how two concurrent writes to
        // the same account are serialized. Work functions must therefore be safe to re-run.
        return await session.withTransaction(() => work({ db, session }), {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        });
      } finally {
        await session.endSession();
      }
    },
  };
}

export function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

export function toNullableIsoString(value: unknown): string | null {
  return value === null || value === undefined ? null : toIsoString(value);
}
