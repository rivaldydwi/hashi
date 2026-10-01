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

export const SITE_FIELDS: FieldDef[] = [
  { name: "name", kind: "text", required: true, max: 160 },
  { name: "address", kind: "textarea", max: 500 },
  { name: "phone", kind: "text", max: 40 },
  { name: "note", kind: "textarea", max: 2000 },
];

export const CONTACT_FIELDS: FieldDef[] = [
  { name: "roleTitle", kind: "text", max: 80 },
  { name: "name", kind: "text", required: true, max: 120 },
  { name: "phone", kind: "text", max: 40 },
];

/** Bagian yang labelnya ada di messages (clients.forms.<bagian>.fields.<kolom>); dipakai test:i18n. */
export const CLIENT_SECTIONS = { company: COMPANY_FIELDS, site: SITE_FIELDS, contact: CONTACT_FIELDS } as const;
