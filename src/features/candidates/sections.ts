// Definisi bagian halaman detail kandidat. SATU tempat untuk menambah/menghapus kolom:
// tiap bagian mendaftar kolomnya di sini, lalu skema zod, form, tampilan, dan pemeriksaan teks
// id/ja (npm run test:i18n) diturunkan dari daftar ini. Nama kolom = nama properti tabel di
// src/db/schema.ts, jadi menambah kolom = 1 migration kecil + 1 baris di sini + label di messages/*.json.

import { z } from "zod";
import {
  certificateType,
  dominantHand,
  familyRelation,
  gender,
  maritalStatus,
} from "@/db/schema";

/** skillField = pilihan dari tabel master skill_fields (nilai = id bidang kerja); opsinya diisi dari konteks UI, bukan dari definisi. */
export type FieldKind = "text" | "textarea" | "date" | "select" | "boolean" | "int" | "email" | "skillField";

export type FieldDef = {
  name: string;
  kind: FieldKind;
  required?: boolean;
  max?: number; // panjang teks, atau nilai maksimum untuk int
  min?: number; // nilai minimum untuk int
  options?: readonly string[]; // untuk select
};

/** basic = boleh dilihat sensei; detail = hanya LPK_ADMIN dan TSK. */
export type Level = "basic" | "detail";

/** Pasangan [lebih awal, lebih akhir]: nilai kedua tidak boleh lebih kecil dari yang pertama (tanggal atau tahun). */
export type OrderedPair = [earlier: string, later: string];

export type SingleSectionDef = {
  key: string;
  orderedDates?: OrderedPair[];
  table: "candidates" | "candidate_private";
  level: Level;
  fields: FieldDef[];
};

export type ListSectionDef = {
  key: string;
  orderedDates?: OrderedPair[];
  table: "candidate_family_members" | "candidate_educations" | "candidate_work_histories" | "candidate_certificates";
  level: "detail";
  fields: FieldDef[];
  /** Kolom yang ditampilkan sebagai ringkasan satu baris. */
  summary: string[];
};

// ---- Bagian satu-baris ------------------------------------------------------------------
// Kolom mengikuti yang lazim di 履歴書 dan form 入管 (nama katakana, tempat lahir, status
// pernikahan, tinggi/berat, paspor, kontak, riwayat Jepang), supaya tidak diketik ulang nanti.

export const SINGLE_SECTIONS: SingleSectionDef[] = [
  {
    key: "basic",
    table: "candidates",
    level: "basic",
    fields: [
      { name: "fullName", kind: "text", required: true, max: 120 },
      { name: "nameKatakana", kind: "text", max: 120 },
      { name: "gender", kind: "select", required: true, options: gender.enumValues },
      { name: "birthDate", kind: "date", required: true },
      { name: "birthPlace", kind: "text", max: 120 },
      { name: "maritalStatus", kind: "select", options: maritalStatus.enumValues },
      { name: "fieldId", kind: "skillField", required: true },
      { name: "heightCm", kind: "int", min: 100, max: 230 },
      { name: "weightKg", kind: "int", min: 25, max: 250 },
      { name: "dominantHand", kind: "select", options: dominantHand.enumValues },
    ],
  },
  {
    key: "about",
    table: "candidates",
    level: "basic",
    fields: [
      { name: "motivation", kind: "textarea" },
      { name: "selfPr", kind: "textarea" },
      { name: "hobby", kind: "text", max: 300 },
      { name: "specialSkill", kind: "text", max: 300 },
    ],
  },
  {
    key: "japan",
    table: "candidates",
    level: "detail",
    fields: [
      { name: "everInJapan", kind: "boolean" },
      { name: "visaRejectedBefore", kind: "boolean" },
      { name: "japanHistoryNote", kind: "textarea" },
    ],
  },
  {
    key: "contact",
    table: "candidate_private",
    level: "detail",
    fields: [
      { name: "address", kind: "textarea", max: 500 },
      { name: "phone", kind: "text", max: 40 },
      { name: "whatsapp", kind: "text", max: 40 },
      { name: "email", kind: "email", max: 254 },
    ],
  },
  {
    key: "identity",
    table: "candidate_private",
    level: "detail",
    orderedDates: [["passportIssuedDate", "passportExpiryDate"]],
    fields: [
      { name: "nationalId", kind: "text", max: 40 },
      { name: "familyCardNumber", kind: "text", max: 40 },
      { name: "passportNumber", kind: "text", max: 40 },
      { name: "passportIssuedDate", kind: "date" },
      { name: "passportExpiryDate", kind: "date" },
    ],
  },
  {
    key: "health",
    table: "candidate_private",
    level: "detail",
    fields: [
      { name: "visionNote", kind: "text", max: 300 },
      { name: "colorBlind", kind: "boolean" },
      { name: "medicalNote", kind: "textarea" },
    ],
  },
];

// ---- Bagian berisi banyak baris ---------------------------------------------------------

