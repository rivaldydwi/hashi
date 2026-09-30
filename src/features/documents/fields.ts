import { documentType } from "@/db/schema";
import type { FieldDef } from "@/features/candidates/sections";

/** Kolom form unggah dokumen (skema zod diturunkan dari sini lewat buildSchema). */
export const DOCUMENT_FIELDS: FieldDef[] = [
  { name: "type", kind: "select", required: true, options: documentType.enumValues },
  { name: "issuedDate", kind: "date" },
  { name: "expiryDate", kind: "date" },
];
