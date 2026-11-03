// Response envelope for every /api/v1 response — a discriminated union on the
// presence of `error`. Pure; no Next imports, so a mobile client can reuse it.

import { formatInstantWithOffset } from "./time";

export const API_VERSION = "1" as const;

export type ApiErrorCode =
  | "unauthorized" // missing/invalid/revoked token
  | "insufficient_scope" // valid token, wrong scope
  | "invalid_parameter" // malformed query parameter
  | "range_too_large" // /days range over the cap
  | "not_found" // unknown route
  | "internal_error";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

export interface ApiSuccess<T> {
  apiVersion: typeof API_VERSION;
  /** Instant the response was produced, ISO 8601 with the server's UTC offset. */
  generatedAt: string;
  /** IANA zone the server's calendar dates ("YYYY-MM-DD") and `generatedAt` offset belong to. */
  timezone: string;
  data: T;
}

export interface ApiFailure {
  apiVersion: typeof API_VERSION;
  error: ApiError;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function isApiFailure<T>(r: ApiResponse<T>): r is ApiFailure {
  return "error" in r;
}

export interface EnvelopeClock {
  nowMs: number;
  /** Server UTC offset at `nowMs`, seconds east of UTC. */
  offsetSeconds: number;
  /** IANA zone name. */
  timezone: string;
}

export function buildSuccess<T>(data: T, clock: EnvelopeClock): ApiSuccess<T> {
  return {
    apiVersion: API_VERSION,
    generatedAt: formatInstantWithOffset(clock.nowMs, clock.offsetSeconds),
    timezone: clock.timezone,
    data,
  };
}

export function buildFailure(code: ApiErrorCode, message: string): ApiFailure {
  return { apiVersion: API_VERSION, error: { code, message } };
}

/** Largest /days range, in calendar days inclusive of both ends. */
export const MAX_RANGE_DAYS = 92;
