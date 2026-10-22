import { pgTable, uuid, text, timestamp, integer, real, date, pgEnum, uniqueIndex, index, jsonb, serial, smallint, boolean } from "drizzle-orm/pg-core";
import { primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { AdapterAccountType } from "next-auth/adapters";
import type { ExerciseLogStatus, LoggedExerciseItem, MealSlot, MindsetKind } from "@/lib/today/types";

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

export const dailyFeelingTags = pgTable(
  "daily_feeling_tags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    nightOf: date("night_of").notNull(),
    tagId: integer("tag_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("daily_feeling_tags_user_id_night_of_tag_id_idx").on(t.userId, t.nightOf, t.tagId),
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
    /** Daily step total; nullable until a steps sync has run for the day. */
    steps: integer("steps"),
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
  dailyFeelingTags: many(dailyFeelingTags),
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
  /**
   * Latest local date ("YYYY-MM-DD") up to which synced coverage is
   * contiguous. Unlike last_synced_at (when a sync last ran), this only
   * advances when no older day is missing. Null = not tracked yet.
   */
  syncedThrough: date("synced_through"),
  /** Catch-up step lock: another step may start only after this instant. */
  lockUntil: timestamp("lock_until"),
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

export const dailyFeelingTagsRelations = relations(dailyFeelingTags, ({ one }) => ({
  user: one(users, { fields: [dailyFeelingTags.userId], references: [users.id] }),
}));

// ── Today: plan templates ────────────────────────────────────────────────────

export const exercisePlanItems = pgTable(
  "exercise_plan_items",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekday: smallint("weekday").notNull(),
    position: integer("position").notNull().default(0),
    name: text("name").notNull(),
    /** Free text, e.g. "3×12" or "20 min". */
    details: text("details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("exercise_plan_items_user_id_weekday_idx").on(t.userId, t.weekday)]
);

export const mealPlanItems = pgTable(
  "meal_plan_items",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    weekday: smallint("weekday").notNull(),
    slot: text("slot").$type<MealSlot>().notNull(),
    position: integer("position").notNull().default(0),
    description: text("description").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("meal_plan_items_user_id_weekday_idx").on(t.userId, t.weekday)]
);

/** Backup-workout conditions. Archived, never deleted: logs reference them. */
export const conditions = pgTable("conditions", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  sleepScoreBelow: smallint("sleep_score_below"),
  archived: boolean("archived").notNull().default(false),
});

export const conditionOptions = pgTable("condition_options", {
  id: serial("id").primaryKey(),
  conditionId: integer("condition_id").references(() => conditions.id).notNull(),
  name: text("name").notNull(),
  details: text("details"),
  position: integer("position").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
});

export const mindsetItems = pgTable("mindset_items", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  kind: text("kind").$type<MindsetKind>().notNull(),
  text: text("text").notNull(),
  position: integer("position").notNull().default(0),
});

export const motivationLines = pgTable("motivation_lines", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  text: text("text").notNull(),
  active: boolean("active").notNull().default(true),
});

// ── Today: logs (snapshots of the plan as it was at log time) ────────────────

export const exerciseDayLogs = pgTable(
  "exercise_day_logs",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    date: date("date").notNull(),
    status: text("status").$type<ExerciseLogStatus>().notNull(),
    conditionId: integer("condition_id").references(() => conditions.id),
    conditionNameSnapshot: text("condition_name_snapshot"),
    items: jsonb("items").$type<LoggedExerciseItem[]>().notNull().default([]),
    note: text("note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("exercise_day_logs_user_id_date_idx").on(t.userId, t.date)]
);

export const mealLogs = pgTable(
  "meal_logs",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    date: date("date").notNull(),
    mealPlanItemId: integer("meal_plan_item_id").references(() => mealPlanItems.id, { onDelete: "set null" }),
    slot: text("slot").$type<MealSlot>().notNull(),
    descriptionSnapshot: text("description_snapshot").notNull(),
    followed: boolean("followed").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("meal_logs_user_id_date_meal_plan_item_id_idx").on(t.userId, t.date, t.mealPlanItemId)]
);
