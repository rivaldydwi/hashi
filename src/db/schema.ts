// Hashi — database schema (Drizzle ORM)
//
// Semua tabel data tenant punya kolom organization_id dan dilindungi
// Row-Level Security. Policy RLS, fungsi helper, dan role database ada di
// migration SQL manual: drizzle/0001_rls_policies.sql
//
// Setelah mengubah file ini: `npm run db:generate` untuk membuat migration baru.

import {
  bigserial,
  boolean,
  char,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const orgType = pgEnum("org_type", ["PLATFORM", "LPK", "TSK"]);

export const role = pgEnum("role", [
  "SUPER_ADMIN",
  "TSK_ADMIN",
  "TSK_STAFF",
  "LPK_ADMIN",
  "LPK_SENSEI",
]);

export const locale = pgEnum("locale", ["id", "ja"]);

export const gender = pgEnum("gender", ["MALE", "FEMALE"]);

// Urutan tahapan mengikuti spesifikasi MVP.
// "Tidak lulus" bukan tahapan: kandidat kembali ke READY.
export const candidateStage = pgEnum("candidate_stage", [
  "STUDYING", // Belajar
  "READY", // Siap seleksi
  "SHORTLISTED", // Masuk shortlist
  "PASSED_TSK_INTERVIEW", // Lulus wawancara TSK
  "SUBMITTED_TO_CLIENT", // Diajukan ke client
  "PASSED_CLIENT_INTERVIEW", // Lulus interview client
  "DOCUMENT_PROCESS", // Proses dokumen
  "DEPARTED", // Berangkat
  "WITHDRAWN", // Mundur
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: orgType("type").notNull(),
  country: char("country", { length: 2 }).notNull(), // ISO 3166-1: ID / JP
  defaultLocale: locale("default_locale").notNull().default("id"),
  ...timestamps,
});

// Kemitraan LPK <-> TSK. TSK hanya bisa melihat kandidat dari LPK
// yang bermitra aktif dengannya.
export const partnerships = pgTable(
  "partnerships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lpkId: uuid("lpk_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tskId: uuid("tsk_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("partnerships_lpk_tsk_key").on(t.lpkId, t.tskId),
    index("partnerships_tsk_idx").on(t.tskId),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: role("role").notNull(),
    locale: locale("locale").notNull().default("id"),
    active: boolean("active").notNull().default(true),
    // true setelah dibuat/di-reset admin dengan kata sandi sementara
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // sesi (JWT) yang terbit sebelum waktu ini dianggap tidak berlaku lagi
    sessionsRevokedAt: timestamp("sessions_revoked_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    index("users_organization_idx").on(t.organizationId),
  ],
);

// Versi awal. Field profil lengkap ditambahkan di langkah 3 (Profil kandidat).
export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id") // LPK pemilik data
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    nameKatakana: text("name_katakana"),
    gender: gender("gender"),
    birthDate: date("birth_date"),
    field: text("field"), // bidang SSW, mis. "Pengolahan makanan"
    stage: candidateStage("stage").notNull().default("STUDYING"),
    ...timestamps,
  },
  (t) => [index("candidates_org_stage_idx").on(t.organizationId, t.stage)],
);

// Log perubahan data: siapa, kapan, apa (sebelum/sesudah).
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id"),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(), // mis. "auth.login", "candidate.update"
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt)],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  candidates: many(candidates),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
}));

export const candidatesRelations = relations(candidates, ({ one }) => ({
  organization: one(organizations, {
    fields: [candidates.organizationId],
    references: [organizations.id],
  }),
}));

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type CandidateStage = (typeof candidateStage.enumValues)[number];
export type Role = (typeof role.enumValues)[number];
export type Locale = (typeof locale.enumValues)[number];
export type OrgType = (typeof orgType.enumValues)[number];
