import { MongoMemoryReplSet } from "mongodb-memory-server-core";

/**
 * One embedded single-node replica set for the whole run. Each test opens its own uniquely named
 * database on it, so test files stay isolated while paying the server start-up cost once.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const server = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  process.env.LINGOBRIDGE_TEST_MONGODB_URI = server.getUri();
  return async () => {
    await server.stop();
  };
}
