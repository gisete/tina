// DB-only loader for GET /api/v1/state. No Google calls.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, sleepSessions, syncState } from "@/db/schema";
import { calculateCircadianVariance, calculateSleepDebt, selectMainSessions } from "@/lib/analytics/sleep";
import { buildStateData, type StateData } from "@/lib/api";

const DEBT_TARGET_HOURS = 8;
const SESSION_LIMIT = 90;

export async function loadState(userId: string): Promise<StateData> {
  const [rows, syncRow, account] = await Promise.all([
    db.query.sleepSessions.findMany({
      where: eq(sleepSessions.userId, userId),
      orderBy: [desc(sleepSessions.sleepDate)],
      limit: SESSION_LIMIT,
    }),
    db.query.syncState.findFirst({ where: eq(syncState.userId, userId) }),
    db.query.accounts.findFirst({ where: and(eq(accounts.userId, userId), eq(accounts.provider, "google")) }),
  ]);

  const main = selectMainSessions(rows);
  const epoch = syncRow?.lastSyncedAt?.getTime() ?? null;
  return buildStateData({
    debt: main.length > 0 ? calculateSleepDebt(main, DEBT_TARGET_HOURS) : null,
    variance: main.length > 0 ? calculateCircadianVariance(main) : null,
    debtTargetHours: DEBT_TARGET_HOURS,
    // The epoch placeholder means "never synced".
    lastSyncedAtMs: epoch === null || epoch === 0 ? null : epoch,
    syncedThrough: syncRow?.syncedThrough ?? null,
    serverOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    google: {
      linked: account !== undefined,
      hasRefreshToken: Boolean(account?.refresh_token),
      accessTokenExpiresAtSec: account?.expires_at ?? null,
    },
  });
}
