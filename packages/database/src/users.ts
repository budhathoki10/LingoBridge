import { randomUUID } from "node:crypto";
import { type SqlClient, toIsoString, toNullableIsoString } from "./client.js";

export type UserRole = "user" | "admin";

export interface User {
  createdAt: string;
  deletedAt: string | null;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  id: string;
  identityIssuer: string;
  role: UserRole;
}

export interface VerifiedIdentity {
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  issuer: string;
  subject: string;
}

interface UserRow {
  created_at: unknown;
  deleted_at: unknown;
  display_name: string | null;
  email: string | null;
  email_verified: boolean;
  id: string;
  identity_issuer: string;
  role: UserRole;
}

const USER_COLUMNS =
  "id, identity_issuer, email, email_verified, display_name, role, created_at, deleted_at";

function toUser(row: UserRow): User {
  return {
    createdAt: toIsoString(row.created_at),
    deletedAt: toNullableIsoString(row.deleted_at),
    displayName: row.display_name,
    email: row.email,
    emailVerified: row.email_verified,
    id: row.id,
    identityIssuer: row.identity_issuer,
    role: row.role,
  };
}

/**
 * The identity provider is the only source of who a user is. The role is decided by the server at
 * every sign-in, so removing someone from the admin allowlist demotes them on their next visit.
 */
export async function upsertUserFromIdentity(
  client: SqlClient,
  identity: VerifiedIdentity,
  role: UserRole,
  now: Date,
): Promise<User> {
  const { rows } = await client.query<UserRow>(
    `insert into users (id, identity_issuer, identity_subject, email, email_verified,
                        display_name, role, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     on conflict (identity_issuer, identity_subject) do update
       set email = excluded.email,
           email_verified = excluded.email_verified,
           display_name = excluded.display_name,
           role = excluded.role,
           updated_at = excluded.updated_at
     returning ${USER_COLUMNS}`,
    [
      randomUUID(),
      identity.issuer,
      identity.subject,
      identity.email,
      identity.emailVerified,
      identity.displayName,
      role,
      now,
    ],
  );
  const user = rows[0];
  if (!user) throw new Error("User upsert returned no row.");
  await client.query(
    "insert into preferences (user_id) values ($1) on conflict (user_id) do nothing",
    [user.id],
  );
  return toUser(user);
}

export async function findUserByIdentity(
  client: SqlClient,
  issuer: string,
  subject: string,
): Promise<User | null> {
  const { rows } = await client.query<UserRow>(
    `select ${USER_COLUMNS} from users
      where identity_issuer = $1 and identity_subject = $2 and deleted_at is null`,
    [issuer, subject],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function findUserById(client: SqlClient, userId: string): Promise<User | null> {
  const { rows } = await client.query<UserRow>(
    `select ${USER_COLUMNS} from users where id = $1 and deleted_at is null`,
    [userId],
  );
  return rows[0] ? toUser(rows[0]) : null;
}
