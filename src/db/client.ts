import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// `next build` imports route modules to collect page data, with no database and
// no secrets (the Docker build has neither). Skip the check only in that phase:
// the pool never connects until a query runs, and at runtime a missing URL
// still fails loudly here.
const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

// Ensure we have a database URL configured
if (!process.env.DATABASE_URL && !isProductionBuild) {
  throw new Error("DATABASE_URL environment variable is missing!");
}

// Create a persistent connection pool for Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Initialize Drizzle with our schema for type-safe relational queries
export const db = drizzle(pool, { schema });
