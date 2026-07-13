// Drizzle-схема (типізація запитів). Джерело правди для БД — SQL-міграції у ./migrations
// (CHECK-обмеження, часткові унікальні індекси, COLLATE NOCASE та вторинні індекси живуть
// ТАМ, не тут). `drizzle-kit generate` навмисно вимкнено — не регенерувати з цієї схеми.
import { sql } from "drizzle-orm";
import { sqliteTable, integer, text, primaryKey } from "drizzle-orm/sqlite-core";
import type { Sheet } from "../../shared/spots";

const now = sql`(datetime('now'))`;
const today = sql`(date('now'))`;

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "viewer"] }).notNull().default("admin"),
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled").notNull().default(0),
  lastTotpStep: integer("last_totp_step"),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: text("locked_until"),
  isActive: integer("is_active").notNull().default(1),
  mustChangePw: integer("must_change_pw").notNull().default(1),
  createdAt: text("created_at").notNull().default(now),
});

export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.codeHash] })],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(now),
  expiresAt: text("expires_at").notNull(),
  lastSeenAt: text("last_seen_at"),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const pendingAuth = sqliteTable("pending_auth", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  stage: text("stage", { enum: ["enroll", "totp"] }).notNull(),
  totpFails: integer("totp_fails").notNull().default(0),
  createdAt: text("created_at").notNull().default(now),
  expiresAt: text("expires_at").notNull(),
});

export const owners = sqliteTable("owners", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  phone2: text("phone2"),
  email: text("email"),
  comment: text("comment"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at"),
});

export const spots = sqliteTable("spots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  number: text("number").notNull().unique(),
  sheet: integer("sheet").$type<Sheet>().notNull(),
  section: text("section", { enum: ["А", "Б", "В", "Г"] }).notNull(),
  svgId: text("svg_id").unique(),
  plate: text("plate"),
  carMake: text("car_make"),
  carModel: text("car_model"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at"),
});

export const spotOwners = sqliteTable("spot_owners", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spotId: integer("spot_id")
    .notNull()
    .references(() => spots.id, { onDelete: "cascade" }),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => owners.id, { onDelete: "restrict" }),
  isPrimary: integer("is_primary").notNull().default(1),
  startedAt: text("started_at").notNull().default(today),
  endedAt: text("ended_at"),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  description: text("description"),
  totalKop: integer("total_kop").notNull().default(0),
  status: text("status", { enum: ["draft", "active", "completed", "archived"] })
    .notNull()
    .default("draft"),
  cancelled: integer("cancelled").notNull().default(0),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(now),
  activatedAt: text("activated_at"),
  completedAt: text("completed_at"),
  archivedAt: text("archived_at"),
});

export const projectSpots = sqliteTable(
  "project_spots",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    spotId: integer("spot_id")
      .notNull()
      .references(() => spots.id, { onDelete: "restrict" }),
    shareKop: integer("share_kop").notNull().default(0),
    paidKop: integer("paid_kop").notNull().default(0),
    paidAt: text("paid_at"),
    paidMarkedBy: integer("paid_marked_by").references(() => users.id, { onDelete: "set null" }),
    paymentMethod: text("payment_method", { enum: ["cash", "transfer", "other"] }),
    paymentNote: text("payment_note"),
    addedAt: text("added_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.spotId] })],
);

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spotId: integer("spot_id")
    .notNull()
    .references(() => spots.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["manual", "project_auto"] }).notNull().default("manual"),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at"),
});

export const techArticles = sqliteTable("tech_articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: text("at").notNull().default(now),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  payload: text("payload"),
  ip: text("ip"),
});

// ─── Типи для застосунку ───────────────────────────────────────
export type User = typeof users.$inferSelect;
export type Owner = typeof owners.$inferSelect;
export type Spot = typeof spots.$inferSelect;
export type SpotOwner = typeof spotOwners.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectSpot = typeof projectSpots.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type TechArticle = typeof techArticles.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
