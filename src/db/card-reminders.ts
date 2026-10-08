// Email pengingat 在留カード (T-022). Logika murni (pemilihan, ringkasan per penerima, isi email, jadwal) + alur DB `runCardReminders` yang dipakai worker (scripts/reminder-worker.ts)
// dan tes. Hanya mengimpor dari src/db (aturan scripts/). Pemicu = tahap kartu (cardStage) masuk `prepare`, `can_apply`, `h30`, `h14`, `h7`, `expired`, `special_overdue`, `rejected`, serta tanda
// 追加資料 (`additional_docs`). SEKALI per (kartu, tahap, penerima): tabel `card_reminder_log` (unik). Satu email ringkasan per penerima per hari. Penerima = `cardRecipients` (担当 efektif + semua Admin TSK).
// Isi email: nama pekerja + tahap + sisa hari + tautan; TIDAK memuat nomor kartu, catatan, atau data lain. Bahasa sesuai `users.locale`.
import { and, eq, inArray } from "drizzle-orm";
import { sanitizeAuditPayload } from "./audit-values";
import { withSystem, withTenant, type Db } from "./index";
import { auditLogs, cardReminderLog, organizations, users } from "./schema";
import { cardRecipients, compareCardItems, type CardStage } from "./zairyu";
import { loadCardRows, type CardListRow } from "./zairyu-queries";

export const REMINDER_STAGES = ["prepare", "can_apply", "h30", "h14", "h7", "expired", "special_overdue", "rejected"] as const satisfies readonly CardStage[];
export type ReminderStage = (typeof REMINDER_STAGES)[number] | "additional_docs";

/** Jam kirim harian (zona Asia/Tokyo, tanpa DST). */
export const SEND_HOUR_JST = 8;
const JST_OFFSET_MS = 9 * 3600_000;

/** Tahap yang dikirimkan untuk satu baris daftar kartu (null = tidak ada pengingat). 追加資料 (menunggu hasil) didahulukan. */
export function reminderStageOf(r: Pick<CardListRow, "hasCard" | "stage" | "additionalDocs">): ReminderStage | null {
  if (!r.hasCard || !r.stage) return null;
  if (r.stage === "waiting_result") return r.additionalDocs ? "additional_docs" : null;
  return (REMINDER_STAGES as readonly string[]).includes(r.stage) ? (r.stage as ReminderStage) : null;
}

export type ReminderItem = { cardId: string; workerId: string; workerName: string; stage: ReminderStage; daysLeft: number | null };
export type Recipient = { id: string; email: string; locale: "id" | "ja"; name: string };

/** Kunci pengiriman yang sudah terkirim: `${cardId}:${stage}:${userId}`. */
export const sentKey = (cardId: string, stage: string, userId: string) => `${cardId}:${stage}:${userId}`;

/**
 * Rencana pengiriman hari ini (murni): untuk tiap penerima, kartu/tahap yang BELUM terkirim kepadanya. Penerima per kartu = `cardRecipients` (担当 + Admin).
 * Hasil per penerima diurutkan paling mendesak dulu. Penerima tanpa item tidak muncul.
 */