export const LIST_SECTIONS: ListSectionDef[] = [
  {
    key: "family",
    table: "candidate_family_members",
    level: "detail",
    summary: ["relation", "name", "occupation"],
    fields: [
      { name: "relation", kind: "select", required: true, options: familyRelation.enumValues },
      { name: "name", kind: "text", required: true, max: 120 },
      { name: "occupation", kind: "text", max: 120 },
      { name: "phone", kind: "text", max: 40 },
      { name: "address", kind: "textarea", max: 500 },
      { name: "livesInJapan", kind: "boolean" },
      { name: "isEmergencyContact", kind: "boolean" },
    ],
  },
  {
    key: "education",
    table: "candidate_educations",
    level: "detail",
    orderedDates: [["startYear", "endYear"]],
    summary: ["schoolName", "major", "startYear", "endYear"],
    fields: [
      { name: "schoolName", kind: "text", required: true, max: 160 },
      { name: "major", kind: "text", max: 160 },
      { name: "startYear", kind: "int", min: 1940, max: 2100 },
      { name: "endYear", kind: "int", min: 1940, max: 2100 },
    ],
  },
  {
    key: "work",
    table: "candidate_work_histories",
    level: "detail",
    orderedDates: [["startDate", "endDate"]],
    summary: ["companyName", "position", "startDate", "endDate"],
    fields: [
      { name: "companyName", kind: "text", required: true, max: 160 },
      { name: "position", kind: "text", max: 160 },
      { name: "startDate", kind: "date" },
      { name: "endDate", kind: "date" },
    ],
  },
  {
    key: "certificates",
    table: "candidate_certificates",
    level: "detail",
    summary: ["type", "levelOrField", "score", "issuedDate"],
    fields: [
      { name: "type", kind: "select", required: true, options: certificateType.enumValues },
      { name: "levelOrField", kind: "text", max: 120 },
      { name: "score", kind: "int", min: 0, max: 100000 },
      { name: "certificateNumber", kind: "text", max: 80 },
      { name: "issuedDate", kind: "date" },
    ],
  },
];

export function singleSection(key: string) {
  return SINGLE_SECTIONS.find((s) => s.key === key);
}
export function listSection(key: string) {
  return LIST_SECTIONS.find((s) => s.key === key);
}

// ---- Skema zod diturunkan dari definisi -------------------------------------------------

const isoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function fieldSchema(f: FieldDef): z.ZodType {
  if (f.kind === "boolean") {
    return z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
  }
  const raw = z.preprocess((v) => (typeof v === "string" ? v.trim() : ""), z.string());
  const optional = (check: (v: string) => boolean) =>
    raw.refine((v) => (v === "" ? !f.required : check(v))).transform((v) => (v === "" ? null : v));

  switch (f.kind) {
    case "text":
    case "textarea":
      return optional((v) => v.length <= (f.max ?? (f.kind === "textarea" ? 2000 : 200)));
    case "email":
      return optional((v) => v.length <= (f.max ?? 254) && z.email().safeParse(v).success);
    case "date":
      return optional(isoDate);
    case "select":
      return optional((v) => (f.options ?? []).includes(v));
    case "skillField":
      return optional((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));
    case "int":
      return raw
        .refine((v) => {
          if (v === "") return !f.required;
          const n = Number(v);
          return /^\d{1,6}$/.test(v) && n >= (f.min ?? 0) && n <= (f.max ?? 1_000_000);
        })
        .transform((v) => (v === "" ? null : Number(v)));
    default:
      return raw;
  }
}

/** Skema zod untuk sekumpulan kolom. Hasil parse: { namaKolom: nilai | null }. */
export function buildSchema(fields: FieldDef[], orderedDates: OrderedPair[] = []) {
  return z
    .object(Object.fromEntries(fields.map((f) => [f.name, fieldSchema(f)])))
    .superRefine((v, ctx) => {
      const values = v as Record<string, string | number | null>;
      for (const [earlier, later] of orderedDates) {
        const a = values[earlier];
        const b = values[later];
        if (a !== null && a !== undefined && b !== null && b !== undefined && a > b) {
          ctx.addIssue({ code: "custom", path: [later], message: "order" });
        }
      }
    });
}

/** Satu baris/isian dianggap kosong bila semua kolomnya kosong (teks kosong, boolean tidak dicentang). */
export function isBlank(fields: FieldDef[], raw: Record<string, unknown>): boolean {
  return fields.every((f) => (f.kind === "boolean" ? !(raw[f.name] === "on" || raw[f.name] === "true") : String(raw[f.name] ?? "").trim() === ""));
}

// Form tambah kandidat memakai nama kolom apa adanya untuk bagian satu-baris, jadi nama kolom antar-bagian
// tidak boleh sama. Diperiksa saat modul dimuat (gagal keras lebih baik daripada isian saling menimpa).
{
  const seen = new Map<string, string>();
  for (const s of SINGLE_SECTIONS) {
    for (const f of s.fields) {
      if (seen.has(f.name)) throw new Error(`sections.ts: kolom "${f.name}" ada di bagian "${seen.get(f.name)}" dan "${s.key}"`);
      seen.set(f.name, s.key);
    }
  }
}

/** Nilai dari database -> nilai awal input form (string / boolean). */
export function toFormValue(f: FieldDef, raw: unknown): string | boolean {
  if (f.kind === "boolean") return raw === true;
  return raw === null || raw === undefined ? "" : String(raw);
}

/** Nama kolom yang nilainya berbeda. Hanya NAMA yang dicatat di audit, tidak pernah isinya. */
export function changedFields(fields: FieldDef[], before: Record<string, unknown> | undefined, after: Record<string, unknown>) {
  const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);
  return fields.filter((f) => norm(before?.[f.name]) !== norm(after[f.name])).map((f) => f.name);
}
