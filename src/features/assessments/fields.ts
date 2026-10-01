import type { FieldDef } from "@/features/candidates/sections";

export const SCORE_NAMES = ["scoreJapanese", "scoreAttitude", "scoreFitness", "scoreMotivation"] as const;
export const SCORE_OPTIONS = ["1", "2", "3", "4", "5"] as const;

/**
 * Kolom form penilaian bulanan LPK. Skema zod dan form diturunkan dari daftar ini (buildSchema / FieldInputs),
 * sama seperti bagian di sections.ts. Nilai 1-5 berupa pilihan berlabel teks (detail.sections.assessment.options.*).
 */
export const ASSESSMENT_FIELDS: FieldDef[] = [
  { name: "assessedOn", kind: "date", required: true },
  { name: "durationMinutes", kind: "int", required: true, min: 1, max: 480 },
  ...SCORE_NAMES.map((name): FieldDef => ({ name, kind: "select", options: SCORE_OPTIONS })),
  { name: "attendancePct", kind: "int", min: 0, max: 100 },
  { name: "testName", kind: "text", max: 120 },
  { name: "testScore", kind: "int", min: 0, max: 100000 },
  { name: "note", kind: "textarea", max: 4000 },
  { name: "followUp", kind: "textarea", max: 2000 },
];

type Scores = { scoreJapanese: number | null; scoreAttitude: number | null; scoreFitness: number | null; scoreMotivation: number | null };

/** Rata-rata nilai yang terisi (null bila belum ada satu pun). */
export function averageOf(s: Scores): number | null {
  const vals = SCORE_NAMES.map((n) => s[n]).filter((v): v is number => v !== null && v !== undefined);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export type Trend = "up" | "down" | "same";

/** Naik / turun / tetap dibanding penilaian sebelumnya, pada ketelitian satu desimal (yang ditampilkan). */
export function trendOf(current: number | null, previous: number | null): Trend | null {
  if (current === null || previous === null) return null;
  const c = Math.round(current * 10);
  const p = Math.round(previous * 10);
  return c > p ? "up" : c < p ? "down" : "same";
}

export const formatAvg = (v: number | null) => (v === null ? "—" : v.toFixed(1));
