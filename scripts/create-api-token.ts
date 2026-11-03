// Usage: npx tsx scripts/create-api-token.ts <name> <scopes> [email]
//   scopes: comma-separated subset of read,sync   e.g. read,sync
//   email:  owner's email; optional when exactly one user exists.
// Prints the plaintext token ONCE. Only its SHA-256 hash is stored.
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { apiTokens, users } from "@/db/schema";
import { API_SCOPES, TOKEN_PREFIX, hashToken, isApiScope, type ApiScope } from "@/lib/api/token";

async function main(): Promise<void> {
  const [name, scopesArg, email] = process.argv.slice(2);
  if (!name || !scopesArg) {
    console.error("Usage: npx tsx scripts/create-api-token.ts <name> <read,sync> [email]");
    process.exit(1);
  }
  const requested = scopesArg.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = requested.filter((s) => !isApiScope(s));
  if (requested.length === 0 || bad.length > 0) {
    console.error(`Invalid scopes${bad.length ? ` (${bad.join(", ")})` : ""}. Allowed: ${API_SCOPES.join(", ")}`);
    process.exit(1);
  }
  const scopes: ApiScope[] = [...new Set(requested.filter(isApiScope))];

  const owners = email ? await db.select({ id: users.id }).from(users).where(eq(users.email, email)) : await db.select({ id: users.id }).from(users);
  if (owners.length !== 1) {
    console.error(owners.length === 0 ? "No matching user." : "Several users exist; pass the owner's email as the third argument.");
    process.exit(1);
  }

  const plaintext = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const [row] = await db
    .insert(apiTokens)
    .values({ userId: owners[0].id, name, tokenHash: hashToken(plaintext), scopes })
    .returning({ id: apiTokens.id });

  console.log(`Created token "${name}" (id ${row.id}) with scopes: ${scopes.join(",")}`);
  console.log("Copy it now — it is not stored and cannot be shown again:\n");
  console.log(plaintext);
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