export function planReminders(rows: readonly CardListRow[], adminIds: readonly string[], sent: ReadonlySet<string>): Map<string, ReminderItem[]> {
  const plan = new Map<string, ReminderItem[]>();
  for (const r of rows) {
    const stage = reminderStageOf(r);
    if (!stage || !r.cardId) continue;
    for (const userId of cardRecipients({ responsibleStaffId: r.responsibleId, adminIds })) {
      if (sent.has(sentKey(r.cardId, stage, userId))) continue;
      plan.set(userId, [...(plan.get(userId) ?? []), { cardId: r.cardId, workerId: r.workerId, workerName: r.workerName, stage, daysLeft: r.daysLeft }]);
    }
  }
  const urgency = (s: ReminderStage) => (s === "additional_docs" ? "waiting_result" : s) as CardStage;
  for (const [id, items] of plan) {
    plan.set(id, [...items].sort((a, b) => compareCardItems({ stage: urgency(a.stage), daysLeft: a.daysLeft, name: a.workerName }, { stage: urgency(b.stage), daysLeft: b.daysLeft, name: b.workerName })));
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------------- isi email
type Locale = "id" | "ja";
const STAGE_TEXT: Record<ReminderStage, Record<Locale, string>> = {
  prepare: { id: "Mulai persiapan perpanjangan (sekitar 4 bulan sebelum habis)", ja: "更新準備を始める時期です（期限の約4か月前）" },
  can_apply: { id: "Pengajuan perpanjangan sudah bisa dimulai (sekitar 3 bulan sebelum habis)", ja: "更新申請を始められます（期限の約3か月前）" },
  h30: { id: "Sisa 30 hari sampai tanggal habis", ja: "在留期限まで30日です" },
  h14: { id: "Sisa 14 hari sampai tanggal habis", ja: "在留期限まで14日です" },
  h7: { id: "Sisa 7 hari sampai tanggal habis", ja: "在留期限まで7日です" },
  expired: { id: "Tanggal habis sudah lewat", ja: "在留期限を過ぎています" },
  special_overdue: { id: "Masa perpanjangan khusus (tokurei kikan) sudah lewat", ja: "特例期間を過ぎています" },
  rejected: { id: "Permohonan ditolak (fukyoka): perlu ditangani", ja: "不許可となりました：対応が必要です" },
  additional_docs: { id: "Imigrasi meminta dokumen tambahan (tsuika shiryo)", ja: "追加資料の提出依頼があります" },
};
const T = {
  subject: { id: (n: number) => `[Hashi] Pengingat kartu izin tinggal: ${n} pekerja perlu perhatian`, ja: (n: number) => `[Hashi] 在留カードのリマインダー：${n}名の対応が必要です` },
  greeting: { id: (name: string) => `Halo ${name},`, ja: (name: string) => `${name} 様` },
  intro: { id: "Berikut pekerja yang kartu izin tinggalnya perlu diurus hari ini:", ja: "本日、在留カードの手続きが必要な就労者は次のとおりです。" },
  open: { id: "Buka di Hashi", ja: "Hashiで開く" },
  daysLeft: { id: (d: number) => (d > 0 ? `sisa ${d} hari` : d === 0 ? "hari ini terakhir" : `lewat ${-d} hari`), ja: (d: number) => (d > 0 ? `残り${d}日` : d === 0 ? "本日が期限" : `${-d}日超過`) },
  footer: { id: "Email otomatis dari Hashi. Nomor kartu tidak pernah dikirim lewat email.", ja: "Hashiからの自動送信メールです。カード番号はメールで送信されません。" },
};

export type Digest = { subject: string; text: string; html: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Ringkasan satu penerima (murni): subjek, teks, HTML. `baseUrl` kosong = tanpa tautan. */
export function buildDigest(locale: Locale, recipientName: string, items: readonly ReminderItem[], baseUrl?: string | null): Digest {
  const base = baseUrl ? baseUrl.replace(/\/+$/, "") : null;
  const line = (i: ReminderItem) => `${i.workerName} — ${STAGE_TEXT[i.stage][locale]}${i.daysLeft !== null && i.stage !== "additional_docs" ? (locale === "ja" ? `（${T.daysLeft.ja(i.daysLeft)}）` : ` (${T.daysLeft.id(i.daysLeft)})`) : ""}`;
  const link = (i: ReminderItem) => (base ? `${base}/records/workers/${i.workerId}` : null);
  const text = [
    T.greeting[locale](recipientName), "", T.intro[locale], "",
    ...items.map((i) => `- ${line(i)}${link(i) ? `\n  ${T.open[locale]}: ${link(i)}` : ""}`),
    "", T.footer[locale], "",
  ].join("\n");
  const html = [
    `<p>${esc(T.greeting[locale](recipientName))}</p>`, `<p>${esc(T.intro[locale])}</p>`, "<ul>",
    ...items.map((i) => `<li>${esc(line(i))}${link(i) ? ` — <a href="${esc(link(i)!)}">${esc(T.open[locale])}</a>` : ""}</li>`),
    "</ul>", `<p style="color:#666;font-size:12px">${esc(T.footer[locale])}</p>`,
  ].join("\n");
  return { subject: T.subject[locale](items.length), text, html };
}

// ---------------------------------------------------------------------------------------------------- pengaman penerima + email uji (T-025)
/**
 * Pengaman penerima: alamat berdomain contoh/cadangan TIDAK dikirimi (akun demo `*@hashi.test`, `example.com/.org/.net`, `*.test`, `*.invalid`, `*.example`, `*.localhost`, `localhost`),
 * dan alamat yang bentuknya tidak sah. Mencegah email keluar ke alamat palsu dan memantul (reputasi pengirim) selama data demo masih ada.
 */
export function isSafeRecipient(email: string | null | undefined): boolean {
  const v = (email ?? "").trim().toLowerCase();
  const m = /^[^\s@]+@([^\s@]+)$/.exec(v);
  if (!m) return false;
  const host = m[1].replace(/\.$/, "");
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return false;
  if (host === "localhost" || /\.(test|invalid|example|localhost)$/.test(host)) return false;
  return !/(^|\.)example\.(com|org|net)$/.test(host);
}

/** Argumen `--test-to <alamat>` (kirim SATU email uji lalu keluar). null = tidak diminta; "invalid" = alamat tidak sah/kosong. */
export function parseTestTo(argv: readonly string[]): string | null | "invalid" {
  const i = argv.indexOf("--test-to");
  if (i < 0) return null;
  const v = (argv[i + 1] ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && !v.startsWith("--") ? v : "invalid";
}

/** Email uji (data PALSU, tanpa membaca kartu): membuktikan SMTP, bahasa, dan tampilan. */
export function buildTestEmail(locale: Locale, baseUrl?: string | null): Digest {
  const items: ReminderItem[] = [
    { cardId: "uji-1", workerId: "00000000-0000-0000-0000-000000000001", workerName: locale === "ja" ? "テスト 太郎（ダミー）" : "Pekerja Contoh (data palsu)", stage: "h14", daysLeft: 12 },
    { cardId: "uji-2", workerId: "00000000-0000-0000-0000-000000000002", workerName: locale === "ja" ? "テスト 花子（ダミー）" : "Pekerja Contoh Dua (data palsu)", stage: "additional_docs", daysLeft: null },
  ];
  const d = buildDigest(locale, locale === "ja" ? "ご担当者" : "Pengguna Hashi", items, baseUrl);
  return { ...d, subject: `[Hashi] ${locale === "ja" ? "テストメール" : "Email uji"}: ${d.subject.replace("[Hashi] ", "")}` };
}

export type RecipientReadiness = { tskActive: number; adminsActive: number; wouldSend: number; wouldSkip: number; demoAccounts: number };
/** Pemeriksaan sebelum pengiriman diaktifkan (hanya ANGKA, tanpa alamat): berapa penerima TSK aktif, berapa yang akan dilewati pengaman, dan apakah masih ada akun demo. */
export async function recipientReadiness(db?: Db): Promise<RecipientReadiness> {
  const rows = await withSystem(
    (tx) => tx.select({ email: users.email, role: users.role }).from(users).innerJoin(organizations, eq(organizations.id, users.organizationId)).where(and(eq(organizations.type, "TSK"), eq(users.active, true))),
    db,
  );
  const safe = rows.filter((r) => isSafeRecipient(r.email)).length;
  const demo = await withSystem((tx) => tx.select({ email: users.email }).from(users), db);
  return { tskActive: rows.length, adminsActive: rows.filter((r) => r.role === "TSK_ADMIN").length, wouldSend: safe, wouldSkip: rows.length - safe, demoAccounts: demo.filter((u) => /@hashi\.test$/i.test(u.email)).length };
}

// ---------------------------------------------------------------------------------------------------- jadwal
/** Tanggal kalender di Tokyo (YYYY-MM-DD) pada saat `now`. */
export const tokyoDate = (now: Date): string => new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
/** Saat `now` sudah lewat jam kirim hari ini (Tokyo)? Dipakai worker untuk mengejar pengiriman yang terlewat saat dimulai ulang. */
export const afterSendTimeToday = (now: Date): boolean => new Date(now.getTime() + JST_OFFSET_MS).getUTCHours() >= SEND_HOUR_JST;
/** Waktu kirim berikutnya SETELAH `now`: jam 08:00 Tokyo (hari ini bila belum lewat, kalau tidak besok). */
export function nextRunAfter(now: Date): Date {
  const j = new Date(now.getTime() + JST_OFFSET_MS);
  let target = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), SEND_HOUR_JST) - JST_OFFSET_MS;
  if (target <= now.getTime()) target += 24 * 3600_000;
  return new Date(target);
}

// ---------------------------------------------------------------------------------------------------- alur DB
export type Mailer = { sendMail(msg: { from: string; to: string; subject: string; text: string; html: string }): Promise<unknown> };
export type RunOptions = {
  /** Tanpa mailer = MODE KERING: tidak ada email dan tidak ada log pengiriman; hanya dicatat "akan dikirim" (tanpa alamat). */
  mailer?: Mailer | null;
  from?: string;
  baseUrl?: string | null;
  /** HANYA untuk tes/dev (Mailpit): kirim juga ke alamat berdomain contoh/.test. Worker produksi tidak memasangnya (kecuali env REMINDER_ALLOW_TEST_RECIPIENTS=1, tidak ada di compose). */
  allowTestRecipients?: boolean;
  now?: Date;
  db?: Db;
  log?: (line: string) => void;
};
export type RunSummary = { today: string; mode: "send" | "dry-run"; orgs: number; recipients: number; emails: number; items: number; failed: number; skipped: number };

/**
 * Jalankan satu putaran untuk SEMUA organisasi TSK. Data kartu dibaca lewat withTenant sebagai Admin TSK organisasi itu (aturan RLS yang sama dengan halaman: satu sumber dengan daftar/KPI).
 * Log pengiriman dan audit ditulis lewat withSystem SETELAH email terkirim ke penerima itu (gagal kirim = tidak dicatat, besok dicoba lagi).
 */
export async function runCardReminders(opts: RunOptions = {}): Promise<RunSummary> {
  const now = opts.now ?? new Date();
  const today = tokyoDate(now);
  const log = opts.log ?? ((l: string) => console.log(l));
  const mode = opts.mailer ? "send" : "dry-run";
  const summary: RunSummary = { today, mode, orgs: 0, recipients: 0, emails: 0, items: 0, failed: 0, skipped: 0 };
  const orgs = await withSystem((tx) => tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.type, "TSK")), opts.db);

  for (const org of orgs) {
    const staff = await withSystem((tx) => tx.select({ id: users.id, email: users.email, name: users.name, role: users.role, locale: users.locale }).from(users).where(and(eq(users.organizationId, org.id), eq(users.active, true))), opts.db);
    const admins = staff.filter((u) => u.role === "TSK_ADMIN");
    if (admins.length === 0) continue;
    summary.orgs++;
    const rows = await withTenant({ orgId: org.id, role: "TSK_ADMIN", userId: admins[0].id }, (tx) => loadCardRows(tx, today), opts.db);
    // log pengiriman hanya terbaca jalur sistem (RLS tanpa policy untuk peran aplikasi), jadi dibaca lewat withSystem
    const cardIds = rows.map((r) => r.cardId).filter((x): x is string => !!x);
    const logged = cardIds.length ? await withSystem((tx) => tx.select({ cardId: cardReminderLog.cardId, stage: cardReminderLog.stage, userId: cardReminderLog.userId }).from(cardReminderLog).where(and(eq(cardReminderLog.organizationId, org.id), inArray(cardReminderLog.cardId, cardIds))), opts.db) : [];
    const sent = new Set(logged.map((l) => sentKey(l.cardId, l.stage, l.userId)));
    const plan = planReminders(rows, admins.map((a) => a.id), sent);
    const byId = new Map(staff.map((u) => [u.id, u]));
    const delivered = new Map<string, number>(); // `${cardId}:${stage}` -> jumlah penerima yang terkirim

    for (const [userId, items] of plan) {
      const to = byId.get(userId);
      if (!to) continue; // penerima nonaktif / bukan staf organisasi ini: tidak dikirimi
      if (!opts.allowTestRecipients && !isSafeRecipient(to.email)) {
        summary.skipped++; // alamat contoh/demo: dilewati, tidak dihitung sebagai penerima dan tidak dicatat di log pengiriman
        continue;
      }
      summary.recipients++;
      summary.items += items.length;
      if (!opts.mailer) {
        log(`[reminder] ${today} mode=dry-run akan dikirim: 1 email ringkasan (${items.length} pekerja, bahasa ${to.locale}) ke 1 penerima (org ${org.id.slice(0, 8)}); tidak ada email terkirim`);
        continue;
      }
      const digest = buildDigest(to.locale, to.name, items, opts.baseUrl);
      try {
        await opts.mailer.sendMail({ from: opts.from ?? "Hashi <noreply@localhost>", to: to.email, subject: digest.subject, text: digest.text, html: digest.html });
      } catch (err) {
        summary.failed++;
        log(`[reminder] ${today} GAGAL kirim ke 1 penerima (org ${org.id.slice(0, 8)}): ${err instanceof Error ? err.name : "error"}; dicoba lagi pada putaran berikutnya`);
        continue;
      }
      summary.emails++;
      await withSystem((tx) => tx.insert(cardReminderLog).values(items.map((i) => ({ organizationId: org.id, cardId: i.cardId, stage: i.stage, userId, sentOn: today }))).onConflictDoNothing(), opts.db);
      for (const i of items) delivered.set(`${i.cardId}:${i.stage}`, (delivered.get(`${i.cardId}:${i.stage}`) ?? 0) + 1);
    }

    if (delivered.size > 0) {
      await withSystem(
        (tx) =>
          tx.insert(auditLogs).values(
            [...delivered].map(([k, n]) => {
              const [cardId, stage] = k.split(":");
              return {
                organizationId: org.id, actorOrgId: org.id, actorUserId: null, actorName: "Hashi (otomatis)", actorRole: null, actorOrgName: null,
                action: "residence_card.reminder_sent", entity: "residence_card", entityId: cardId, before: null, after: sanitizeAuditPayload("residence_card", { stage, recipients: n }),
              };
            }),
          ),
        opts.db,
      );
    }
  }
  log(`[reminder] ${today} selesai mode=${mode} org=${summary.orgs} penerima=${summary.recipients} email=${summary.emails} item=${summary.items} gagal=${summary.failed} dilewati=${summary.skipped}`);
  return summary;
}
