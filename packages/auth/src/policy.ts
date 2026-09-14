const MINUTE = 60 * 1_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Every lifetime the account system enforces, in one reviewed place. */
export const AUTH_POLICY = {
  /** Extension access tokens are short-lived; a revoked session stops within this window at most. */
  extensionAccessTokenMilliseconds: 15 * MINUTE,
  /** One-time code returned to Chrome's redirect URL. */
  extensionAuthorizationCodeMilliseconds: MINUTE,
  /** Absolute lifetime of an extension session before the user must reconnect. */
  extensionSessionMilliseconds: 90 * DAY,
  /** Time allowed between starting sign-in at the identity provider and returning. */
  loginAttemptMilliseconds: 10 * MINUTE,
  /** Account deletion requires a sign-in this recent. */
  recentAuthenticationMilliseconds: 5 * MINUTE,
  webSessionAbsoluteMilliseconds: 7 * DAY,
  webSessionIdleMilliseconds: 12 * HOUR,
} as const;
