// Usage: npx tsx scripts/revoke-api-token.ts <token-id>
// Marks the token revoked (kept for audit; it can no longer authenticate).
import "./_load-env";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { apiTokens } from "@/db/schema";

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: npx tsx scripts/revoke-api-token.ts <token-id>");
    process.exit(1);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    console.error("Token id must be a UUID (printed when the token was created).");
    process.exit(1);
  }
  const rows = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id, name: apiTokens.name });
  if (rows.length === 0) {
    console.error("No active token with that id.");
    process.exit(1);
  }
  console.log(`Revoked token "${rows[0].name}" (${rows[0].id}).`);
  process.exit(0);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
