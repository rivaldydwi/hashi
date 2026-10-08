import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// README tiga bahasa (T-027): struktur judul harus SAMA (jumlah dan urutan `##`/`###`), tautan bahasa berfungsi,
// tautan/gambar relatif menunjuk berkas yang ada, dan tidak ada IP / email pribadi / secret (repo ini PUBLIK).
const ROOT = path.resolve(__dirname, "../..");
const FILES = { id: "README.md", en: "README.en.md", ja: "README.ja.md" } as const;
const text = (f: string) => readFileSync(path.join(ROOT, f), "utf8");

/** Judul H1-H3 di luar blok kode pagar (``` ... ```): bash memakai `#` untuk komentar. Level 4 (rincian teknis) boleh diringkas di versi lain. */
function headings(md: string): { level: number; title: string }[] {
  let fenced = false;
  const out: { level: number; title: string }[] = [];
  for (const line of md.split("\n")) {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const m = /^(#{1,6}) (.+)$/.exec(line);
    if (m && m[1].length <= 3) out.push({ level: m[1].length, title: m[2].trim() });
  }
  return out;
}

test("ketiga README punya struktur judul yang sama (level dan urutan)", () => {
  const levels = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, headings(text(f)).map((h) => h.level)]));
  assert.equal(levels.id.filter((l) => l === 1).length, 1, "tepat satu judul H1");
  assert.ok(levels.id.filter((l) => l === 2).length >= 8, "kerangka utama H2 tidak boleh menyusut");
  assert.deepEqual(levels.en, levels.id, "README.en.md berbeda struktur dari README.md");
  assert.deepEqual(levels.ja, levels.id, "README.ja.md berbeda struktur dari README.md");
});

test("tiap README punya baris tautan bahasa di bawah judul dan menandai dirinya sendiri", () => {
  for (const [lang, f] of Object.entries(FILES)) {
    const line = text(f).split("\n")[2];
    for (const target of Object.values(FILES)) {
      if (target === f) continue;
      assert.ok(line.includes(`](${target})`), `${f}: baris bahasa harus menautkan ${target}`);
    }
    const self = { id: "**Bahasa Indonesia**", en: "**English**", ja: "**日本語**" }[lang]!;
    assert.ok(line.includes(self), `${f}: bahasa sendiri harus ditebalkan tanpa tautan`);
  }
});

test("tautan dan gambar relatif menunjuk berkas yang ada", () => {
  for (const f of Object.values(FILES)) {
    const md = text(f).replace(/```[\s\S]*?```/g, "");
    for (const m of md.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      assert.ok(existsSync(path.join(ROOT, target)), `${f}: tautan rusak -> ${target}`);
    }
  }
});

test("tidak ada IP, email pribadi, atau secret di README", () => {
  for (const f of Object.values(FILES)) {
    const md = text(f);
    for (const ip of md.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) {
      assert.ok(ip === "127.0.0.1", `${f}: alamat IP terlarang (${ip})`);
    }
    assert.ok(!/@(gmail|yahoo|outlook|hotmail)\./i.test(md), `${f}: email pribadi`);
    assert.ok(!/xsmtpsib|smtp-brevo|BEGIN [A-Z ]*PRIVATE KEY/i.test(md), `${f}: kunci/secret`);
    assert.ok(!/^\s*(SMTP_URL|AUTH_SECRET|CARD_DATA_KEY)=\S+/m.test(md), `${f}: nilai .env`);
  }
});
