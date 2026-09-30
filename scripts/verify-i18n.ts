// Memeriksa teks UI: kunci id == ja, dan setiap bagian/kolom/pilihan di
// src/features/candidates/sections.ts punya label di kedua bahasa.
// Pemakaian: npm run test:i18n
import { readFileSync } from "node:fs";
import { documentType } from "../src/db/schema";
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

for (const s of [...SINGLE_SECTIONS, ...LIST_SECTIONS]) {
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

for (const v of documentType.enumValues) {
  for (const [lang, dict] of [["id", id], ["ja", ja]] as const) {
    if (!(`detail.documents.types.${v}` in dict)) problems.push(`label jenis dokumen hilang (${lang}): ${v}`);
  }
}

if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`✓ Teks id/ja konsisten (${Object.keys(id).length} kunci, ${SINGLE_SECTIONS.length + LIST_SECTIONS.length} bagian halaman detail)`);
