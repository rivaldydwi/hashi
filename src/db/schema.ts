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
// Bahasa yang DIKUASAI pengguna (boleh lebih dari satu). Beda dari `locale` (bahasa tampilan, hanya id/ja).
export const language = pgEnum("language", ["id", "ja", "en"]);

export const gender = pgEnum("gender", ["MALE", "FEMALE"]);

// Status kandidat DI LPK. Hanya diisi oleh LPK_ADMIN.
// Keputusan TSK (shortlist, wawancara, dst.) ada di candidate_selections.decision.
export const candidateStage = pgEnum("candidate_stage", [
  "STUDYING", // Belajar
  "READY", // Siap seleksi
  "WITHDRAWN", // Mundur
]);

// Keputusan satu TSK atas satu kandidat (langkah 5 memperluasnya jadi job order & shortlist).
// Urutan mengikuti pipeline di spesifikasi MVP. JANGAN dipakai untuk perbandingan `>=`:
// hak edit TSK ditentukan daftar IN eksplisit (lihat tsk_editable_decision di migration).
export const selectionDecision = pgEnum("selection_decision", [
  "NONE", // belum diputuskan
  "SHORTLISTED", // Masuk shortlist
  "PASSED_TSK_INTERVIEW", // Lulus wawancara TSK
  "SUBMITTED_TO_CLIENT", // Diajukan ke client
  "PASSED_CLIENT_INTERVIEW", // Lulus interview client
  "DOCUMENT_PROCESS", // Proses dokumen
  "DEPARTED", // Berangkat
  "REJECTED", // Ditolak
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

// Siapa yang boleh membaca catatan TSK. TSK_ONLY = hanya TSK pembuat; SHARED_WITH_LPK = LPK_ADMIN
// pemilik kandidat (dari TSK yang masih bermitra aktif) ikut boleh membaca.
export const noteVisibility = pgEnum("note_visibility", ["TSK_ONLY", "SHARED_WITH_LPK"]);

// Jenis penilaian: bulanan oleh LPK (面談 ±30 menit), atau oleh TSK setelah interview / saat berkunjung ke LPK.
export const assessmentKind = pgEnum("assessment_kind", ["LPK_MONTHLY", "TSK_INTERVIEW", "TSK_VISIT"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Bidang kerja (SSW dst.) sebagai tabel master: dipakai kandidat, klien, dan job order. Dikelola super admin.
export const skillFields = pgTable(
  "skill_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(), // kode stabil, tidak bisa diubah (trigger)
    nameId: text("name_id").notNull(),
    nameJa: text("name_ja").notNull(),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("skill_fields_code_key").on(t.code), check("skill_fields_code_check", sql`${t.code} ~ '^[a-z0-9][a-z0-9-]{0,39}$'`)],
);


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
    locale: locale("locale").notNull().default("id"), // preferensi bahasa TAMPILAN (diubah tombol bahasa), bukan bahasa yang dikuasai
    languages: language("languages").array().notNull().default(sql`ARRAY['id']::language[]`), // bahasa yang dikuasai; CHECK: 1+ elemen, tanpa duplikat
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
    check("users_languages_check", sql`language_array_ok(${t.languages})`),
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
    fieldId: uuid("field_id").references(() => skillFields.id, { onDelete: "restrict" }), // bidang kerja (tabel master skill_fields)
    stage: candidateStage("stage").notNull().default("STUDYING"),
    // Tanggal tanda tangan formulir persetujuan siswa. OPSIONAL, hanya catatan; BUKAN gerbang visibilitas.
    dataConsentDate: date("data_consent_date"),
    // Berbagi ke TSK mitra: satu-satunya gerbang visibilitas bagi TSK. Hanya LPK_ADMIN yang mengubahnya.
    // Kolom *_at / *_by diisi trigger database (candidates_share_stamp), tidak dari aplikasi.
    sharedWithTsk: boolean("shared_with_tsk").notNull().default(false),
    sharedWithTskAt: timestamp("shared_with_tsk_at", { withTimezone: true }),
    sharedWithTskBy: uuid("shared_with_tsk_by").references(() => users.id, { onDelete: "set null" }),
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
  (t) => [index("candidates_org_stage_idx").on(t.organizationId, t.stage), index("candidates_field_idx").on(t.fieldId)],
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

// Keputusan TSK atas kandidat (1 baris per pasangan kandidat x TSK). Ditulis HANYA oleh TSK
// pemilik baris; LPK boleh membaca (tanpa catatan). Status LPK (candidates.stage) tidak ikut berubah.
export const candidateSelections = pgTable(
  "candidate_selections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    tskOrgId: uuid("tsk_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    decision: selectionDecision("decision").notNull().default("NONE"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("candidate_selections_candidate_tsk_key").on(t.candidateId, t.tskOrgId),
    index("candidate_selections_tsk_idx").on(t.tskOrgId),
  ],
);

// Catatan TSK atas kandidat (mis. 面談メモ). Default hanya terbaca TSK; TSK boleh membagikannya ke LPK.
// Terpisah dari candidate_selections supaya keputusan bisa dibaca LPK tanpa membuka catatan.
export const candidateNotes = pgTable(
  "candidate_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    tskOrgId: uuid("tsk_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    visibility: noteVisibility("visibility").notNull().default("TSK_ONLY"),
    ...timestamps,
  },
  (t) => [index("candidate_notes_candidate_tsk_idx").on(t.candidateId, t.tskOrgId)],
);

// Penilaian kandidat (評価). LPK_MONTHLY = riwayat penilaian bulanan LPK (satu per kandidat per bulan);
// TSK_INTERVIEW / TSK_VISIT = penilaian TSK. Aturan baca/tulis ada di drizzle/0011_assessments.sql (RLS + trigger).
// period, assessor_id, dan updated_at diisi TRIGGER database (assessor dari app.user_id, tidak bisa dipalsukan);
// candidate_id, org_id, kind, dan assessor_id tidak bisa diganti. Tidak ada DELETE untuk siapa pun.
export const candidateAssessments = pgTable(
  "candidate_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    orgId: uuid("org_id") // organisasi penilai
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: assessmentKind("kind").notNull(),
    assessedOn: date("assessed_on").notNull(), // tidak boleh di masa depan (trigger)
    period: date("period").notNull().default(sql`CURRENT_DATE`), // awal bulan dari assessed_on; DIISI TRIGGER
    assessorId: uuid("assessor_id").references(() => users.id, { onDelete: "set null" }), // DIISI TRIGGER dari app.user_id
    durationMinutes: smallint("duration_minutes").notNull().default(30),
    scoreJapanese: smallint("score_japanese"), // 1..5
    scoreAttitude: smallint("score_attitude"),
    scoreFitness: smallint("score_fitness"), // kebugaran (bukan data medis)
    scoreMotivation: smallint("score_motivation"),
    attendancePct: smallint("attendance_pct"), // 0..100
    testName: text("test_name"), // mis. tryout JLPT / JFT
    testScore: integer("test_score"),
    note: text("note"),
    followUp: text("follow_up"),
    // Hanya bermakna untuk penilaian milik TSK (LPK_MONTHLY selalu TSK_ONLY)
    visibility: noteVisibility("visibility").notNull().default("TSK_ONLY"),
    ...timestamps,
  },
  (t) => [
    index("candidate_assessments_candidate_idx").on(t.candidateId, t.period),
    uniqueIndex("candidate_assessments_lpk_month_key").on(t.candidateId, t.period).where(sql`${t.kind} = 'LPK_MONTHLY'`),
    check("candidate_assessments_scores_check", sql`(${t.scoreJapanese} is null or ${t.scoreJapanese} between 1 and 5) and (${t.scoreAttitude} is null or ${t.scoreAttitude} between 1 and 5) and (${t.scoreFitness} is null or ${t.scoreFitness} between 1 and 5) and (${t.scoreMotivation} is null or ${t.scoreMotivation} between 1 and 5)`),
    check("candidate_assessments_attendance_check", sql`${t.attendancePct} is null or ${t.attendancePct} between 0 and 100`),
    check("candidate_assessments_duration_check", sql`${t.durationMinutes} between 1 and 480`),
    check("candidate_assessments_test_score_check", sql`${t.testScore} is null or ${t.testScore} >= 0`),
    check("candidate_assessments_visibility_check", sql`${t.kind} <> 'LPK_MONTHLY' or ${t.visibility} = 'TSK_ONLY'`),
  ],
);

// Log perubahan data: siapa, kapan, apa (sebelum/sesudah).
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Organisasi tempat log ini "disimpan". Untuk perubahan kandidat = LPK pemilik kandidat,
    // sehingga LPK ikut melihat perubahan yang dilakukan TSK mitranya.
    organizationId: uuid("organization_id"),
    actorUserId: uuid("actor_user_id"),
    // Organisasi si pelaku (LPK atau TSK). Null hanya untuk log lama sebelum kolom ini ada.
    actorOrgId: uuid("actor_org_id"),
    candidateId: uuid("candidate_id"), // diisi untuk log yang menyangkut kandidat
    action: text("action").notNull(), // mis. "auth.login", "candidate.update"
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_actor_org_created_idx").on(t.actorOrgId, t.createdAt),
    index("audit_logs_candidate_created_idx").on(t.candidateId, t.createdAt),
  ],
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
  selections: many(candidateSelections),
  notes: many(candidateNotes),
  assessments: many(candidateAssessments),
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
export type CandidateSelection = typeof candidateSelections.$inferSelect;
export type CandidateAssessment = typeof candidateAssessments.$inferSelect;
export type AssessmentKind = (typeof assessmentKind.enumValues)[number];
export type CandidateNote = typeof candidateNotes.$inferSelect;
export type NoteVisibility = (typeof noteVisibility.enumValues)[number];
export type SelectionDecision = (typeof selectionDecision.enumValues)[number];
export type DocumentType = (typeof documentType.enumValues)[number];
export type CandidateStage = (typeof candidateStage.enumValues)[number];
export type Role = (typeof role.enumValues)[number];
export type Locale = (typeof locale.enumValues)[number];
export type Language = (typeof language.enumValues)[number];
export type OrgType = (typeof orgType.enumValues)[number];
