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
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

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

export const maritalStatus = pgEnum("marital_status", ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]);

export const dominantHand = pgEnum("dominant_hand", ["RIGHT", "LEFT", "BOTH"]);

export const familyRelation = pgEnum("family_relation", [
  "FATHER",
  "MOTHER",
  "SPOUSE",
  "CHILD",
  "SIBLING",
  "GUARDIAN",
  "RELATIVE_IN_JAPAN", // kerabat yang tinggal di Jepang
  "OTHER",
]);

export const certificateType = pgEnum("certificate_type", ["JFT_BASIC", "JLPT", "SKILL_TEST"]);

// Jenis dokumen mengikuti daftar "Dokumen siswa" di dokumen kebutuhan.
export const documentType = pgEnum("document_type", [
  "PHOTO", // pas foto ukuran visa
  "KTP",
  "FAMILY_CARD", // Kartu Keluarga
  "BIRTH_CERTIFICATE",
  "DIPLOMA", // ijazah terakhir
  "GUARDIAN_CONSENT", // surat izin orang tua / suami / istri / wali
  "PASSPORT_RECOMMENDATION", // rekomendasi paspor dari Disnaker
  "PASSPORT",
  "SKCK",
  "MEDICAL_CHECKUP",
  "TRAINING_CERTIFICATE", // sertifikat pelatihan dari LPK
  "IPKOL_REGISTRATION",
  "SISKOP2MI_REGISTRATION",
  "EMPLOYMENT_CONTRACT",
  "BPJS",
  "OPP_CERTIFICATE", // Orientasi Pra Pemberangkatan
  "MIGRANT_WORKER_CARD", // E-PMI / KTKLN
  "VISA",
  "DATA_CONSENT_FORM", // formulir persetujuan berbagi data
  "OTHER",
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

// Profil dasar kandidat: boleh dilihat semua peran yang bisa melihat kandidat
// (termasuk sensei). Data sensitif ada di `candidate_private`.
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
    birthPlace: text("birth_place"),
    maritalStatus: maritalStatus("marital_status"),
    field: text("field"), // bidang SSW, mis. "Pengolahan makanan"
    stage: candidateStage("stage").notNull().default("STUDYING"),
    // Persetujuan berbagi data ke TSK (diambil saat siswa mendaftar).
    // Trigger database: tanpa tanggal ini, kandidat tidak bisa keluar dari STUDYING.
    dataConsentDate: date("data_consent_date"),
    // Fisik (bukan data kesehatan; penglihatan & buta warna ada di candidate_private)
    heightCm: smallint("height_cm"),
    weightKg: smallint("weight_kg"),
    dominantHand: dominantHand("dominant_hand"),
    // Riwayat Jepang
    everInJapan: boolean("ever_in_japan").notNull().default(false),
    japanHistoryNote: text("japan_history_note"),
    visaRejectedBefore: boolean("visa_rejected_before").notNull().default(false),
    // Pribadi
    motivation: text("motivation"),
    selfPr: text("self_pr"), // 自己PR
    hobby: text("hobby"),
    specialSkill: text("special_skill"),
    ...timestamps,
  },
  (t) => [index("candidates_org_stage_idx").on(t.organizationId, t.stage)],
);

// Data sensitif kandidat (1 baris per kandidat). Sensei TIDAK bisa membacanya;
// aturan aksesnya ada di drizzle/0005_candidate_profile_rls.sql.
export const candidatePrivate = pgTable("candidate_private", {
  candidateId: uuid("candidate_id")
    .primaryKey()
    .references(() => candidates.id, { onDelete: "cascade" }),
  nationalId: text("national_id"), // NIK
  familyCardNumber: text("family_card_number"), // no. Kartu Keluarga
  passportNumber: text("passport_number"),
  passportIssuedDate: date("passport_issued_date"),
  passportExpiryDate: date("passport_expiry_date"),
  address: text("address"),
  phone: text("phone"),
  whatsapp: text("whatsapp"),
  email: text("email"),
  visionNote: text("vision_note"),
  colorBlind: boolean("color_blind").notNull().default(false),
  medicalNote: text("medical_note"), // ringkasan hasil medical check-up
  ...timestamps,
});

