import {
  openDatabase,
  purgeDeletedAccounts,
  purgeExpiredLoginAttempts,
  purgeSyncMetadata,
} from "@lingobridge/database";

const connectionString = process.env.DATABASE_URL?.trim();
const production = process.env.NODE_ENV === "production";
if (!connectionString && production) {
  throw new Error("DATABASE_URL is required for production maintenance.");
}

const embeddedDirectory = process.env.LINGOBRIDGE_EMBEDDED_DATABASE_DIR?.trim();
const database = await openDatabase({
  connectionString,
  embeddedDataDirectory:
    !production && embeddedDirectory && embeddedDirectory !== "memory"
      ? embeddedDirectory
      : undefined,
  production,
});

try {
  const now = new Date();
  await purgeSyncMetadata(database, now);
  await purgeExpiredLoginAttempts(database, now);
  const purgedAccounts = await purgeDeletedAccounts(database, now);
  // Maintenance output contains counts only; it never includes account or phrase data.
  process.stdout.write(`${JSON.stringify({ purgedAccounts })}\n`);
} finally {
  await database.close();
}
