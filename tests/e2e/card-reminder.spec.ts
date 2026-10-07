import { expect, test } from "@playwright/test";
import nodemailer from "nodemailer";
import { createDb } from "../../src/db";
import { runCardReminders } from "../../src/db/card-reminders";
import { ownerQuery, unique } from "./helpers";

// Email pengingat 在留カード (T-022) dengan Mailpit (penerima uji, tidak mengirim ke luar): email sampai ke 担当 + Admin, bahasa sesuai users.locale, tanpa nomor kartu,
// SEKALI per (kartu, tahap, penerima) (putaran kedua tidak mengirim lagi), tahap baru = email baru, mode kering tidak mengirim dan tidak mencatat. Pekerja uji SENDIRI.

test.describe.configure({ mode: "serial" });

const SMTP_PORT = Number(process.env.MAILPIT_SMTP_PORT ?? 1025);
const API = `http://127.0.0.1:${process.env.MAILPIT_UI_PORT ?? 8025}/api/v1`;
const run = unique();
const startedAt = new Date().toISOString();
const d = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
let w1 = { id: "", name: "", card: "" }; // dengan 担当 (tsk.staff), tahap h7
let w2 = { id: "", name: "", card: "" }; // 担当 = tsk.staff2, tahap h14 (tanpa 担当 sama sekali dites di unit; di seed perusahaan punya 担当 cadangan)
let ids = { staff: "", staff2: "", tsk: "", site: "" };
let mailpitUp = false;
const handle = createDb(process.env.DATABASE_URL!, 3);
const mailer = nodemailer.createTransport({ host: "127.0.0.1", port: SMTP_PORT, secure: false, tls: { rejectUnauthorized: false } });

type Msg = { to: string[]; subject: string; text: string };
async function inbox(): Promise<Msg[]> {
  const list = (await (await fetch(`${API}/messages?limit=500`)).json()) as { messages: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string }> };
  return Promise.all(list.messages.map(async (m) => ({ to: m.To.map((t) => t.Address), subject: m.Subject, text: ((await (await fetch(`${API}/message/${m.ID}`)).json()) as { Text: string }).Text })));
}
const about = (msgs: Msg[], name: string) => msgs.filter((m) => m.text.includes(name));
const go = (extra: Partial<Parameters<typeof runCardReminders>[0]> = {}) => runCardReminders({ mailer, from: "Hashi <hashi@hashi.test>", baseUrl: "https://hashi.test", db: handle.db, log: () => {}, ...extra });

async function scratchWorker(label: string, expiryDays: number, staffId: string | null) {
  const name = `Uji Pengingat ${label} ${run}`;
  const [c] = await ownerQuery<{ id: string }>(
    `insert into candidates (organization_id, full_name, gender, birth_date, field_id, stage, shared_with_tsk)
     select o.id, $1, 'MALE', '2000-05-15', (select id from skill_fields where code = 'food'), 'READY', true from organizations o where o.name = 'LPK Demo Bandung' returning id::text as id`, [name]);
  const [p] = await ownerQuery<{ id: string }>("insert into placements (candidate_id, org_id, site_id, start_date, status) values ($1, $2, $3, current_date - 90, 'ACTIVE') returning id::text as id", [c.id, ids.tsk, ids.site]);
  if (staffId) await ownerQuery("insert into responsible_assignments (organization_id, created_by, placement_id, staff_id, effective_from, created_at) values ($1, $2, $3, $2, current_date, clock_timestamp())", [ids.tsk, staffId, p.id]);
  const [card] = await ownerQuery<{ id: string }>("insert into residence_cards (organization_id, created_by, candidate_id, skill_field_id, expiry_date) values ($1, $2, $3, (select id from skill_fields where code = 'food'), $4::date) returning id::text as id", [ids.tsk, ids.staff, c.id, d(expiryDays)]);
  return { id: c.id, name, card: card.id };
}