export const candidateEducations = pgTable(
  "candidate_educations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    schoolName: text("school_name").notNull(),
    major: text("major"),
    startYear: smallint("start_year"),
    endYear: smallint("end_year"),
    ...timestamps,
  },
  (t) => [index("candidate_educations_candidate_idx").on(t.candidateId)],
);

export const candidateWorkHistories = pgTable(
  "candidate_work_histories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    companyName: text("company_name").notNull(),
    position: text("position"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    ...timestamps,
  },
  (t) => [index("candidate_work_histories_candidate_idx").on(t.candidateId)],
);

// Memuat kontak keluarga, jadi diperlakukan sebagai data sensitif (sensei tidak bisa membaca).
export const candidateFamilyMembers = pgTable(
  "candidate_family_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    relation: familyRelation("relation").notNull(),
    name: text("name").notNull(),
    occupation: text("occupation"),
    phone: text("phone"),
    address: text("address"),
    livesInJapan: boolean("lives_in_japan").notNull().default(false),
    isEmergencyContact: boolean("is_emergency_contact").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("candidate_family_members_candidate_idx").on(t.candidateId)],
);

export const candidateCertificates = pgTable(
  "candidate_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    type: certificateType("type").notNull(),
    levelOrField: text("level_or_field"), // level JLPT (N4) atau bidang ujian skill SSW
    score: integer("score"),
    certificateNumber: text("certificate_number"),
    issuedDate: date("issued_date"),
    ...timestamps,
  },
  (t) => [index("candidate_certificates_candidate_idx").on(t.candidateId)],
);

// Metadata dokumen. Isi file disimpan di disk dengan nama = id (bukan nama asli dari user).
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

export const candidateDocuments = pgTable(
  "candidate_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    type: documentType("type").notNull(),
    originalFilename: text("original_filename").notNull(), // hanya untuk tampilan
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    issuedDate: date("issued_date"),
    expiryDate: date("expiry_date"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("candidate_documents_candidate_idx").on(t.candidateId),
    index("candidate_documents_expiry_idx").on(t.expiryDate).where(sql`${t.expiryDate} is not null`),
    check("candidate_documents_mime_check", sql`${t.mimeType} in ('application/pdf', 'image/jpeg', 'image/png')`),
    check("candidate_documents_size_check", sql`${t.sizeBytes} between 1 and ${sql.raw(String(MAX_DOCUMENT_BYTES))}`),
  ],
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

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [candidates.organizationId],
    references: [organizations.id],
  }),
  private: one(candidatePrivate, {
    fields: [candidates.id],
    references: [candidatePrivate.candidateId],
  }),
  educations: many(candidateEducations),
  workHistories: many(candidateWorkHistories),
  familyMembers: many(candidateFamilyMembers),
  certificates: many(candidateCertificates),
  documents: many(candidateDocuments),
}));

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type CandidatePrivate = typeof candidatePrivate.$inferSelect;
export type CandidateEducation = typeof candidateEducations.$inferSelect;
export type CandidateWorkHistory = typeof candidateWorkHistories.$inferSelect;
export type CandidateFamilyMember = typeof candidateFamilyMembers.$inferSelect;
export type CandidateCertificate = typeof candidateCertificates.$inferSelect;
export type CandidateDocument = typeof candidateDocuments.$inferSelect;
export type DocumentType = (typeof documentType.enumValues)[number];
export type CandidateStage = (typeof candidateStage.enumValues)[number];
export type Role = (typeof role.enumValues)[number];
export type Locale = (typeof locale.enumValues)[number];
export type OrgType = (typeof orgType.enumValues)[number];
