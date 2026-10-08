import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

// Buku panduan (T-030): docs/panduan/README.md + img/*.png + panduan-hashi.pdf. Dijaga supaya tidak ada gambar rusak/yatim,
// judul bernomor berurutan, PDF ada, dan tidak ada IP / email pribadi / secret (repo PUBLIK).
const DIR = path.resolve(__dirname, "../../docs/panduan");
const md = readFileSync(path.join(DIR, "README.md"), "utf8");

test("setiap gambar yang dirujuk ada, dan tidak ada gambar yatim di img/", () => {
  const used = new Set([...md.matchAll(/!\[[^\]]*\]\((img\/[^)\s]+)\)/g)].map((m) => m[1]));
  assert.ok(used.size >= 60, `gambar terlalu sedikit (${used.size})`);
  for (const u of used) assert.ok(existsSync(path.join(DIR, u)), `gambar tidak ada: ${u}`);
  const orphan = readdirSync(path.join(DIR, "img")).filter((f) => f.endsWith(".png") && !used.has(`img/${f}`));
  assert.deepEqual(orphan, [], "gambar tidak dipakai di panduan");
});

test("judul bab dan bagian bernomor berurutan (0..5, x.1, x.2, ...)", () => {
  let chapter = -1;
  let section = 0;
  for (const line of md.split("\n")) {
    const h2 = /^## (\d+)\. /.exec(line);
    const h3 = /^### (\d+)\.(\d+) /.exec(line);
    if (h2) {
      assert.equal(Number(h2[1]), chapter + 1, `bab loncat: ${line}`);
      chapter = Number(h2[1]);
      section = 0;
    } else if (h3) {
      assert.equal(Number(h3[1]), chapter, `bagian di bab yang salah: ${line}`);
      assert.equal(Number(h3[2]), section + 1, `bagian loncat: ${line}`);
      section = Number(h3[2]);
    } else assert.ok(!/^## /.test(line), `judul bab tanpa nomor: ${line}`);
  }
  assert.equal(chapter, 5, "harus ada bab 0 sampai 5");
});

test("empat contoh kasus (A-D) ada, masing-masing bergambar", () => {
  const cases = md.split(/^### 4\.\d /m).slice(1);
  assert.equal(cases.length, 4);
  for (const c of cases) assert.ok((c.match(/!\[/g) ?? []).length >= 5, "tiap skenario minimal 5 gambar");
});

test("PDF ada, valid, dan ukurannya wajar", () => {
  const pdf = path.join(DIR, "panduan-hashi.pdf");
  assert.ok(existsSync(pdf), "jalankan npm run build:guide");
  assert.equal(readFileSync(pdf).subarray(0, 5).toString(), "%PDF-");
  assert.ok(statSync(pdf).size < 20 * 1024 * 1024, "PDF >= 20 MB");
});

test("tidak ada IP, email pribadi, atau secret di teks panduan", () => {
  for (const ip of md.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) assert.fail(`alamat IP: ${ip}`);
  assert.ok(!/@(gmail|yahoo|outlook|hotmail)\./i.test(md), "email pribadi");
  assert.ok(!/xsmtpsib|smtp-brevo|BEGIN [A-Z ]*PRIVATE KEY/i.test(md), "secret");
  for (const e of md.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) assert.ok(e.endsWith("@hashi.test"), `email selain akun demo: ${e}`);
});
