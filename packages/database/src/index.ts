export interface DatabaseConfiguration {
  readonly connectionStringConfigured: boolean;
}

export function inspectDatabaseConfiguration(
  connectionString: string | undefined,
): DatabaseConfiguration {
  return {
    connectionStringConfigured: Boolean(connectionString),
  };
}
