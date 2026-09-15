import { Prisma } from '@prisma/client';

const START_NUMBER = 1000;

type DbClient = Prisma.TransactionClient | {
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
};

/**
 * Sequential numeric reservation numbers: 1000, 1001, 1002, ...
 * Ignores legacy non-numeric values (e.g. RES-...).
 */
export async function generateReservationNumber(
  db: DbClient,
): Promise<string> {
  const rows = await db.$queryRaw<Array<{ max: number | bigint | null }>>`
    SELECT MAX(CAST("reservationNumber" AS INTEGER)) AS max
    FROM "Reservation"
    WHERE "reservationNumber" ~ '^[0-9]+$'
  `;

  const currentMax = Number(rows[0]?.max ?? START_NUMBER - 1);
  const next = Number.isFinite(currentMax)
    ? Math.max(currentMax + 1, START_NUMBER)
    : START_NUMBER;

  return String(next);
}