test.beforeAll(async () => {
  try {
    mailpitUp = (await fetch(`${API}/info`)).ok;
  } catch {
    mailpitUp = false;
  }
  if (!mailpitUp) {
    if (process.env.CI) throw new Error("Mailpit tidak terjangkau di CI");
    return;
  }
  await fetch(`${API}/messages`, { method: "DELETE" });
  const [u] = await ownerQuery<{ staff: string; staff2: string; tsk: string }>("select (select id::text from users where email = 'tsk.staff@hashi.test') as staff, (select id::text from users where email = 'tsk.staff2@hashi.test') as staff2, (select organization_id::text from users where email = 'tsk.staff@hashi.test') as tsk");
  const [site] = await ownerQuery<{ id: string }>("select s.id::text as id from client_sites s join organizations o on o.id = s.org_id where o.name = 'TSK Demo Tokyo' order by s.id limit 1");
  ids = { staff: u.staff, staff2: u.staff2, tsk: u.tsk, site: site.id };
  const loc = await ownerQuery<{ email: string; locale: string }>("select email, locale::text from users where email in ('tsk.staff@hashi.test', 'tsk.admin@hashi.test')");
  expect(Object.fromEntries(loc.map((l) => [l.email, l.locale]))).toEqual({ "tsk.staff@hashi.test": "id", "tsk.admin@hashi.test": "ja" });
  w1 = await scratchWorker("A", 5, ids.staff); // 5 hari lagi: h7
  w2 = await scratchWorker("B", 12, ids.staff2); // 12 hari lagi: h14
});

test.afterAll(async () => {
  await handle.pool.end();
  if (mailpitUp) {
    await fetch(`${API}/messages`, { method: "DELETE" });
    for (const w of [w1, w2]) await ownerQuery("delete from residence_cards where candidate_id = $1", [w.id]); // log pengingat ikut terhapus (cascade)
    await ownerQuery("delete from responsible_assignments where created_at >= $1", [startedAt]);
    for (const w of [w1, w2]) await ownerQuery("delete from candidates where id = $1", [w.id]);
  }
});

test.beforeEach(({}, info) => { if (!mailpitUp) info.skip(true, "Mailpit tidak jalan (docker compose -f compose.yaml -f compose.dev.yaml up -d mailpit)"); });

test("email sampai ke 担当 + Admin; bahasa sesuai locale; berisi nama + tahap + tautan; tanpa nomor kartu atau catatan", async () => {
  const s = await go();
  expect(s.mode).toBe("send");
  expect(s.failed).toBe(0);
  const msgs = await inbox();
  const a = about(msgs, w1.name);
  expect(a.flatMap((m) => m.to).sort()).toEqual(["tsk.admin@hashi.test", "tsk.staff@hashi.test"]); // 担当 + Admin
  const staffMail = a.find((m) => m.to.includes("tsk.staff@hashi.test"))!;
  const adminMail = a.find((m) => m.to.includes("tsk.admin@hashi.test"))!;
  expect(staffMail.text).toContain("Sisa 7 hari sampai tanggal habis"); // locale id
  expect(staffMail.subject).toMatch(/Pengingat kartu izin tinggal/);
  expect(adminMail.text).toContain("在留期限まで7日です"); // locale ja
  expect(adminMail.subject).toContain("在留カード");
  for (const m of [staffMail, adminMail]) {
    expect(m.text).toContain(`https://hashi.test/records/workers/${w1.id}`);
    expect(m.text.replace(/https?:\S+/g, "").replaceAll(w1.name, "").replaceAll(w2.name, "")).not.toMatch(/\d{8}|[A-Z]{2}\d{4}/); // nama uji memuat angka unik; selain itu tidak ada deret angka/pola nomor kartu
  }
  // pekerja B: 担当 = staf2 + Admin (staf A TIDAK menerima pekerja yang bukan tanggung jawabnya)
  expect(about(msgs, w2.name).flatMap((m) => m.to).sort()).toEqual(["tsk.admin@hashi.test", "tsk.staff2@hashi.test"]);
  expect(about(msgs, w2.name)[0].text).toContain("在留期限まで14日です");
  // satu email ringkasan per penerima: Admin menerima SATU email yang memuat kedua pekerja
  expect(adminMail.text).toContain(w2.name);
  expect(msgs.filter((m) => m.to.includes("tsk.admin@hashi.test")).length).toBe(1);
  expect(about(msgs, w2.name).find((m) => m.to.includes("tsk.staff@hashi.test"))).toBeUndefined();
  const log = await ownerQuery<{ stage: string; n: number }>("select stage, count(*)::int as n from card_reminder_log where card_id = any($1::uuid[]) group by stage order by stage", [[w1.card, w2.card]]);
  expect(log).toEqual([{ stage: "h14", n: 2 }, { stage: "h7", n: 2 }]);
});

