// Memeriksa teks UI: kunci id == ja, dan setiap bagian/kolom/pilihan di
// src/features/candidates/sections.ts punya label di kedua bahasa.
// Pemakaian: npm run test:i18n
import { readFileSync } from "node:fs";
import { candidateStage, documentType, selectionDecision } from "../src/db/schema";
import { JOB_ORDER_FORMS } from "../src/features/job-orders/fields";
import { CLIENT_SECTIONS } from "../src/features/clients/fields";
import { ASSESSMENT_FIELDS } from "../src/features/assessments/fields";
import { LIST_SECTIONS, SINGLE_SECTIONS } from "../src/features/candidates/sections";

const load = (l: string) => JSON.parse(readFileSync(`messages/${l}.json`, "utf8")) as Record<string, unknown>;
function flat(o: Record<string, unknown>, p = ""): Record<string, string> {
  return Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (v && typeof v === "object") Object.assign(acc, flat(v as Record<string, unknown>, `${p}${k}.`));
    else acc[`${p}${k}`] = String(v);
    return acc;
  }, {});
}
const id = flat(load("id"));
const ja = flat(load("ja"));
const problems: string[] = [];

for (const k of Object.keys(id)) if (!(k in ja)) problems.push(`kunci hanya ada di id: ${k}`);
for (const k of Object.keys(ja)) if (!(k in id)) problems.push(`kunci hanya ada di ja: ${k}`);
for (const [k, v] of Object.entries({ ...id, ...ja })) if (!v.trim()) problems.push(`teks kosong: ${k}`);

// Teks Indonesia tidak boleh memuat huruf Jepang telanjang (pengguna LPK tidak membaca kanji): tulis istilah Indonesia/Inggris + cara baca
// (romaji). Lihat docs/glossary.md. Daftar izin = nama bahasa yang memang ditampilkan dalam aksaranya sendiri.
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;
const ALLOW_CJK_IN_ID = new Set(["languages.ja"]);
for (const [k, v] of Object.entries(id)) if (CJK.test(v) && !ALLOW_CJK_IN_ID.has(k)) problems.push(`huruf Jepang di teks Indonesia (lihat docs/glossary.md): ${k} = ${v}`);

for (const s of [...SINGLE_SECTIONS, ...LIST_SECTIONS, { key: "assessment", fields: ASSESSMENT_FIELDS }]) {
  const base = `detail.sections.${s.key}`;
  const need = [`${base}.title`];
  for (const f of s.fields) {
    need.push(`${base}.fields.${f.name}`);
    for (const o of f.options ?? []) need.push(`${base}.options.${f.name}.${o}`);
  }
  for (const key of need) for (const [lang, dict] of [["id", id], ["ja", ja]] as const) {
    if (!(key in dict)) problems.push(`label hilang (${lang}): ${key}`);
  }
}

for (const [section, defs] of Object.entries(CLIENT_SECTIONS)) {
  for (const f of defs) {
    const key = `clients.forms.${section}.fields.${f.name}`;
    for (const [lang, dict] of [["id", id], ["ja", ja]] as const) if (!(key in dict)) problems.push(`label hilang (${lang}): ${key}`);
  }
}

for (const [section, defs] of Object.entries(JOB_ORDER_FORMS)) {
  for (const f of defs) {
    const need = [`jobOrders.forms.${section}.fields.${f.name}`, ...(f.kind === "select" ? (f.options ?? []).map((o) => `jobOrders.forms.${section}.options.${f.name}.${o}`) : [])];
    for (const key of need) for (const [lang, dict] of [["id", id], ["ja", ja]] as const) if (!(key in dict)) problems.push(`label hilang (${lang}): ${key}`);
  }
}

for (const v of documentType.enumValues) {
  for (const [lang, dict] of [["id", id], ["ja", ja]] as const) {
    if (!(`detail.documents.types.${v}` in dict)) problems.push(`label jenis dokumen hilang (${lang}): ${v}`);
  }
}

// Setiap status (tahap LPK dan keputusan TSK) wajib punya penjelasan (statusHelp) di kedua bahasa: dipakai lencana status dan legenda.
for (const code of [...candidateStage.enumValues, ...selectionDecision.enumValues]) {
  for (const [lang, dict] of [["id", id], ["ja", ja]] as const) if (!(`statusHelp.${code}` in dict)) problems.push(`penjelasan status hilang (${lang}): statusHelp.${code}`);
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`✓ Teks id/ja konsisten (${Object.keys(id).length} kunci, ${SINGLE_SECTIONS.length + LIST_SECTIONS.length} bagian halaman detail)`);
