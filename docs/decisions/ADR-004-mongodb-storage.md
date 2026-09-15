# ADR-004: MongoDB for dashboard accounts and synchronized phrases

Status: **Accepted; implemented and verified locally against an embedded MongoDB replica set; Atlas deployment smoke test pending**
Decision date: **15 September 2026**

Amends the storage line of [ADR-003](ADR-003-dashboard-and-sync.md). Every other ADR-003 boundary
is unchanged.

## Context

The project owner has chosen MongoDB Atlas as the dashboard's managed database. ADR-003 named a
PostgreSQL-compatible database, and Phase 8 was built and tested against PostgreSQL.

## Decision

- Store users, dashboard and extension sessions, synchronized phrases, approved preferences, sync
  receipts, and deletion receipts in MongoDB. Production uses a MongoDB Atlas cluster through
  `DATABASE_URL` (`mongodb+srv://`), with the database named by `DATABASE_NAME`
  (default `lingobridge`).
- Keep the data boundary exactly as ADR-003 defines it. MongoDB holds only accounts and phrases the
  user explicitly saves while sync is enabled. No translation history, unsaved text, webpage
  history, site permissions, or sensitive-text decisions are stored.
- Only the dashboard server connects to the database. The extension never receives a connection
  string and continues to reach its data only through the authenticated `/api/v1/*` endpoints.
- Local development and automated tests use an embedded single-node MongoDB replica set
  (`mongodb-memory-server-core`). It is refused in production.

## How the PostgreSQL guarantees are kept

| Guarantee | PostgreSQL mechanism | MongoDB mechanism |
| --- | --- | --- |
| Atomic multi-record writes | Transactions | Multi-document transactions with snapshot read concern and majority write concern |
| One writer per account | `select … for update` on the user row | Each account transaction writes the user document first, so concurrent transactions conflict and the driver retries them |
| Ordered change feed | Global sequence | Per-account `changeSeq` counter on the user document, incremented inside the locked transaction |
| Tombstone shape | `check` constraints | `$jsonSchema` validator with `oneOf` live/tombstone shapes, `validationLevel: strict` |
| Uniqueness | Unique constraints | Unique indexes (identity, token hashes, `userId + id`, `userId + mutationId`) |
| Cascade on purge | `on delete cascade` | Explicit deletion of every user-owned collection in the purge transaction |
| Schema changes | Append-only SQL migrations | Append-only idempotent migrations recorded in `schemaMigrations` |

Transactions need a replica set. Atlas clusters are replica sets, including the free tier.

## Consequences

- Atlas cluster credentials are a production secret. They belong in the deployment secret store
  or a git-ignored `apps/dashboard/.env.local`, never in the repository, extension, logs, or chat.
- The database user should have `readWrite` on the LingoBridge database only, not Atlas admin.
- Atlas network access should allow only the dashboard deployment's egress addresses.
- Backups and point-in-time restore retention must be reviewed against the account-deletion
  promise before release.
- The first local test run downloads a MongoDB server binary.
- Sync cursors are now per account. No released client holds an old cursor, so no migration of
  cursors is needed.

## Rejected alternatives

### Connecting the extension directly to MongoDB

Every installed copy would carry database credentials, so any user could read or change every
account. It would also bypass session revocation and ownership checks.

### Storing all user activity

Rejected by ADR-003 and `docs/05-security-and-privacy.md`. It would reverse the product's privacy
promise and needs a separate decision with explicit consent.
