/**
 * Interactive transaction options for Neon / remote Postgres.
 * Default Prisma timeout is 5s, which is too low for inventory + sale flows.
 */
export const PRISMA_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 20_000,
} as const;
