"use server";

import { auth } from "@/auth";
import { db } from "@/db/client";
import { dailyFeelingTags } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { VALID_FEELING_TAG_IDS } from "@/lib/analytics/feeling-tags";

type SetFeelingResult = { ok: true } | { ok: false; error: string };

/**
 * Replace-the-set: deletes all existing feeling rows for (userId, nightOf) and
 * inserts one row per tagId. Empty tagIds = clear all selections.
 *
 * nightOf must be the already-computed "YYYY-MM-DD" sleep-date string from the
 * night on screen — stored verbatim with no UTC recomputation.
 */
export async function setNightFeeling(
  nightOf: string,
  tagIds: number[],
): Promise<SetFeelingResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "Unauthenticated" };
  }
  const userId = session.user.id;

  for (const id of tagIds) {
    if (!VALID_FEELING_TAG_IDS.has(id)) {
      return { ok: false, error: `Unknown tag id: ${id}` };
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(dailyFeelingTags)
      .where(
        and(
          eq(dailyFeelingTags.userId, userId),
          eq(dailyFeelingTags.nightOf, nightOf),
        ),
      );

    if (tagIds.length > 0) {
      await tx.insert(dailyFeelingTags).values(
        tagIds.map((tagId) => ({ userId, nightOf, tagId })),
      );
    }
  });

  revalidatePath("/dashboard/sleep");
  return { ok: true };
}
