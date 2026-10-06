import { gender, jobProgram } from "@/db/schema";
import type { FieldDef } from "@/features/candidates/sections";

export const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;

/**
 * Kolom form job order (lokasi dipilih terpisah saat dibuat dan tidak bisa diganti). Label: jobOrders.forms.jobOrder.fields.*,
 * pilihan: jobOrders.forms.jobOrder.options.<kolom>.<nilai>.
 */
export const JOB_ORDER_FIELDS: FieldDef[] = [
  { name: "title", kind: "text", required: true, max: 200 },
  { name: "fieldId", kind: "skillField", required: true },
  { name: "program", kind: "select", required: true, options: jobProgram.enumValues },
  { name: "positions", kind: "int", required: true, min: 1, max: 1000 },
  { name: "description", kind: "textarea", max: 4000 },
  { name: "salaryNote", kind: "textarea", max: 2000 },
  { name: "monthlySalary", kind: "int", min: 0, max: 10_000_000 },
  { name: "workPlace", kind: "text", max: 300 },
  { name: "minJlpt", kind: "select", options: JLPT_LEVELS },
  { name: "jftRequired", kind: "boolean" },
  { name: "genderRequirement", kind: "select", options: gender.enumValues },
  { name: "targetStartDate", kind: "date" },
  { name: "applicationDeadline", kind: "date" },
  { name: "note", kind: "textarea", max: 2000 },
];

/**
 * "Informasi untuk lembar" (langkah 6, 求人票): kondisi kerja. 業務内容 = `description`, 基本給 = `monthlySalary`, 補足 = `salaryNote`
 * (kolom lama dipakai ulang, tidak digandakan). Label memakai namespace form job order yang sama.
 */
export const HOUSING_VALUES = ["provided", "allowance", "none", "unspecified"] as const;
export const JOB_ORDER_SHEET_FIELDS: FieldDef[] = [
  { name: "workHours", kind: "textarea", max: 500 },
  { name: "daysOff", kind: "textarea", max: 500 },
  { name: "housing", kind: "select", options: HOUSING_VALUES },
  { name: "housingNote", kind: "text", max: 300 },
  { name: "commuteNote", kind: "text", max: 300 },
  { name: "benefitsNote", kind: "textarea", max: 1000 },
];
/** Nama kolom lama yang juga dihitung "informasi untuk lembar" (untuk petunjuk kelengkapan). */
export const JOB_ORDER_ALL_FIELDS: FieldDef[] = [...JOB_ORDER_FIELDS, ...JOB_ORDER_SHEET_FIELDS];

/** Kolom form penempatan (label: jobOrders.forms.placement.fields.*). */
export const PLACEMENT_FIELDS: FieldDef[] = [
  { name: "startDate", kind: "date", required: true },
  { name: "endDate", kind: "date" },
  { name: "status", kind: "select", required: true, options: ["ACTIVE", "ENDED"] },
  { name: "note", kind: "textarea", max: 2000 },
];

export const JOB_ORDER_FORMS = { jobOrder: JOB_ORDER_ALL_FIELDS, placement: PLACEMENT_FIELDS } as const;
