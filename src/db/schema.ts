// Hashi — database schema (Drizzle ORM)
//
// Semua tabel data tenant punya kolom organization_id dan dilindungi
// Row-Level Security. Policy RLS, fungsi helper, dan role database ada di
// migration SQL manual: drizzle/0001_rls_policies.sql
//
// Setelah mengubah file ini: `npm run db:generate` untuk membuat migration baru.

import {
  type AnyPgColumn,
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
  pgView,
  primaryKey,
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

// Jenis program penempatan. SSW = 特定技能; TITP = 技能実習 / 育成就労; OTHER = lainnya.
export const jobProgram = pgEnum("job_program", ["SSW", "TITP", "OTHER"]);
export const jobOrderStatus = pgEnum("job_order_status", ["OPEN", "FILLED", "CLOSED"]);
export const placementStatus = pgEnum("placement_status", ["ACTIVE", "ENDED"]);

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
  // Zona waktu IANA organisasi: dipakai menampilkan waktu riwayat aktivitas dan tanggal di bilah atas (LPK Indonesia: Asia/Jakarta, TSK: Asia/Tokyo).
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
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
    // Job order yang dituju. NULL = keputusan umum atas kandidat (satu baris per kandidat × TSK). Keputusan
    // PASSED_CLIENT_INTERVIEW, DOCUMENT_PROCESS, DEPARTED WAJIB punya job order (CHECK di migration 0017).
    jobOrderId: uuid("job_order_id").references((): AnyPgColumn => jobOrders.id, { onDelete: "restrict" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Satu baris per (kandidat, TSK, job order); NULL dianggap sama (NULLS NOT DISTINCT, ditulis di migration 0017)
    uniqueIndex("candidate_selections_candidate_tsk_jo_key").on(t.candidateId, t.tskOrgId, t.jobOrderId),
    index("candidate_selections_tsk_idx").on(t.tskOrgId),
    index("candidate_selections_job_order_idx").on(t.jobOrderId),
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

// ---------------------------------------------------------------------------------------------
// Klien (配属先) milik TSK: perusahaan (法人) -> lokasi kerja (事業所) -> PIC. Semua baris punya org_id = organisasi TSK pemilik;
// LPK tidak bisa melihatnya sama sekali (RLS). Lihat drizzle/0016_clients.sql.
// ---------------------------------------------------------------------------------------------
export const clientCompanies = pgTable(
  "client_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id") // organisasi TSK pemilik
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // nama 法人 (Jepang)
    nameAlt: text("name_alt"), // nama alternatif / romaji
    corporateNumber: text("corporate_number"), // 法人番号 (13 digit), opsional
    hqAddress: text("hq_address"),
    phone: text("phone"),
    note: text("note"), // catatan INTERNAL TSK (tidak pernah ikut versi "dibagikan")
    // Informasi untuk lembar profil klien (langkah 6; migration 0021), semuanya opsional
    industry: text("industry"), // 業種 / 施設種別
    employeeCount: integer("employee_count"), // 従業員数
    foreignWorkerExperience: text("foreign_worker_experience"), // 外国人受入れ実績
    publicIntro: text("public_intro"), // 紹介文 (ikut versi yang dibagikan)
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("client_companies_org_name_idx").on(t.orgId, t.name),
    check("client_companies_corporate_number_check", sql`${t.corporateNumber} is null or ${t.corporateNumber} ~ '^[0-9]{13}$'`),
    check("client_companies_employee_count_check", sql`${t.employeeCount} is null or ${t.employeeCount} >= 0`),
  ],
);

export const clientSites = pgTable(
  "client_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => clientCompanies.id, { onDelete: "cascade" }),
    name: text("name").notNull(), // nama lokasi (事業所)
    address: text("address"),
    phone: text("phone"),
    accessNote: text("access_note"), // 最寄り駅・アクセス (langkah 6)
    note: text("note"), // catatan INTERNAL
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("client_sites_company_idx").on(t.companyId), index("client_sites_org_idx").on(t.orgId)],
);

// PIC lokasi (boleh lebih dari satu). Nama dan telepon PIC TIDAK PERNAH masuk audit.
export const clientSiteContacts = pgTable(
  "client_site_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => clientSites.id, { onDelete: "cascade" }),
    roleTitle: text("role_title"), // mis. 管理者, 施設長
    name: text("name").notNull(),
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("client_site_contacts_site_idx").on(t.siteId)],
);

