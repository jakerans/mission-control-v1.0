import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/db/schema';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is not set. Add it to .env (see .env.example).');

// Reuse one connection pool across hot reloads so dev doesn't leak connections.
const globalForDb = globalThis as unknown as { pgClient?: postgres.Sql };
const client = globalForDb.pgClient ?? postgres(databaseUrl, { max: 20 });
if (process.env.NODE_ENV !== 'production') globalForDb.pgClient = client;

export const db = drizzle({ client, schema });
export * from '@/db/schema';
