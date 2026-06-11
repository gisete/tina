import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type {
  GoogleHealthSessionBlock,
  GoogleHealthHeartRateDataPoint,
  GoogleHealthHrvDataPoint,
} from "./normalizers";

async function refreshGoogleAccessToken(userId: string, refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const tokens = await response.json();
  if (!response.ok) throw new Error(`Token refresh failed: ${JSON.stringify(tokens)}`);

  const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

  // Update token cache inside our remote mini PC database
  await db
    .update(accounts)
    .set({
      access_token: tokens.access_token,
      expires_at: expiresAt,
    })
    .where(
      and(
        eq(accounts.userId, userId),
        eq(accounts.provider, "google")
      )
    );

  return tokens.access_token;
}

export async function getGoogleValidClientToken(userId: string): Promise<string> {
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "google")),
  });

  if (!account || !account.refresh_token) {
    throw new Error("User does not have a linked Google Account session.");
  }

  const isExpired = account.expires_at ? Math.floor(Date.now() / 1000) >= account.expires_at : true;

  if (isExpired) {
    return refreshGoogleAccessToken(userId, account.refresh_token);
  }

  return account.access_token!;
}

/**
 * Shared fetch helper for any Health Connect v4 data type.
 * Handles the 401 silent-revocation retry pattern in one place.
 *
 * @param reconcile - When true, appends `:reconcile` to the endpoint path.
 *   Required for daily telemetry streams (resting HR, HRV) that use the
 *   deduplication variant of the dataPoints endpoint.
 */
async function fetchHealthDataType(
  userId: string,
  dataType: string,
  reconcile = false,
): Promise<unknown[]> {
  const suffix = reconcile ? "dataPoints:reconcile" : "dataPoints";
  const url = `https://health.googleapis.com/v4/users/me/dataTypes/${dataType}/${suffix}`;

  const doFetch = (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });

  let accessToken = await getGoogleValidClientToken(userId);
  let response = await doFetch(accessToken);

  if (response.status === 401) {
    console.log(`[google] 401 on ${dataType}, forcing token refresh...`);
    const account = await db.query.accounts.findFirst({
      where: and(eq(accounts.userId, userId), eq(accounts.provider, "google")),
    });
    if (!account?.refresh_token) throw new Error("No refresh token available.");
    accessToken = await refreshGoogleAccessToken(userId, account.refresh_token);
    response = await doFetch(accessToken);
  }

  if (!response.ok) {
    const errorDetails = await response.text();
    throw new Error(`Google Health API error [${dataType}]: ${response.status} - ${errorDetails}`);
  }

  const data = await response.json();
  return data.dataPoints ?? [];
}

export async function fetchGoogleSleepData(
  userId: string,
  _startTimeISO: string,
  _endTimeISO: string
): Promise<GoogleHealthSessionBlock[]> {
  const dataPoints = await fetchHealthDataType(userId, "sleep");

  // Log the raw payload to the terminal so we can audit the real structure Google returns
  console.log("--- GOOGLE HEALTH SLEEP RAW DATA DISCOVERY ---");
  console.log(JSON.stringify(dataPoints, null, 2));

  return dataPoints as GoogleHealthSessionBlock[];
}

/**
 * Fetches daily resting heart rate and HRV RMSSD streams in parallel using
 * the correct Health Connect v4 kebab-case data type identifiers and the
 * `:reconcile` endpoint variant required for daily telemetry aggregates.
 */
export async function fetchGoogleHeartData(
  userId: string,
  _startTimeISO: string,
  _endTimeISO: string
): Promise<{ heartRatePoints: GoogleHealthHeartRateDataPoint[]; hrvPoints: GoogleHealthHrvDataPoint[] }> {
  const [heartRatePoints, hrvPoints] = await Promise.all([
    fetchHealthDataType(userId, "daily-resting-heart-rate", true),
    fetchHealthDataType(userId, "daily-heart-rate-variability", true),
  ]);

  return {
    heartRatePoints: heartRatePoints as GoogleHealthHeartRateDataPoint[],
    hrvPoints: hrvPoints as GoogleHealthHrvDataPoint[],
  };
}
