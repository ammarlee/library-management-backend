import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prefer the Neon direct (non-pooler) URL for the runtime client.
 * Interactive transactions ($transaction + FOR UPDATE) break on the
 * transaction-mode pooler endpoint (-pooler).
 */
function resolveDatabaseUrl(): string | undefined {
  const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (unpooled) {
    return unpooled;
  }
  return process.env.DATABASE_URL;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = resolveDatabaseUrl();
    super(url ? { datasources: { db: { url } } } : undefined);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
