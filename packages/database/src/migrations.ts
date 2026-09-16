import type { Db, Document } from "mongodb";
import type { Database } from "./client.js";

export interface Migration {
  id: string;
  apply(db: Db): Promise<void>;
}

const nullableString = { bsonType: ["string", "null"] };
const nullableDate = { bsonType: ["date", "null"] };

/**
 * A live phrase carries its text and languages; a tombstone carries none of them and no note. The
 * database refuses either half-shape so a bug cannot leave deleted text behind.
 */
const phraseValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["userId", "id", "savedAt", "updatedAt", "revision", "deletedAt", "changeSeq"],
    properties: {
      userId: { bsonType: "string" },
      id: { bsonType: "string" },
      revision: { bsonType: ["int", "long", "double"], minimum: 1 },
      changeSeq: { bsonType: ["int", "long", "double"] },
      savedAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
    },
    oneOf: [
      {
        required: ["sourceText", "translatedText", "sourceLanguage", "targetLanguage", "provider"],
        properties: {
          deletedAt: { bsonType: "null" },
          sourceText: { bsonType: "string" },
          translatedText: { bsonType: "string" },
          sourceLanguage: { bsonType: "string" },
          targetLanguage: { bsonType: "string" },
          provider: { bsonType: "string" },
          note: nullableString,
        },
      },
      {
        required: ["deletedAt"],
        properties: {
          deletedAt: { bsonType: "date" },
          sourceText: { bsonType: "null" },
          translatedText: { bsonType: "null" },
          sourceLanguage: { bsonType: "null" },
          targetLanguage: { bsonType: "null" },
          provider: { bsonType: "null" },
          note: { bsonType: "null" },
        },
      },
    ],
  },
};

const userValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    required: ["identityIssuer", "identitySubject", "role", "createdAt", "updatedAt"],
    properties: {
      identityIssuer: { bsonType: "string" },
      identitySubject: { bsonType: "string" },
      email: nullableString,
      displayName: nullableString,
      role: { enum: ["user", "admin"] },
      deletedAt: nullableDate,
    },
  },
};

const extensionSessionValidator: Document = {
  $jsonSchema: {
    bsonType: "object",
    properties: {
      revokedReason: { enum: ["user", "refresh-reuse", "account-deleted", null] },
    },
  },
};

async function createCollection(db: Db, name: string, validator?: Document): Promise<void> {
  const existing = await db.listCollections({ name }, { nameOnly: true }).toArray();
  if (existing.length > 0) return;
  await db.createCollection(name, validator ? { validator, validationLevel: "strict" } : {});
}

/**
 * Append-only. A shipped migration is never edited; a change adds a new entry. Collections are
 * created up front because MongoDB cannot create them inside a multi-document transaction.
 */
export const migrations: readonly Migration[] = [
  {
    id: "0001_accounts_sessions_and_sync",
    async apply(db) {
      await createCollection(db, "users", userValidator);
      await createCollection(db, "preferences");
      await createCollection(db, "loginAttempts");
      await createCollection(db, "webSessions");
      await createCollection(db, "extensionAuthorizationCodes");
      await createCollection(db, "extensionSessions", extensionSessionValidator);
      await createCollection(db, "phrases", phraseValidator);
      await createCollection(db, "syncMutations");
      await createCollection(db, "deletionReceipts");

      await db
        .collection("users")
        .createIndex({ identityIssuer: 1, identitySubject: 1 }, { unique: true });
      await db.collection("loginAttempts").createIndex({ stateHash: 1 }, { unique: true });
      await db.collection("loginAttempts").createIndex({ userId: 1 });
      await db.collection("webSessions").createIndex({ tokenHash: 1 }, { unique: true });
      await db.collection("webSessions").createIndex({ userId: 1 });
      await db.collection("extensionAuthorizationCodes").createIndex({ userId: 1 });
      const extensionSessions = db.collection("extensionSessions");
      await extensionSessions.createIndex({ userId: 1 });
      await extensionSessions.createIndex({ accessTokenHash: 1 }, { unique: true });
      await extensionSessions.createIndex({ refreshTokenHash: 1 }, { unique: true });
      await extensionSessions.createIndex(
        { previousRefreshTokenHash: 1 },
        {
          partialFilterExpression: { previousRefreshTokenHash: { $type: "string" } },
          unique: true,
        },
      );
      const phrases = db.collection("phrases");
      await phrases.createIndex({ userId: 1, id: 1 }, { unique: true });
      await phrases.createIndex({ userId: 1, changeSeq: 1 });
      await phrases.createIndex({ userId: 1, deletedAt: 1, savedAt: -1 });
      await db
        .collection("syncMutations")
        .createIndex({ userId: 1, mutationId: 1 }, { unique: true });
      await db.collection("syncMutations").createIndex({ createdAt: 1 });
    },
  },
  {
    id: "0002_saved_vocabulary",
    async apply(db) {
      await createCollection(db, "vocabulary");
      await db.collection("vocabulary").createIndex({ userId: 1, id: 1 }, { unique: true });
      await db.collection("vocabulary").createIndex({ userId: 1, savedAt: -1 });
      await db.collection("vocabulary").createIndex({ userId: 1, word: 1 });
    },
  },
];

export async function runMigrations(database: Database): Promise<string[]> {
  const applied = database.db.collection<{ _id: string; appliedAt: Date }>("schemaMigrations");
  const done = new Set((await applied.find({}).toArray()).map((entry) => entry._id));

  const newlyApplied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    // Every step is idempotent, so a migration interrupted part-way is simply run again.
    await migration.apply(database.db);
    await applied.insertOne({ _id: migration.id, appliedAt: new Date() });
    newlyApplied.push(migration.id);
  }
  return newlyApplied;
}
