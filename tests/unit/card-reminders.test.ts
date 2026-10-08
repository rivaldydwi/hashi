import assert from "node:assert/strict";
import { test } from "node:test";
import { afterSendTimeToday, buildDigest, buildTestEmail, isSafeRecipient, nextRunAfter, parseTestTo, planReminders, reminderStageOf, sentKey, tokyoDate, type ReminderItem } from "../../src/db/card-reminders";
import type { CardListRow } from "../../src/db/zairyu-queries";

// Email pengingat 在留カード (T-022): pemilihan tahap, sekali per (kartu, tahap, penerima), ringkasan per penerima, isi email (tanpa nomor), jadwal 08:00 Tokyo.
const row = (o: Partial<CardListRow> & { cardId: string; workerId: string; workerName: string }): CardListRow => ({
  nameKatakana: null, companyId: "co", companyName: "PT", siteName: "S", responsibleId: null, responsibleName: null, hasCard: true, stage: "none", daysLeft: 200, additionalDocs: false,
  specialUntil: null, expiryDate: "2027-05-01", renewalStatus: "not_started", periodMonths: 12, appliedOn: null, ...o,
});

test("tahap yang dikirim: prepare, can_apply, h30, h14, h7, expired, special_overdue, rejected, dan 追加資料; none/waiting_result/done/tanpa kartu tidak", () => {
  const send = ["prepare", "can_apply", "h30", "h14", "h7", "expired", "special_overdue", "rejected"] as const;
  for (const s of send) assert.equal(reminderStageOf({ hasCard: true, stage: s, additionalDocs: false }), s);
  for (const s of ["none", "waiting_result", "done"] as const) assert.equal(reminderStageOf({ hasCard: true, stage: s, additionalDocs: false }), null, s);
  assert.equal(reminderStageOf({ hasCard: true, stage: "waiting_result", additionalDocs: true }), "additional_docs");
  assert.equal(reminderStageOf({ hasCard: false, stage: null, additionalDocs: false }), null);
});

test("rencana: penerima = 担当 + semua Admin tanpa dobel; tanpa 担当 hanya Admin; yang sudah terkirim dilewati; ringkasan per penerima, paling mendesak dulu", () => {
  const rows = [
    row({ cardId: "c1", workerId: "w1", workerName: "Budi", responsibleId: "s1", stage: "h30", daysLeft: 25 }),
    row({ cardId: "c2", workerId: "w2", workerName: "Ani", responsibleId: "a1", stage: "h7", daysLeft: 5 }), // 担当 sekaligus Admin
    row({ cardId: "c3", workerId: "w3", workerName: "Cici", responsibleId: null, stage: "expired", daysLeft: -3 }),
    row({ cardId: "c4", workerId: "w4", workerName: "Dedi", responsibleId: "s1", stage: "waiting_result", additionalDocs: false }), // tidak dikirim
    row({ cardId: "c5", workerId: "w5", workerName: "Eko", responsibleId: "s1", stage: "waiting_result", additionalDocs: true }),
    row({ cardId: "", workerId: "w6", workerName: "Fani", hasCard: false, stage: null }),
  ];
  const plan = planReminders(rows, ["a1", "a2"], new Set());
  assert.deepEqual([...plan.keys()].sort(), ["a1", "a2", "s1"]);
  assert.deepEqual(plan.get("s1")!.map((i) => `${i.workerName}:${i.stage}`), ["Budi:h30", "Eko:additional_docs"]);
  assert.deepEqual(plan.get("a1")!.map((i) => i.workerName), ["Cici", "Ani", "Budi", "Eko"]); // expired > h7 > h30 > 追加資料
  assert.equal(plan.get("a2")!.length, 4);
  assert.equal(new Set(plan.get("a1")!.map((i) => i.cardId)).size, 4); // Ani tidak dobel walau 担当 + Admin

  // sudah terkirim ke s1 untuk c1:h30 → hanya item lain; ke a1 semuanya sudah → a1 hilang dari rencana
  const sent = new Set([sentKey("c1", "h30", "s1"), ...["c1:h30", "c2:h7", "c3:expired", "c5:additional_docs"].map((k) => sentKey(k.split(":")[0], k.split(":")[1], "a1"))]);
  const plan2 = planReminders(rows, ["a1", "a2"], sent);
  assert.deepEqual(plan2.get("s1")!.map((i) => i.workerName), ["Eko"]);
  assert.equal(plan2.has("a1"), false);
  assert.equal(plan2.get("a2")!.length, 4);
});

