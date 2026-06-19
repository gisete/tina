// Throwaway: check OAuth token state in DB. Delete after use.
import { config } from "dotenv";
config({ path: ".env.local" });
import { db } from "@/db/client";
import { accounts, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const user = await db.query.users.findFirst({ where: eq(users.email, "gisete@gmail.com") });
  if (!user) { console.error("user not found"); process.exit(1); }
  const acct = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, user.id), eq(accounts.provider, "google")),
  });
  if (!acct) { console.error("account not found"); process.exit(1); }
  const now = Math.floor(Date.now() / 1000);
  console.log("expires_at  :", acct.expires_at);
  console.log("now         :", now);
  console.log("expired?    :", acct.expires_at ? now >= acct.expires_at : "no expires_at stored");
  console.log("access_token:", acct.access_token ? "present" : "MISSING");
  console.log("refresh_tok :", acct.refresh_token ? `present (${acct.refresh_token.slice(0, 20)}...)` : "MISSING");
  console.log("\nGRANTED SCOPE (verbatim from accounts.scope):");
  console.log(acct.scope ?? "(null — scope not stored)");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