// Bidang kerja yang diterima lokasi (banyak ke banyak).
export const clientSiteFields = pgTable(
  "client_site_fields",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => clientSites.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => skillFields.id, { onDelete: "restrict" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.fieldId] }), index("client_site_fields_field_idx").on(t.fieldId)],
);

// ---------------------------------------------------------------------------------------------
// Job order (求人) dan penempatan (配属). Milik TSK (org_id); LPK tidak melihatnya. Lihat drizzle/0017_job_orders.sql.
// ---------------------------------------------------------------------------------------------
export const jobOrders = pgTable(
  "job_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id") // lokasi kerja; tidak bisa diganti setelah dibuat
      .notNull()
      .references(() => clientSites.id, { onDelete: "restrict" }),
    fieldId: uuid("field_id") // harus termasuk bidang yang diterima lokasi (trigger)
      .notNull()
      .references(() => skillFields.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    positions: smallint("positions").notNull().default(1),
    program: jobProgram("program").notNull().default("SSW"),
    description: text("description"), // 業務内容
    salaryNote: text("salary_note"), // 手当・昇給などの補足 (teks bebas)
    monthlySalary: integer("monthly_salary"), // 基本給 bulanan (yen), opsional
    workPlace: text("work_place"),
    // Kondisi kerja untuk lembar job order (langkah 6; migration 0021), semuanya opsional
    workHours: text("work_hours"), // 勤務時間
    daysOff: text("days_off"), // 休日・休暇
    housing: text("housing"), // provided | allowance | none | unspecified (CHECK)
    housingNote: text("housing_note"),
    commuteNote: text("commute_note"), // 通勤
    benefitsNote: text("benefits_note"), // 福利厚生
    minJlpt: text("min_jlpt"), // N5..N1, opsional (N4 = N4 atau lebih tinggi)
    jftRequired: boolean("jft_required").notNull().default(false), // wajib JFT-Basic lulus (skor >= 200)
    genderRequirement: gender("gender_requirement"),
    targetStartDate: date("target_start_date"),
    applicationDeadline: date("application_deadline"),
    status: jobOrderStatus("status").notNull().default("OPEN"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    index("job_orders_org_status_idx").on(t.orgId, t.status),
    index("job_orders_site_idx").on(t.siteId),
    index("job_orders_field_idx").on(t.fieldId),
    check("job_orders_positions_check", sql`${t.positions} between 1 and 1000`),
    check("job_orders_salary_check", sql`${t.monthlySalary} is null or ${t.monthlySalary} >= 0`),
    check("job_orders_min_jlpt_check", sql`${t.minJlpt} is null or ${t.minJlpt} in ('N5', 'N4', 'N3', 'N2', 'N1')`),
    check("job_orders_housing_check", sql`${t.housing} is null or ${t.housing} in ('provided', 'allowance', 'none', 'unspecified')`),
  ],
);

