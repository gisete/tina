import { pgTable, uuid, text, timestamp, integer, real, date, pgEnum, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";

export const sleepStageEnum = pgEnum("sleep_stage_type", ["deep", "light", "rem", "awake"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sleepSessions = pgTable("sleep_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  sleepDate: date("sleep_date").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  totalSleepMs: integer("total_sleep_ms").notNull(),
  efficiencyScore: real("efficiency_score").notNull(),
  continuityScore: integer("continuity_score"),
  timelineRaw: jsonb("timeline_raw"),
  source: text("source").default("google_health").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("sleep_sessions_user_id_start_time_idx").on(t.userId, t.startTime),
  index("sleep_sessions_user_id_sleep_date_idx").on(t.userId, t.sleepDate),
]);

export const sleepStages = pgTable("sleep_stages", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").references(() => sleepSessions.id, { onDelete: "cascade" }).notNull(),
  stageType: sleepStageEnum("stage_type").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  durationMs: integer("duration_ms").notNull(),
});

export const heartRateSummaries = pgTable(
  "heart_rate_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    date: date("date").notNull(),
    restingHeartRate: integer("resting_heart_rate"),
    hrvRmssd: real("hrv_rmssd"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("heart_rate_summaries_user_id_date_idx").on(t.userId, t.date),
  ]
);

export const heartRateSamples = pgTable(
  "heart_rate_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    timestamp: timestamp("timestamp").notNull(),
    bpm: integer("bpm").notNull(),
  },
  (t) => [
    uniqueIndex("heart_rate_samples_user_id_timestamp_idx").on(t.userId, t.timestamp),
  ]
);

export const dailyActivitySummaries = pgTable(
  "daily_activity_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    activityDate: date("activity_date").notNull(),
    lightMinutes: integer("light_minutes").notNull().default(0),
    moderateMinutes: integer("moderate_minutes").notNull().default(0),
    vigorousMinutes: integer("vigorous_minutes").notNull().default(0),
    peakMinutes: integer("peak_minutes").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("daily_activity_summaries_user_id_date_idx").on(t.userId, t.activityDate),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  sleepSessions: many(sleepSessions),
  heartRateSummaries: many(heartRateSummaries),
  heartRateSamples: many(heartRateSamples),
  dailyActivitySummaries: many(dailyActivitySummaries),
}));

export const heartRateSamplesRelations = relations(heartRateSamples, ({ one }) => ({
  user: one(users, { fields: [heartRateSamples.userId], references: [users.id] }),
}));

export const sleepSessionsRelations = relations(sleepSessions, ({ one, many }) => ({
  user: one(users, { fields: [sleepSessions.userId], references: [users.id] }),
  stages: many(sleepStages),
}));

export const sleepStagesRelations = relations(sleepStages, ({ one }) => ({
  session: one(sleepSessions, { fields: [sleepStages.sessionId], references: [sleepSessions.id] }),
}));

/** Records the last successful Google Health sync timestamp per user. */
export const syncState = pgTable("sync_state", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  lastSyncedAt: timestamp("last_synced_at").notNull(),
});

export const syncStateRelations = relations(syncState, ({ one }) => ({
  user: one(users, { fields: [syncState.userId], references: [users.id] }),
}));

export const accounts = pgTable(
  "account",
  {
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    {
      compoundKey: primaryKey({
        columns: [account.provider, account.providerAccountId],
      }),
    },
  ]
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [
    {
      compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
    },
  ]
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const heartRateSummariesRelations = relations(heartRateSummaries, ({ one }) => ({
  user: one(users, { fields: [heartRateSummaries.userId], references: [users.id] }),
}));

export const dailyActivitySummariesRelations = relations(dailyActivitySummaries, ({ one }) => ({
  user: one(users, { fields: [dailyActivitySummaries.userId], references: [users.id] }),
}));