test("audit: satu entri per (kartu, tahap) berisi tahap dan jumlah penerima, tanpa alamat email", async () => {
  const rows = await ownerQuery<{ entity_id: string; after: Record<string, unknown>; actor_user_id: string | null }>("select entity_id, after, actor_user_id::text from audit_logs where action = 'residence_card.reminder_sent' and created_at >= $1 and entity_id = any($2::text[])", [startedAt, [w1.card, w2.card]]);
  const byCard = Object.fromEntries(rows.map((r) => [r.entity_id, r.after]));
  expect(byCard[w1.card]).toEqual({ stage: "h7", recipients: 2 });
  expect(byCard[w2.card]).toEqual({ stage: "h14", recipients: 2 });
  expect(rows.every((r) => r.actor_user_id === null)).toBe(true);
  const leaks = await ownerQuery<{ n: number }>("select count(*)::int as n from audit_logs where action = 'residence_card.reminder_sent' and created_at >= $1 and after::text ~ '@'", [startedAt]);
  expect(leaks[0].n).toBe(0);
});

test("dijalankan dua kali = tidak ada email ganda (sekali per kartu + tahap + penerima)", async () => {
  const before = (await inbox()).length;
  const s = await go();
  expect(s.emails).toBe(0);
  expect((await inbox()).length).toBe(before);
  const n = await ownerQuery<{ n: number }>("select count(*)::int as n from card_reminder_log where card_id = any($1::uuid[])", [[w1.card, w2.card]]);
  expect(n[0].n).toBe(4);
});

test("tahap baru = pengingat baru: kartu melewati tanggal habis (expired) dikirim lagi, sekali", async () => {
  await ownerQuery("update residence_cards set expiry_date = $2::date where id = $1", [w1.card, d(-2)]);
  await go();
  const msgs = about(await inbox(), w1.name);
  const expired = msgs.filter((m) => /sudah lewat|過ぎています/.test(m.text));
  expect(expired.flatMap((m) => m.to).sort()).toEqual(["tsk.admin@hashi.test", "tsk.staff@hashi.test"]);
  const again = await go();
  expect(again.emails).toBe(0);
  expect(about(await inbox(), w1.name).length).toBe(msgs.length);
});

test("mode kering (tanpa mailer): tidak ada email, tidak ada log pengiriman, baris log tanpa alamat email", async () => {
  await ownerQuery("update residence_cards set expiry_date = $2::date where id = $1", [w2.card, d(3)]); // h7 baru untuk w2
  const lines: string[] = [];
  const before = (await inbox()).length;
  const rowsBefore = (await ownerQuery<{ n: number }>("select count(*)::int as n from card_reminder_log"))[0].n;
  const s = await go({ mailer: null, log: (l) => lines.push(l) });
  expect(s.mode).toBe("dry-run");
  expect(s.emails).toBe(0);
  expect(s.items).toBeGreaterThan(0);
  expect((await inbox()).length).toBe(before);
  expect((await ownerQuery<{ n: number }>("select count(*)::int as n from card_reminder_log"))[0].n).toBe(rowsBefore);
  expect(lines.some((l) => /mode=dry-run akan dikirim/.test(l))).toBe(true);
  expect(lines.join("\n")).not.toMatch(/@|hashi\.test/);
});