// Penempatan aktif pekerja (dibuat otomatis saat keputusan menjadi DEPARTED). Satu kandidat hanya satu ACTIVE.
export const placements = pgTable(
  "placements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => clientSites.id, { onDelete: "restrict" }),
    jobOrderId: uuid("job_order_id").references(() => jobOrders.id, { onDelete: "restrict" }),
    startDate: date("start_date").notNull(), // 就労開始日
    endDate: date("end_date"),
    status: placementStatus("status").notNull().default("ACTIVE"),
    note: text("note"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("placements_one_active_key").on(t.candidateId).where(sql`${t.status} = 'ACTIVE'`),
    index("placements_org_idx").on(t.orgId),
    index("placements_site_idx").on(t.siteId),
    check("placements_dates_check", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check("placements_ended_check", sql`${t.status} = 'ACTIVE' or ${t.endDate} is not null`),
  ],
);

// Keputusan paling maju per (kandidat, TSK): dipakai daftar kandidat dan sisi LPK (LPK tidak melihat job order). VIEW security_invoker.
export const candidateHeadlineDecision = pgView("candidate_headline_decision", {
  candidateId: uuid("candidate_id").notNull(),
  tskOrgId: uuid("tsk_org_id").notNull(),
  decision: selectionDecision("decision").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
}).existing();

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
    // Potret pelaku saat kejadian (tidak berubah walau pengguna kemudian diganti nama/dihapus). actor_name KOSONG untuk entri lintas organisasi
    // (TSK mengubah kandidat LPK): LPK hanya melihat NAMA ORGANISASI pelaku, bukan nama stafnya.
    actorName: text("actor_name"),
    actorRole: text("actor_role"),
    actorOrgName: text("actor_org_name"),
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
export type JobOrderStatus = (typeof jobOrderStatus.enumValues)[number];
export type PlacementStatus = (typeof placementStatus.enumValues)[number];
export type OrgType = (typeof orgType.enumValues)[number];

// ---------------------------------------------------------------------------------------------
// Tata letak dashboard per pengguna (urutan, ukuran, sembunyikan widget). Milik sendiri: hanya baris user itu yang terlihat
// (RLS, drizzle/0018_dashboard_layouts.sql). Bukan data kandidat dan sengaja TIDAK diaudit (preferensi tampilan).
// Bentuk `layout` divalidasi aplikasi (src/db/dashboard-layout.ts) dan dibatasi ukurannya oleh CHECK.
// ---------------------------------------------------------------------------------------------
export const userDashboardLayouts = pgTable("user_dashboard_layouts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  layout: jsonb("layout").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// =====================================================================================================================
// Catatan kegiatan TSK (langkah 7A): 業務記録 (daily_work), 議事録・面談記録 (meeting), 時系列 (kasus), 定期面談 (periodic_interviews).
// Khusus TSK_ADMIN/TSK_STAFF organisasi pemilik (RLS, drizzle/0020_activity_records.sql). Semua staf TSK membaca semua catatan.
// TIDAK ADA penghapusan: salah = status 'void' + alasan. Kunci asing ke candidates RESTRICT. Riwayat edit di activity_revisions
// (append-only, ditulis TRIGGER). Enum dibuat sebagai text + CHECK supaya mudah diperluas.
// =====================================================================================================================
const actBase = {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").notNull().references(() => users.id),
};

export const activityCases = pgTable(
  "activity_cases",
  {
    ...actBase,
    code: text("code").notNull(), // K-2026-0001, diisi trigger (berurutan per organisasi per tahun)
    title: text("title").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: uuid("closed_by").references(() => users.id),
    versionNo: integer("version_no").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("activity_cases_code_key").on(t.organizationId, t.code),
    index("activity_cases_org_status_idx").on(t.organizationId, t.status),
    check("activity_cases_category_check", sql`${t.category} in ('trouble','resignation','workplace_change','hospital','residence','life_consultation','other')`),
    check("activity_cases_status_check", sql`${t.status} in ('open','closed')`),
  ],
);

export const activityCaseSubjects = pgTable(
  "activity_case_subjects",
  {
    caseId: uuid("case_id").notNull().references(() => activityCases.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.caseId, t.candidateId] }), index("activity_case_subjects_candidate_idx").on(t.candidateId)],
);