test("tahap berbeda untuk kartu yang sama = pengingat baru (h30 terkirim, lalu h14 masih dikirim); tahap sama tidak dikirim lagi", () => {
  const sent = new Set([sentKey("c1", "h30", "a1")]);
  assert.equal(planReminders([row({ cardId: "c1", workerId: "w1", workerName: "Budi", stage: "h30" })], ["a1"], sent).size, 0);
  assert.equal(planReminders([row({ cardId: "c1", workerId: "w1", workerName: "Budi", stage: "h14" })], ["a1"], sent).get("a1")!.length, 1);
});

const items: ReminderItem[] = [
  { cardId: "c1", workerId: "11111111-1111-1111-1111-111111111111", workerName: "Budi Santoso", stage: "h7", daysLeft: 5 },
  { cardId: "c2", workerId: "22222222-2222-2222-2222-222222222222", workerName: "山田 太郎", stage: "additional_docs", daysLeft: null },
];

test("isi email: bahasa sesuai locale, memuat nama + tahap + tautan, tanpa nomor kartu/catatan", () => {
  const id = buildDigest("id", "Staf A", items, "https://hashi.contoh.id/");
  assert.match(id.subject, /2 pekerja/);
  assert.match(id.text, /Budi Santoso — Sisa 7 hari sampai tanggal habis \(sisa 5 hari\)/);
  assert.match(id.text, /tsuika shiryo/);
  assert.match(id.text, /https:\/\/hashi\.contoh\.id\/records\/workers\/11111111-1111-1111-1111-111111111111/);
  assert.doesNotMatch(id.text, /[ぁ-んァ-ン]/); // teks Indonesia tanpa kalimat Jepang (nama pekerja boleh berhuruf kanji)
  const ja = buildDigest("ja", "管理者", items, "https://hashi.contoh.id");
  assert.match(ja.subject, /2名/);
  assert.match(ja.text, /在留期限まで7日です（残り5日）/);
  assert.match(ja.text, /追加資料の提出依頼があります/);
  assert.match(ja.html, /<a href="https:\/\/hashi\.contoh\.id\/records\/workers\/22222222/);
  for (const d of [id, ja]) {
    assert.doesNotMatch(d.text + d.html, /\b[A-Z]{2}\d{8}[A-Z]{2}\b/); // tidak ada pola nomor kartu
    assert.doesNotMatch(d.text.replace(/https?:\S+/g, ""), /\d{8}/); // tanpa deret angka sepanjang nomor kartu (selain id di tautan)
  }
  assert.doesNotMatch(buildDigest("id", "X", items, null).text, /https?:\/\//); // tanpa APP_URL = tanpa tautan
});

test("isi email: nama berisi karakter HTML di-escape di versi HTML", () => {
  const d = buildDigest("id", "<b>x</b>", [{ ...items[0], workerName: "A <script>&" }], null);
  assert.ok(!d.html.includes("<script>"));
  assert.ok(d.html.includes("&lt;script&gt;&amp;"));
});

test("jadwal: berikutnya selalu jam 08:00 Tokyo (= 23:00 UTC hari sebelumnya), setelah 'now'", () => {
  const at = (iso: string) => nextRunAfter(new Date(iso)).toISOString();
  assert.equal(at("2026-10-07T10:00:00Z"), "2026-10-07T23:00:00.000Z"); // 19:00 JST → besok 08:00 JST
  assert.equal(at("2026-10-07T22:59:59Z"), "2026-10-07T23:00:00.000Z"); // 07:59:59 JST → hari ini 08:00
  assert.equal(at("2026-10-07T23:00:00Z"), "2026-10-08T23:00:00.000Z"); // tepat 08:00 → besok
  assert.equal(at("2026-12-31T20:00:00Z"), "2026-12-31T23:00:00.000Z"); // pergantian tahun
  assert.equal(tokyoDate(new Date("2026-10-07T15:30:00Z")), "2026-10-08"); // 00:30 JST sudah tanggal berikutnya
  assert.equal(afterSendTimeToday(new Date("2026-10-07T22:59:00Z")), false); // 07:59 JST
  assert.equal(afterSendTimeToday(new Date("2026-10-07T23:00:00Z")), true); // tepat 08:00 JST
});

test("pengaman penerima: alamat contoh/demo/tidak sah dilewati; alamat nyata (termasuk Gmail dan subdomain wajar) boleh", () => {
  for (const bad of ["tsk.admin@hashi.test", "a@example.com", "a@example.org", "a@example.net", "a@sub.example.com", "a@kantor.test", "a@x.invalid", "a@host.example", "a@localhost", "a@mesin.localhost", "a@EXAMPLE.COM", "  A@Hashi.Test  ", "", "tanpa-at", "a@", "@b.id", "a b@c.id", "a@bad_domain.id", null, undefined]) {
    assert.equal(isSafeRecipient(bad as string), false, String(bad));
  }
  for (const ok of ["staf@tsk-contoh.co.jp", "nama@gmail.com", "a.b+tag@kantor.id", "x@mail.example-corp.com", "x@exampletest.com"]) assert.equal(isSafeRecipient(ok), true, ok);
});

test("--test-to: alamat sah dikembalikan, tidak diminta = null, kosong/rusak/diikuti opsi lain = invalid", () => {
  assert.equal(parseTestTo(["node", "w.ts"]), null);
  assert.equal(parseTestTo(["node", "w.ts", "--test-to", "ipal@gmail.com"]), "ipal@gmail.com");
  assert.equal(parseTestTo(["node", "w.ts", "--once", "--test-to", " ipal@gmail.com "]), "ipal@gmail.com");
  for (const bad of [["--test-to"], ["--test-to", ""], ["--test-to", "bukan-email"], ["--test-to", "--once"]]) assert.equal(parseTestTo(["node", "w.ts", ...bad]), "invalid", bad.join(" "));
});

test("email uji: data PALSU, bahasa id dan ja, tanpa nomor kartu, subjek berlabel uji", () => {
  const id = buildTestEmail("id", "https://hashi.contoh.id");
  assert.match(id.subject, /^\[Hashi\] Email uji:/);
  assert.match(id.text, /data palsu/);
  assert.doesNotMatch(id.text.replace(/https?:\S+/g, ""), /\d{8}/);
  const ja = buildTestEmail("ja");
  assert.match(ja.subject, /テストメール/);
  assert.match(ja.text, /ダミー/);
  assert.doesNotMatch(buildTestEmail("id").text, /https?:\/\//); // tanpa APP_URL = tanpa tautan
});

test("email uji: SEMUA tautan menuju halaman yang ada (/records/cards), bukan id pekerja palsu, dengan keterangan contoh/data palsu; email pengingat sungguhan tetap menautkan detail pekerja", () => {
  const base = "https://hashi.contoh.id";
  for (const locale of ["id", "ja"] as const) {
    const t = buildTestEmail(locale, base);
    const links = [...(t.text + t.html).matchAll(/https:\/\/hashi\.contoh\.id[^\s"<]*/g)].map((m) => m[0]);
    assert.ok(links.length >= 2, locale);
    assert.ok(links.every((l) => l === `${base}/records/cards`), `${locale}: ${links.join(", ")}`);
    assert.ok(!/records\/workers\//.test(t.text + t.html), "tidak ada tautan ke id pekerja palsu");
    assert.match(t.text, locale === "ja" ? /テスト送信・ダミーデータ/ : /EMAIL UJI · DATA PALSU/);
  }
  const real = buildDigest("id", "Staf A", items, base);
  assert.ok(real.text.includes(`${base}/records/workers/11111111-1111-1111-1111-111111111111`));
  assert.ok(!/EMAIL UJI/.test(real.text), "email sungguhan tanpa keterangan uji");
});
