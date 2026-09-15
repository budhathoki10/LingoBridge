import type { Database } from "./client.js";

export interface Migration {
  id: string;
  sql: string;
}

/**
 * Append-only. A shipped migration is never edited; a change adds a new entry. Every user-owned
 * table references `users(id)` with cascade so an account purge cannot leave orphaned content.
 */
export const migrations: readonly Migration[] = [
  {
    id: "0001_accounts_sessions_and_sync",
    sql: `
      create table users (
        id uuid primary key,
        identity_issuer text not null,
        identity_subject text not null,
        email text,
        email_verified boolean not null default false,
        display_name text,
        role text not null default 'user' check (role in ('user', 'admin')),
        privacy_policy_version text,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        deleted_at timestamptz,
        unique (identity_issuer, identity_subject)
      );

      create table login_attempts (
        id uuid primary key,
        state_hash text not null unique,
        browser_binding_hash text not null,
        nonce text not null,
        code_verifier text not null,
        purpose text not null check (purpose in ('sign-in', 'reauthenticate')),
        return_to text not null,
        user_id uuid references users(id) on delete cascade,
        created_at timestamptz not null,
        expires_at timestamptz not null,
        consumed_at timestamptz
      );

      create table web_sessions (
        id uuid primary key,
        user_id uuid not null references users(id) on delete cascade,
        token_hash text not null unique,
        created_at timestamptz not null,
        last_seen_at timestamptz not null,
        idle_expires_at timestamptz not null,
        absolute_expires_at timestamptz not null,
        authenticated_at timestamptz not null,
        revoked_at timestamptz
      );
      create index web_sessions_user_idx on web_sessions (user_id);

      create table extension_authorization_codes (
        code_hash text primary key,
        user_id uuid not null references users(id) on delete cascade,
        extension_id text not null,
        redirect_uri text not null,
        code_challenge text not null,
        device_label text not null,
        created_at timestamptz not null,
        expires_at timestamptz not null,
        consumed_at timestamptz
      );

      create table extension_sessions (
        id uuid primary key,
        user_id uuid not null references users(id) on delete cascade,
        extension_id text not null,
        device_label text not null,
        access_token_hash text not null unique,
        access_expires_at timestamptz not null,
        refresh_token_hash text not null unique,
        previous_refresh_token_hash text unique,
        created_at timestamptz not null,
        last_used_at timestamptz not null,
        expires_at timestamptz not null,
        revoked_at timestamptz,
        revoked_reason text check (
          revoked_reason in ('user', 'refresh-reuse', 'account-deleted')
        )
      );
      create index extension_sessions_user_idx on extension_sessions (user_id);

      create sequence sync_change_seq;

      create table phrases (
        user_id uuid not null references users(id) on delete cascade,
        id text not null,
        source_text text,
        translated_text text,
        source_language text,
        target_language text,
        provider text,
        note text,
        saved_at timestamptz not null,
        updated_at timestamptz not null,
        revision integer not null check (revision >= 1),
        deleted_at timestamptz,
        change_seq bigint not null,
        primary key (user_id, id),
        check (
          (deleted_at is null) = (
            source_text is not null and translated_text is not null
            and source_language is not null and target_language is not null
            and provider is not null
          )
        ),
        check (deleted_at is null or note is null)
      );
      create index phrases_user_change_idx on phrases (user_id, change_seq);
      create index phrases_user_saved_idx on phrases (user_id, saved_at desc) where deleted_at is null;

      create table preferences (
        user_id uuid primary key references users(id) on delete cascade,
        preferred_target_language text,
        processing_preference text check (processing_preference in ('online', 'on-device')),
        phrase_sync_enabled boolean not null default true,
        revision integer not null default 0,
        updated_at timestamptz,
        change_seq bigint not null default 0
      );

      create table sync_mutations (
        user_id uuid not null references users(id) on delete cascade,
        mutation_id uuid not null,
        status text not null check (status in ('applied', 'conflict', 'rejected')),
        reason text,
        phrase_id text,
        created_at timestamptz not null,
        primary key (user_id, mutation_id)
      );

      create table sync_metadata (
        key text primary key,
        value bigint not null
      );

      create table deletion_receipts (
        id uuid primary key,
        user_id uuid not null,
        requested_at timestamptz not null,
        content_deleted_at timestamptz not null,
        account_purge_after timestamptz not null,
        account_purged_at timestamptz
      );
    `,
  },
];

export async function runMigrations(database: Database): Promise<string[]> {
  await database.exec(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const applied = new Set(
    (await database.query<{ id: string }>("select id from schema_migrations")).rows.map(
      (row) => row.id,
    ),
  );

  const newlyApplied: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await database.transaction(async (client) => {
      await client.exec(migration.sql);
      await client.query("insert into schema_migrations (id) values ($1)", [migration.id]);
    });
    newlyApplied.push(migration.id);
  }
  return newlyApplied;
}
