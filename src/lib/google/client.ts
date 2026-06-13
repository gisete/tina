import { db } from "@/db/client";
import { accounts } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { eq, and } from "drizzle-orm";
import type {
  GoogleHealthSessionBlock,
  GoogleHealthHeartRateDataPoint,
  GoogleHealthHrvDataPoint,
  GoogleHealthHeartRateSamplePoint,
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

interface FetchHealthOptions {
  /**
   * When true, appends `:reconcile` to the endpoint path. Required for daily
   * telemetry streams (resting HR, HRV) that use the deduplication variant of
   * the dataPoints endpoint.
   */
  reconcile?: boolean;
  /**
   * AIP-160 filter expression. Note: the data type name is snake_case inside
   * the filter even though it's kebab-case in the endpoint path — e.g.
   * `sleep.interval.end_time >= "2026-05-12T00:00:00Z"`.
   */
  filter?: string;
  /** Sleep/exercise sessions are capped at 25 per page by the API. */
  pageSize?: number;
}

/** Safety valve so a bad filter can never loop forever on nextPageToken. */
const MAX_PAGES = 20;

/**
 * Shared fetch helper for any Health Connect v4 data type.
 * Handles the 401 silent-revocation retry and nextPageToken pagination in
 * one place, returning the concatenated dataPoints of every page.
 */
async function fetchHealthDataType(
  userId: string,
  dataType: string,
  options: FetchHealthOptions = {},
): Promise<unknown[]> {
  const suffix = options.reconcile ? "dataPoints:reconcile" : "dataPoints";
  const baseUrl = `https://health.googleapis.com/v4/users/me/dataTypes/${dataType}/${suffix}`;

  const buildUrl = (pageToken?: string) => {
    const params = new URLSearchParams();
    if (options.filter) params.set("filter", options.filter);
    if (options.pageSize) params.set("pageSize", String(options.pageSize));
    if (pageToken) params.set("pageToken", pageToken);
    const qs = params.toString();
    return qs ? `${baseUrl}?${qs}` : baseUrl;
  };

  const doFetch = (token: string, pageToken?: string) =>
    fetch(buildUrl(pageToken), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

  let accessToken = await getGoogleValidClientToken(userId);
  const allPoints: unknown[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    let response = await doFetch(accessToken, pageToken);

    if (response.status === 401) {
      console.log(`[google] 401 on ${dataType}, forcing token refresh...`);
      const account = await db.query.accounts.findFirst({
        where: and(eq(accounts.userId, userId), eq(accounts.provider, "google")),
      });
      if (!account?.refresh_token) throw new Error("No refresh token available.");
      accessToken = await refreshGoogleAccessToken(userId, account.refresh_token);
      response = await doFetch(accessToken, pageToken);
    }

    if (!response.ok) {
      const errorDetails = await response.text();
      throw new Error(`Google Health API error [${dataType}]: ${response.status} - ${errorDetails}`);
    }

    const data = await response.json();
    allPoints.push(...(data.dataPoints ?? []));

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  console.log(`[google] Fetched ${allPoints.length} ${dataType} data points`);
  return allPoints;
}

/** "2026-06-11T22:14:00.000Z" → "2026-06-11" for civil-date filters. */
const civilDate = (iso: string) => iso.split("T")[0];

export async function fetchGoogleSleepData(
  userId: string,
  startTimeISO: string,
  endTimeISO: string
): Promise<GoogleHealthSessionBlock[]> {
  // Filter on the session END so the night in progress at the window start is
  // included. Sleep pages are capped at 25 sessions, hence pagination above.
  const dataPoints = await fetchHealthDataType(userId, "sleep", {
    filter: `sleep.interval.end_time >= "${startTimeISO}" AND sleep.interval.end_time < "${endTimeISO}"`,
    pageSize: 25,
  });

  return dataPoints as GoogleHealthSessionBlock[];
}

/**
 * Fetches daily resting heart rate and HRV RMSSD streams in parallel using
 * the correct Health Connect v4 kebab-case data type identifiers and the
 * `:reconcile` endpoint variant required for daily telemetry aggregates.
 * Daily data types filter on `{type}.date` civil dates, which only support
 * the `>=` and `<` comparators — so the window end is expressed as an
 * exclusive upper bound one civil day after `endTimeISO`.
 */
export async function fetchGoogleHeartData(
  userId: string,
  startTimeISO: string,
  endTimeISO: string
): Promise<{ heartRatePoints: GoogleHealthHeartRateDataPoint[]; hrvPoints: GoogleHealthHrvDataPoint[] }> {
  const from = civilDate(startTimeISO);
  // `<=` is rejected by the daily date filters with a 400; use `< (end + 1 day)`.
  // The +1 is computed on the civil-date string via addDays (never toISOString).
  const toExclusive = addDays(civilDate(endTimeISO), 1);

  const [heartRatePoints, hrvPoints] = await Promise.all([
    fetchHealthDataType(userId, "daily-resting-heart-rate", {
      reconcile: true,
      filter: `daily_resting_heart_rate.date >= "${from}" AND daily_resting_heart_rate.date < "${toExclusive}"`,
    }),
    fetchHealthDataType(userId, "daily-heart-rate-variability", {
      reconcile: true,
      filter: `daily_heart_rate_variability.date >= "${from}" AND daily_heart_rate_variability.date < "${toExclusive}"`,
    }),
  ]);

  return {
    heartRatePoints: heartRatePoints as GoogleHealthHeartRateDataPoint[],
    hrvPoints: hrvPoints as GoogleHealthHrvDataPoint[],
  };
}

/**
 * Fetches intra-day heart rate samples (≈1/min during sleep) for a physical
 * time window — used to chart heart rate across a single night's session.
 * Sample data types filter on `{type}.sample_time.physical_time`.
 */
export async function fetchGoogleHeartRateSamples(
  userId: string,
  startTimeISO: string,
  endTimeISO: string
): Promise<GoogleHealthHeartRateSamplePoint[]> {
  const dataPoints = await fetchHealthDataType(userId, "heart-rate", {
    reconcile: true,
    filter: `heart_rate.sample_time.physical_time >= "${startTimeISO}" AND heart_rate.sample_time.physical_time < "${endTimeISO}"`,
    pageSize: 1000,
  });

  return dataPoints as GoogleHealthHeartRateSamplePoint[];
}
