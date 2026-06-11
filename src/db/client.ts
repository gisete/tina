import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Ensure we have a database URL configured
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is missing!");
}

// Create a persistent connection pool for Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Initialize Drizzle with our schema for type-safe relational queries
export const db = drizzle(pool, { schema });
