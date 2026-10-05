// Memeriksa cakupan audit secara STATIS (tanpa database): setiap server action / route handler yang MENULIS data harus mencatat audit
// (langsung atau lewat fungsi yang dipanggilnya), kecuali ada di daftar pengecualian dengan alasan. Juga memastikan setiap kode aksi yang dicatat
// dikenal `describeAudit` (src/db/audit-describe.ts: ACTIONS), supaya halaman Riwayat selalu bisa menuliskannya dalam kalimat.
// Mencetak tabel cakupan (markdown). Pemakaian: npm run verify:audit-coverage
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ACTIONS } from "../src/db/audit-describe";

// Pengecualian: fungsi yang menulis tetapi SENGAJA tidak diaudit (dengan alasan). Tambahan baru harus punya alasan yang bisa dipertanggungjawabkan.
const EXEMPT: Record<string, string> = {
  setLocale: "preferensi tampilan pengguna (bahasa UI), bukan data organisasi/kandidat",
  saveDashboardLayout: "preferensi tampilan pengguna (tata letak dashboard), bukan data organisasi/kandidat",
  resetDashboardLayout: "preferensi tampilan pengguna (tata letak dashboard), bukan data organisasi/kandidat",
  logout: "mengakhiri sesi; tidak mengubah data",
  markRecordRead: "tanda \"sudah dibaca\" adalah data fitur, bukan perubahan data (keputusan TSK, langkah 7A)",
  markReportRead: "tanda \"sudah dibaca\" adalah data fitur, bukan perubahan data (keputusan TSK, langkah 7A)",
};

const WRITE = /\.(insert|update|delete)\(|\btx\.execute\(\s*sql`\s*(insert|update|delete)\b|\bwriteFile\(|\bunlink\(|\brm\(/i;
const AUDIT = /\b(audit|auditTsk|auditClient|auditChange|auditCandidateDelete)\(|noteAuditEntry\(|assessmentAuditEntry\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

type Fn = { name: string; file: string; body: string; exported: boolean; action: boolean };

/** Ambil badan fungsi dengan menghitung kurung (lewati anotasi tipe pengembalian yang memuat { }). */
function bodyAt(src: string, from: number): string | null {
  let i = src.indexOf("(", from);
  if (i < 0) return null;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  let angle = 0;
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === "<") angle++;
    else if (c === ">" && src[i - 1] !== "=") angle = Math.max(0, angle - 1);
    else if (c === "{" && angle === 0) break;
    else if (c === ";" && angle === 0) return null;
  }
  let d = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}" && --d === 0) return src.slice(start, i + 1);
  }
  return null;
}

const files = [...walk("src/features"), ...walk("src/lib"), ...walk("src/app").filter((f) => /route\.ts$/.test(f))];
const fns: Fn[] = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const useServer = /^\s*["']use server["']/m.test(src.slice(0, 200));
  const isRoute = /route\.ts$/.test(file);
  for (const m of src.matchAll(/(export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g)) {
    const body = bodyAt(src, m.index! + m[0].length - 1);
    if (!body) continue;
    const isAction = (useServer && Boolean(m[1])) || (isRoute && /^(POST|PUT|PATCH|DELETE|GET)$/.test(m[2]));
    fns.push({ name: m[2], file, body, exported: Boolean(m[1]), action: isAction });
  }
}
const byName = new Map<string, Fn[]>();
for (const f of fns) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);

/** Apakah fungsi (atau yang dipanggilnya, bertingkat) memenuhi `pred` pada badannya. */
function reaches(fn: Fn, pred: (b: string) => boolean, seen = new Set<Fn>()): boolean {
  if (seen.has(fn)) return false;
  seen.add(fn);
  if (pred(fn.body)) return true;
  for (const m of fn.body.matchAll(/\b([A-Za-z0-9_]+)\s*\(/g)) {
    for (const callee of byName.get(m[1]) ?? []) if (callee !== fn && reaches(callee, pred, seen)) return true;
  }
  return false;
}

const rows: Array<{ name: string; file: string; writes: boolean; audited: boolean; note: string }> = [];
const problems: string[] = [];
for (const fn of fns.filter((f) => f.action)) {
  const writes = reaches(fn, (b) => WRITE.test(b));
  const audited = reaches(fn, (b) => AUDIT.test(b));
  const exempt = EXEMPT[fn.name];
  if (writes && !audited && !exempt) problems.push(`${fn.file}: ${fn.name} menulis data tetapi tidak mencatat audit (tambahkan audit() atau daftarkan di EXEMPT dengan alasan)`);
  if (writes || audited) rows.push({ name: fn.name, file: fn.file.replace(/^src\//, ""), writes, audited, note: exempt ?? "" });
}

// Setiap kode aksi yang dicatat harus dikenal describeAudit
const prefixes = new Set(Object.keys(ACTIONS).map((a) => a.split(".")[0]));
const used = new Set<string>();
for (const file of files) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!/audit|action:/i.test(line) || /^\s*(\/\/|\*)/.test(line)) continue;
    for (const m of line.matchAll(/"([a-z_]+\.[a-z_]+)"/g)) if (prefixes.has(m[1].split(".")[0])) used.add(m[1]);
  }
}
for (const a of used) if (!(a in ACTIONS)) problems.push(`aksi audit "${a}" tidak dikenal describeAudit (tambahkan ke ACTIONS di src/db/audit-describe.ts)`);

console.log("| Fungsi | Berkas | Menulis | Diaudit | Catatan |\n|---|---|---|---|---|");
for (const r of rows.sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name))) console.log(`| ${r.name} | ${r.file} | ${r.writes ? "ya" : "tidak"} | ${r.audited ? "ya" : "tidak"} | ${r.note} |`);
console.log(`\n${rows.length} fungsi menulis/mengaudit, ${used.size} kode aksi dicatat, ${Object.keys(ACTIONS).length} aksi dikenal.`);
if (problems.length) {
  console.error("\n" + problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("✓ Semua server action yang menulis data tercatat di audit (atau punya pengecualian beralasan).");
