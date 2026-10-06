import type { FieldDef } from "@/features/candidates/sections";

// Kolom form klien, diturunkan ke zod (buildSchema) dan form (FieldInputs, namespace label `clients.forms.<bagian>`).
// Nama kolom = nama properti tabel Drizzle (src/db/schema.ts).

export const COMPANY_FIELDS: FieldDef[] = [
  { name: "name", kind: "text", required: true, max: 160 },
  { name: "nameAlt", kind: "text", max: 160 },
  { name: "corporateNumber", kind: "text", max: 13, pattern: "^[0-9]{13}$" },
  { name: "hqAddress", kind: "textarea", max: 500 },
  { name: "phone", kind: "text", max: 40 },
  { name: "note", kind: "textarea", max: 2000 },
];

/** "Informasi untuk lembar" (langkah 6): dibuka lewat bagian lipat di form; labelnya memakai namespace form yang sama. */
export const COMPANY_SHEET_FIELDS: FieldDef[] = [
  { name: "industry", kind: "text", max: 120 },
  { name: "employeeCount", kind: "int", min: 0, max: 10_000_000 },
  { name: "foreignWorkerExperience", kind: "text", max: 300 },
  { name: "publicIntro", kind: "textarea", max: 1500 },
];

export const SITE_FIELDS: FieldDef[] = [
  { name: "name", kind: "text", required: true, max: 160 },
  { name: "address", kind: "textarea", max: 500 },
  { name: "phone", kind: "text", max: 40 },
  { name: "note", kind: "textarea", max: 2000 },
];

export const SITE_SHEET_FIELDS: FieldDef[] = [{ name: "accessNote", kind: "text", max: 300 }];

export const CONTACT_FIELDS: FieldDef[] = [
  { name: "roleTitle", kind: "text", max: 80 },
  { name: "name", kind: "text", required: true, max: 120 },
  { name: "phone", kind: "text", max: 40 },
];

/** Bagian yang labelnya ada di messages (clients.forms.<bagian>.fields.<kolom>); dipakai test:i18n. */
export const CLIENT_SECTIONS = {
  company: [...COMPANY_FIELDS, ...COMPANY_SHEET_FIELDS],
  site: [...SITE_FIELDS, ...SITE_SHEET_FIELDS],
  contact: CONTACT_FIELDS,
} as const;

/** Semua kolom yang disimpan form (dasar + informasi untuk lembar): dipakai zod, audit, dan nilai awal form. */
export const COMPANY_ALL_FIELDS: FieldDef[] = [...COMPANY_FIELDS, ...COMPANY_SHEET_FIELDS];
export const SITE_ALL_FIELDS: FieldDef[] = [...SITE_FIELDS, ...SITE_SHEET_FIELDS];