export const activityRecords = pgTable(
  "activity_records",
  {
    ...actBase,
    kind: text("kind").notNull(), // daily_work (①) | meeting (②)
    recordDate: date("record_date").notNull(),
    authorId: uuid("author_id").notNull().references(() => users.id),
    caseId: uuid("case_id").references(() => activityCases.id),
    clientSiteId: uuid("client_site_id").references(() => clientSites.id, { onDelete: "restrict" }),
    // "Lanjutkan catatan" (T-007): catatan asal; hanya diisi saat dibuat (terkunci), org sama, asal aktif, dan menyebut pekerja yang sama (trigger, migration 0022)
    continuesRecordId: uuid("continues_record_id").references((): AnyPgColumn => activityRecords.id),
    status: text("status").notNull().default("active"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    versionNo: integer("version_no").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
    // ① 業務記録
    workType: text("work_type"),
    workTypeOther: text("work_type_other"),
    actionTaken: text("action_taken"),
    result: text("result"),
    pending: text("pending"),
    nextAction: text("next_action"),
    reportToText: text("report_to_text"),
    note: text("note"),
    // ② 議事録・面談記録
    subject: text("subject"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    method: text("method"),
    counterparty: text("counterparty"),
    clientCompanyId: uuid("client_company_id").references(() => clientCompanies.id, { onDelete: "restrict" }),
    sections: jsonb("sections"),
  },
  (t) => [
    index("activity_records_org_date_idx").on(t.organizationId, t.recordDate),
    index("activity_records_author_date_idx").on(t.authorId, t.recordDate),
    index("activity_records_case_idx").on(t.caseId),
    index("activity_records_continues_idx").on(t.continuesRecordId),
    check("activity_records_not_self_check", sql`${t.continuesRecordId} is null or ${t.continuesRecordId} <> ${t.id}`),
    check("activity_records_kind_check", sql`${t.kind} in ('daily_work','meeting')`),
    check("activity_records_status_check", sql`${t.status} in ('active','void')`),
    check("activity_records_void_check", sql`${t.status} = 'active' or (${t.voidReason} is not null and length(btrim(${t.voidReason})) > 0)`),
    check("activity_records_work_type_check", sql`${t.workType} is null or ${t.workType} in ('interview','consultation','residence_card','hospital_visit','other')`),
    check("activity_records_method_check", sql`${t.method} is null or ${t.method} in ('phone','online','visit','in_person')`),
    check("activity_records_counterparty_check", sql`${t.counterparty} is null or ${t.counterparty} in ('client','worker','other')`),
    // kolom khusus ① hanya untuk daily_work, kolom khusus ② hanya untuk meeting
    check(
      "activity_records_daily_only_check",
      sql`${t.kind} = 'daily_work' or (${t.workType} is null and ${t.workTypeOther} is null and ${t.actionTaken} is null and ${t.result} is null and ${t.pending} is null and ${t.nextAction} is null and ${t.reportToText} is null and ${t.note} is null)`,
    ),
    check(
      "activity_records_meeting_only_check",
      sql`${t.kind} = 'meeting' or (${t.subject} is null and ${t.startedAt} is null and ${t.endedAt} is null and ${t.method} is null and ${t.counterparty} is null and ${t.clientCompanyId} is null and ${t.sections} is null)`,
    ),
    check("activity_records_meeting_required_check", sql`${t.kind} <> 'meeting' or (${t.subject} is not null and ${t.startedAt} is not null)`),
    check("activity_records_times_check", sql`${t.endedAt} is null or ${t.startedAt} is null or ${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const activityRecordSubjects = pgTable(
  "activity_record_subjects",
  {
    recordId: uuid("record_id").notNull().references(() => activityRecords.id),
    candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.candidateId] }), index("activity_record_subjects_candidate_idx").on(t.candidateId)],
);

export const activityRecordHandlers = pgTable(
  "activity_record_handlers",
  {
    recordId: uuid("record_id").notNull().references(() => activityRecords.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.userId] })],
);

export const activityRecordRecipients = pgTable(
  "activity_record_recipients",
  {
    recordId: uuid("record_id").notNull().references(() => activityRecords.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.userId] }), index("activity_record_recipients_user_idx").on(t.userId)],
);

// Tanda "sudah dibaca" (data fitur, TIDAK diaudit). Satu baris per user per catatan; hanya user itu yang menulisnya.
export const activityRecordReads = pgTable(
  "activity_record_reads",
  {
    recordId: uuid("record_id").notNull().references(() => activityRecords.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
    versionNoRead: integer("version_no_read").notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordId, t.userId] })],
);

export const activityDailyReports = pgTable(
  "activity_daily_reports",
  {
    ...actBase,
    authorId: uuid("author_id").notNull().references(() => users.id),
    reportDate: date("report_date").notNull(),
    sharedAt: timestamp("shared_at", { withTimezone: true }),
    sharedBy: uuid("shared_by").references(() => users.id),
  },
  (t) => [uniqueIndex("activity_daily_reports_author_date_key").on(t.authorId, t.reportDate), index("activity_daily_reports_org_date_idx").on(t.organizationId, t.reportDate)],
);

export const activityDailyReportRecipients = pgTable(
  "activity_daily_report_recipients",
  {
    reportId: uuid("report_id").notNull().references(() => activityDailyReports.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }),
    readSharedAt: timestamp("read_shared_at", { withTimezone: true }), // shared_at laporan saat dibaca (untuk penanda "diperbarui sejak kamu baca")
  },
  (t) => [primaryKey({ columns: [t.reportId, t.userId] }), index("activity_daily_report_recipients_user_idx").on(t.userId)],
);

export const periodicInterviews = pgTable(
  "periodic_interviews",
  {
    ...actBase,
    candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "restrict" }),
    periodMonth: date("period_month").notNull(), // hari pertama bulan
    applicable: boolean("applicable").notNull().default(true), // false = 対象外
    interviewDate: date("interview_date"),
    resultStatus: text("result_status"),
    reason: text("reason"),
    content: text("content"),
    staffId: uuid("staff_id").references(() => users.id), // 面談対応者 (nama)
    note: text("note"),
    // Form 参考様式第5-5号 (T-009; migration 0024). Form kosong (semua NULL) = belum diisi; data lama tetap sah.
    method: text("method"), // 方式: in_person (対面) | online (オンライン)
    responderRole: text("responder_role"), // 面談対応者の区分: support_manager (支援責任者) | support_staff (支援担当者)
    responderTitle: text("responder_title"), // 役職名 (teks)
    form55: jsonb("form55"), // butir checklist + 基準不適合等への対応, divalidasi zod (src/db/form55.ts), <= 20000 karakter
    status: text("status").notNull().default("active"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    versionNo: integer("version_no").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("periodic_interviews_candidate_month_key").on(t.candidateId, t.periodMonth),
    index("periodic_interviews_org_month_idx").on(t.organizationId, t.periodMonth),
    check("periodic_interviews_result_check", sql`${t.resultStatus} is null or ${t.resultStatus} in ('no_issue','follow_up','issue','not_done')`),
    check("periodic_interviews_reason_check", sql`${t.reason} is null or ${t.reason} in ('agency','support','worker')`),
    check("periodic_interviews_status_check", sql`${t.status} in ('active','void')`),
    check("periodic_interviews_void_check", sql`${t.status} = 'active' or (${t.voidReason} is not null and length(btrim(${t.voidReason})) > 0)`),
    check("periodic_interviews_month_check", sql`extract(day from ${t.periodMonth}) = 1`),
    check("periodic_interviews_method_check", sql`${t.method} is null or ${t.method} in ('in_person','online')`),
    check("periodic_interviews_responder_role_check", sql`${t.responderRole} is null or ${t.responderRole} in ('support_manager','support_staff')`),
    check("periodic_interviews_form55_size_check", sql`${t.form55} is null or length(${t.form55}::text) <= 20000`),
  ],
);

export const periodicInterviewQuarterNotes = pgTable(
  "periodic_interview_quarter_notes",
  {
    ...actBase,
    candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "restrict" }),
    fiscalYear: integer("fiscal_year").notNull(), // tahun mulai (April tahun ini - Maret tahun depan)
    quarter: smallint("quarter").notNull(),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("periodic_quarter_notes_key").on(t.candidateId, t.fiscalYear, t.quarter), check("periodic_quarter_check", sql`${t.quarter} between 1 and 4`)],
);

export const caseTimelineEvents = pgTable(
  "case_timeline_events",
  {
    ...actBase,
    caseId: uuid("case_id").notNull().references(() => activityCases.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    timeKnown: boolean("time_known").notNull().default(false), // jam opsional: false = hanya tanggal
    event: text("event").notNull(),
    subjectStatement: text("subject_statement"),
    companyResponse: text("company_response"),
    note: text("note"),
    sourceRecordId: uuid("source_record_id").references(() => activityRecords.id),
    includeInClientExport: boolean("include_in_client_export").notNull().default(true),
    status: text("status").notNull().default("active"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    versionNo: integer("version_no").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    index("case_timeline_events_case_idx").on(t.caseId, t.occurredAt),
    check("case_timeline_events_status_check", sql`${t.status} in ('active','void')`),
    check("case_timeline_events_void_check", sql`${t.status} = 'active' or (${t.voidReason} is not null and length(btrim(${t.voidReason})) > 0)`),
  ],
);

export const activityAttachments = pgTable(
  "activity_attachments",
  {
    ...actBase,
    recordId: uuid("record_id").references(() => activityRecords.id),
    interviewId: uuid("interview_id").references(() => periodicInterviews.id),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    originalName: text("original_name").notNull(),
    caption: text("caption"),
    includeInPdf: boolean("include_in_pdf").notNull().default(false),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
  },
  (t) => [
    index("activity_attachments_record_idx").on(t.recordId),
    index("activity_attachments_interview_idx").on(t.interviewId),
    check("activity_attachments_parent_check", sql`num_nonnulls(${t.recordId}, ${t.interviewId}) = 1`),
    check("activity_attachments_mime_check", sql`${t.mime} in ('image/jpeg','image/png','image/webp')`),
    check("activity_attachments_size_check", sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 10485760`),
  ],
);

export const activityFollowups = pgTable(
  "activity_followups",
  {
    ...actBase,
    recordId: uuid("record_id").references(() => activityRecords.id),
    caseId: uuid("case_id").references(() => activityCases.id),
    interviewId: uuid("interview_id").references(() => periodicInterviews.id),
    description: text("description").notNull(),
    assigneeId: uuid("assignee_id").notNull().references(() => users.id),
    dueDate: date("due_date"),
    status: text("status").notNull().default("open"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: uuid("done_by").references(() => users.id),
  },
  (t) => [
    index("activity_followups_assignee_idx").on(t.assigneeId, t.status),
    index("activity_followups_org_status_idx").on(t.organizationId, t.status),
    check("activity_followups_status_check", sql`${t.status} in ('open','done','cancelled')`),
    check("activity_followups_parent_check", sql`num_nonnulls(${t.recordId}, ${t.caseId}, ${t.interviewId}) >= 1`),
    check("activity_followups_desc_check", sql`length(btrim(${t.description})) > 0`),
  ],
);

// Riwayat edit (append-only; hanya TRIGGER yang menulis, hashi_app tanpa INSERT/UPDATE/DELETE). snapshot = nilai SEBELUM perubahan.
export const activityRevisions = pgTable(
  "activity_revisions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    versionNo: integer("version_no").notNull(), // versi yang DIGANTIKAN
    snapshot: jsonb("snapshot").notNull(),
    editedBy: uuid("edited_by").references(() => users.id),
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_revisions_entity_idx").on(t.entityType, t.entityId, t.versionNo),
    check("activity_revisions_type_check", sql`${t.entityType} in ('record','timeline_event','case','periodic_interview','residence_card')`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Penanggung jawab pekerja (担当/責任者; T-010, migration 0023): per PERUSAHAAN klien (bawaan semua pekerjanya) atau per PENEMPATAN (menimpa perusahaan).
// Riwayat APPEND-ONLY: tiap perubahan = baris baru dengan tanggal mulai berlaku (tidak ada UPDATE/DELETE). `staff_id` NULL = dikosongkan (perusahaan: tanpa penanggung jawab;
// penempatan: kembali mengikuti perusahaan). Hanya TSK organisasi sama (RLS); menulis hanya TSK_ADMIN. Staf harus staf TSK organisasi yang sama (trigger).
// ---------------------------------------------------------------------------------------------
export const responsibleAssignments = pgTable(
  "responsible_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => clientCompanies.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").references(() => placements.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").references(() => users.id),
    effectiveFrom: date("effective_from").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
  },
  (t) => [
    index("responsible_assignments_company_idx").on(t.companyId, t.effectiveFrom),
    index("responsible_assignments_placement_idx").on(t.placementId, t.effectiveFrom),
    index("responsible_assignments_staff_idx").on(t.staffId),
    check("responsible_assignments_scope_check", sql`num_nonnulls(${t.companyId}, ${t.placementId}) = 1`),
  ],
);

// ---------------------------------------------------------------------------------------------
// Pelacak kartu izin tinggal 在留カード (T-017, migration 0025; desain docs/zairyu-card.md): satu baris = satu kartu; perpanjangan = baris BARU (previous_card_id),
// bukan menimpa. Hanya TSK organisasi sama (RLS) membaca; menulis = 担当 efektif pekerja (T-010) atau TSK_ADMIN (fungsi `card_editor`). Tanpa DELETE (void + alasan).
// TIDAK menyimpan nomor/foto kartu (tugas terpisah T-020). `received` final kecuali tanggal serah/catatan/void; "terima kartu baru" = satu transaksi (kartu pengganti wajib).
// ---------------------------------------------------------------------------------------------
export const residenceCards = pgTable(
  "residence_cards",
  {
    ...actBase,
    candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "restrict" }),
    previousCardId: uuid("previous_card_id").references((): AnyPgColumn => residenceCards.id),
    residenceStatus: text("residence_status").notNull().default("ssw1"), // 在留資格: hanya ssw1 (特定技能1号)
    skillFieldId: uuid("skill_field_id").notNull().references(() => skillFields.id, { onDelete: "restrict" }), // bidang (bawaan candidates.field_id)
    periodMonths: integer("period_months"), // 在留期間 (bulan); pilihan di src/db/zairyu.ts PERIOD_OPTIONS
    expiryDate: date("expiry_date").notNull(), // 在留期限 (tanggal kalender Jepang; hari itu masih berlaku)
    renewalStatus: text("renewal_status").notNull().default("not_started"),
    appliedOn: date("applied_on"), // tanggal pengajuan ke 入管
    additionalDocsOn: date("additional_docs_on"), // tanggal imigrasi meminta dokumen tambahan (追加資料); wajib bila status additional_docs (T-018, migration 0026)
    rejectedOn: date("rejected_on"), // tanggal ditolak (不許可); wajib bila status rejected
    receivedOn: date("received_on"), // tanggal kartu baru diterima
    receivedBy: text("received_by"), // staff | worker (diambil staf lalu diserahkan, atau pekerja mengambil sendiri)
    handedOverOn: date("handed_over_on"), // tanggal diserahkan ke pekerja (hanya bila received_by = staff)
    note: text("note"), // dilarang berisi nomor kartu atau data medis
    status: text("status").notNull().default("active"),
    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: uuid("voided_by").references(() => users.id),
    versionNo: integer("version_no").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    index("residence_cards_candidate_idx").on(t.candidateId),
    index("residence_cards_org_expiry_idx").on(t.organizationId, t.expiryDate),
    uniqueIndex("residence_cards_one_successor_key").on(t.previousCardId).where(sql`${t.previousCardId} is not null and ${t.status} = 'active'`),
    check("residence_cards_residence_status_check", sql`${t.residenceStatus} in ('ssw1')`),
    check("residence_cards_period_check", sql`${t.periodMonths} is null or ${t.periodMonths} between 1 and 60`),
    check("residence_cards_renewal_status_check", sql`${t.renewalStatus} in ('not_started','preparing','applied','additional_docs','received','rejected')`),
    check("residence_cards_applied_check", sql`${t.renewalStatus} in ('not_started','preparing') or ${t.appliedOn} is not null`),
    check("residence_cards_received_check", sql`(${t.renewalStatus} = 'received') = (${t.receivedOn} is not null)`),
    check("residence_cards_received_by_check", sql`(${t.renewalStatus} = 'received') = (${t.receivedBy} is not null) and (${t.receivedBy} is null or ${t.receivedBy} in ('staff','worker'))`),
    check("residence_cards_additional_check", sql`${t.renewalStatus} <> 'additional_docs' or ${t.additionalDocsOn} is not null`),
    check("residence_cards_rejected_check", sql`${t.renewalStatus} <> 'rejected' or ${t.rejectedOn} is not null`),
    check("residence_cards_status_dates_check", sql`(${t.additionalDocsOn} is null or ${t.appliedOn} is null or ${t.additionalDocsOn} >= ${t.appliedOn}) and (${t.rejectedOn} is null or ${t.appliedOn} is null or ${t.rejectedOn} >= ${t.appliedOn})`),
    check("residence_cards_dates_check", sql`${t.appliedOn} is null or ${t.receivedOn} is null or ${t.appliedOn} <= ${t.receivedOn}`),
    check("residence_cards_handover_check", sql`${t.handedOverOn} is null or (${t.receivedBy} = 'staff' and ${t.receivedOn} is not null and ${t.handedOverOn} >= ${t.receivedOn})`),
    check("residence_cards_note_check", sql`${t.note} is null or length(${t.note}) <= 2000`),
    check("residence_cards_status_check", sql`${t.status} in ('active','void')`),
    check("residence_cards_void_check", sql`${t.status} = 'active' or (${t.voidReason} is not null and length(btrim(${t.voidReason})) > 0)`),
  ],
);
