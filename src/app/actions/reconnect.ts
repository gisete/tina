"use server";

import { signIn } from "@/auth";

/** Restarts the existing Google sign-in (same call as the sign-in page). */
export async function reconnectGoogle(): Promise<void> {
  await signIn("google", { redirectTo: "/dashboard/today" });
}
