// Data DEMO Catatan kegiatan TSK (langkah 7A): catatan ①/②, kasus + kronologi, tugas, laporan harian, tanda baca, wawancara berkala, lampiran.
// Dipakai (1) scripts/seed.ts untuk lingkungan baru dan (2) scripts/seed-records.ts yang MENAMBAH di atas data yang sudah ada (produksi/demo, TANPA reseed).
// Semua isi karangan. Id deterministik. Berjalan di koneksi OWNER (RLS dilewati); trigger tetap berjalan (kode kasus, versi, riwayat).
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "./index";
import {
  activityAttachments, activityCaseSubjects, activityCases, activityDailyReportRecipients, activityDailyReports, activityFollowups, activityRecordHandlers,
  activityRecordReads, activityRecordRecipients, activityRecordSubjects, activityRecords, caseTimelineEvents, candidateSelections, candidates, clientCompanies,
  clientSiteContacts, clientSites, jobOrders, organizations, partnerships, periodicInterviewQuarterNotes, periodicInterviews, placements, users,
} from "./schema";
import { fiscalMonths, fiscalYearOf, quarterOfMonth } from "./records-core";
import { addDays, uuidFor } from "./demo-rng";

export const DUMMY_ORG_NAME = /^(Hashi Platform|TSK Demo Tokyo|LPK Demo Bandung|LPK Demo Surabaya|LPK Non-Mitra Medan)$|E2E/;

export type SeedRecordsOpts = { today: string; now?: Date; passwordHash: string; force?: boolean };
export type SeedRecordsResult = { files: Array<{ orgId: string; id: string; ext: "png"; data: Buffer }>; summary: Record<string, number>; notes: string[] };

const T = (n: string) => uuidFor(`rec7a:${n}`);
const JST_OFFSET = "+09:00";

/** Tabel fitur sudah berisi? (dipakai penolakan idempotensi) */
export async function recordsTablesNotEmpty(tx: Tx): Promise<boolean> {
  const r = await tx.execute(sql`select (select count(*) from activity_records) + (select count(*) from activity_cases) + (select count(*) from periodic_interviews) + (select count(*) from activity_followups) as n`);
  return Number((r.rows[0] as { n: string }).n) > 0;
}

export async function seedRecords(tx: Tx, opts: SeedRecordsOpts, dummyPng: () => Buffer): Promise<SeedRecordsResult> {
  const notes: string[] = [];
  const now = opts.now ?? new Date();
  const [tsk] = await tx.select().from(organizations).where(eq(organizations.type, "TSK")).limit(1);
  if (!tsk) throw new Error("Organisasi TSK tidak ada: jalankan seed dasar dulu");
  const orgId = tsk.id;
  const act = (userId: string, role: string) => tx.execute(sql`select set_config('app.user_id', ${userId}, true), set_config('app.role', ${role}, true), set_config('app.org_id', ${orgId}, true)`);

  // ---- Staf: butuh minimal 3 staf TSK (3 pengirim laporan harian). Tambah 1 staf dummy bila hanya ada 2.
  let staff = await tx.select({ id: users.id, name: users.name, role: users.role, email: users.email }).from(users).where(and(eq(users.organizationId, orgId), inArray(users.role, ["TSK_ADMIN", "TSK_STAFF"])));
  if (staff.length < 3) {
    const id = T("user:tsk.staff2");
    await tx.insert(users).values({ id, organizationId: orgId, email: "tsk.staff2@hashi.test", name: "佐藤 美香", role: "TSK_STAFF", locale: "ja", languages: ["ja", "id"], passwordHash: opts.passwordHash }).onConflictDoNothing();
    notes.push("Menambah 1 pengguna dummy tsk.staff2@hashi.test (TSK_STAFF) agar ada 3 staf pengirim laporan harian.");
    staff = await tx.select({ id: users.id, name: users.name, role: users.role, email: users.email }).from(users).where(and(eq(users.organizationId, orgId), inArray(users.role, ["TSK_ADMIN", "TSK_STAFF"])));
  }
  const admin = staff.find((s) => s.role === "TSK_ADMIN")!;
  const others = staff.filter((s) => s.id !== admin.id).sort((a, b) => a.email.localeCompare(b.email));
  const [s1, s2] = [others[0], others[1] ?? others[0]];

  // ---- Pekerja aktif: minimal 3 dari 2 lokasi. Bila kurang, tambah SATU keputusan DEPARTED (trigger membuat penempatan) pada kandidat READY yang terlihat.
  const activeCount = async () => (await tx.select({ id: placements.id }).from(placements).where(eq(placements.status, "ACTIVE"))).length;
  if ((await activeCount()) < 3) {
    const placed = new Set((await tx.select({ c: placements.candidateId }).from(placements)).map((p) => p.c));
    // hanya kandidat dari LPK MITRA AKTIF yang dibagikan (TSK memang melihatnya); LPK non-mitra tidak boleh punya pekerja di TSK ini
    const partners = (await tx.select({ lpk: partnerships.lpkId }).from(partnerships).where(and(eq(partnerships.tskId, orgId), eq(partnerships.active, true)))).map((p) => p.lpk);
    const cands = (await tx.select({ id: candidates.id, fieldId: candidates.fieldId, org: candidates.organizationId }).from(candidates).where(and(eq(candidates.stage, "READY"), eq(candidates.sharedWithTsk, true)))).filter((c) => partners.includes(c.org));
    const sels = await tx.select({ c: candidateSelections.candidateId, d: candidateSelections.decision }).from(candidateSelections).where(eq(candidateSelections.tskOrgId, orgId));
    const blocked = new Set(sels.filter((x) => ["DEPARTED", "DOCUMENT_PROCESS", "REJECTED", "PASSED_CLIENT_INTERVIEW"].includes(x.d)).map((x) => x.c));
    const cand = cands.filter((c) => !placed.has(c.id) && !blocked.has(c.id)).sort((a, b) => a.id.localeCompare(b.id))[0];
    const jo = (await tx.select({ id: jobOrders.id, siteId: jobOrders.siteId }).from(jobOrders).where(and(eq(jobOrders.orgId, orgId), eq(jobOrders.status, "OPEN")))).sort((a, b) => a.id.localeCompare(b.id));
    const activeSites = new Set((await tx.select({ s: placements.siteId }).from(placements).where(eq(placements.status, "ACTIVE"))).map((p) => p.s));
    const target = jo.find((j) => !activeSites.has(j.siteId)) ?? jo[0];
    if (cand && target) {
      await tx.insert(candidateSelections).values({ candidateId: cand.id, tskOrgId: orgId, jobOrderId: target.id, decision: "DEPARTED", decidedBy: admin.id });
      await tx.execute(sql`update placements set start_date = ${addDays(opts.today, -150)}::date where candidate_id = ${cand.id}::uuid and status = 'ACTIVE'`);
      notes.push("Menambah 1 keputusan DEPARTED (dan penempatan otomatis) agar ada minimal 3 pekerja aktif.");
    }
  }
  const workers = (await tx
    .select({ id: candidates.id, name: candidates.fullName, siteId: placements.siteId, startDate: placements.startDate })
    .from(placements).innerJoin(candidates, eq(candidates.id, placements.candidateId)).where(eq(placements.status, "ACTIVE")))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (workers.length < 3) throw new Error(`Hanya ${workers.length} pekerja aktif; butuh minimal 3`);
  const [w0, w1, w2] = workers;
  const companies = await tx.select({ id: clientCompanies.id, name: clientCompanies.name }).from(clientCompanies).where(eq(clientCompanies.orgId, orgId));
  const siteCompany = new Map((await tx.select({ id: clientSites.id, company: clientSites.companyId }).from(clientSites)).map((s) => [s.id, s.company]));

  const at = (daysAgo: number, hoursAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000 - hoursAgo * 3_600_000);
  const dayStr = (daysAgo: number) => addDays(opts.today, -daysAgo);
  const jst = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00${JST_OFFSET}`);
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const files: SeedRecordsResult["files"] = [];

  // ================= Kasus (2) + kronologi =================
  const caseA = T("case:A");
  const caseB = T("case:B");
  await tx.insert(activityCases).values({ id: caseA, organizationId: orgId, createdBy: s1.id, code: "", title: "寮の騒音トラブル", category: "trouble", openedAt: at(2, 5), createdAt: at(2, 5), updatedAt: at(2, 5) }).onConflictDoNothing();
  await tx.insert(activityCases).values({ id: caseB, organizationId: orgId, createdBy: admin.id, code: "", title: "通院の同行と診断結果の共有", category: "hospital", openedAt: at(8, 3), createdAt: at(8, 3), updatedAt: at(8, 3) }).onConflictDoNothing();
  await tx.insert(activityCaseSubjects).values([{ caseId: caseA, candidateId: w0.id, organizationId: orgId }, { caseId: caseB, candidateId: w1.id, organizationId: orgId }]).onConflictDoNothing();
  bump("cases", 2);
  // ================= Catatan ① (12) =================
  type Daily = { key: string; d: number; by: typeof admin; ws: Array<typeof w0>; type: string; other?: string; action: string; result: string; pending?: string; next?: string; reportTo?: string; note?: string; ago: number };
  const daily: Daily[] = [
    { key: "d1", d: 4, by: s1, ws: [w0], type: "interview", action: "電話で本人と面談し、勤務状況と寮での生活について確認した。", result: "問題なし。仕事にも慣れてきたとのこと。", next: "来月、定期面談を実施する。", ago: 5 },
    { key: "d2", d: 4, by: s2, ws: [w1], type: "consultation", action: "休日の過ごし方と交通手段についての相談に対応した。", result: "最寄りの駅までの行き方を案内し、本人は納得した。", ago: 4 },
    { key: "d3", d: 3, by: s1, ws: [w0, w1], type: "hospital_visit", action: "通院に同行し、診察の通訳をした。", result: "軽い風邪。薬を処方され、数日休養すれば問題ないとの診断。", pending: "次回の受診日を確認する。", next: "翌日に体調を電話で確認する。", reportTo: "配属先の担当者へ口頭で共有済み", ago: 6 },
    { key: "d4", d: 3, by: admin, ws: [w2], type: "residence_card", action: "在留カードの有効期限を本人と確認した。", result: "有効期限は来年。更新の準備はまだ不要。", next: "期限の4か月前に再確認する。", ago: 3 },
    { key: "d5", d: 2, by: s1, ws: [w0], type: "consultation", action: "寮の隣室の騒音について本人から相談を受けた。", result: "状況を詳しく聞き取った。夜間の騒音で睡眠不足とのこと。", pending: "寮の管理者へ連絡する。", next: "配属先の担当者と打合せを設定する。", note: "ケースとして時系列に記録する。", ago: 5 },
    { key: "d6", d: 2, by: s2, ws: [w2], type: "other", other: "備品の受け取り確認", action: "届いた作業靴を本人に渡し、サイズを確認した。", result: "サイズは問題なし。", ago: 4 },
    { key: "d7", d: 1, by: admin, ws: [w0], type: "interview", action: "配属先の担当者と本人を交えて三者で面談した。", result: "騒音の件を配属先に伝え、部屋の変更を検討してもらうことになった。", pending: "部屋の変更の可否を配属先に確認する。", next: "来週、結果を本人に報告する。", ago: 6 },
    { key: "d8", d: 1, by: s1, ws: [w1], type: "consultation", action: "給与明細の控除項目について質問があり、説明した。", result: "社会保険料と寮費の内訳を説明し、理解を得た。", ago: 3 },
    { key: "d9", d: 1, by: s2, ws: [w2], type: "interview", action: "月次の電話面談を行った。", result: "体調・仕事ともに問題なし。", next: "来月も継続して確認する。", ago: 5 },
    { key: "d10", d: 0, by: s1, ws: [w0], type: "consultation", action: "騒音の件の進捗を本人に電話で伝えた。", result: "配属先が来週から別の部屋を用意してくれるとのこと。本人は安心した様子。", next: "引っ越し当日に様子を確認する。", ago: 4 },
    { key: "d11", d: 0, by: s2, ws: [w1], type: "other", other: "役所の手続きの同行", action: "市役所での住民票の手続きに同行した。", result: "手続きは完了した。", ago: 3 },
    { key: "d12", d: 0, by: s2, ws: [w2], type: "consultation", action: "帰国前の一時帰国の手続きについて相談を受けた。", result: "必要な書類と日程の目安を案内した。", pending: "会社への休暇申請の確認。", ago: 0.3 },
    // lanjutan dari d10 (T-007 "Lanjutkan"): pekerja, lokasi, dan kasus sama
    { key: "d13", d: 0, by: s1, ws: [w0], type: "interview", action: "引っ越し当日に、新しい部屋での様子を電話で確認した。", result: "荷物の移動は完了し、新しい部屋では静かに過ごせているとのこと。", next: "1週間後に、もう一度状況を確認する。", ago: 0.2 },
  ];
  // catatan lanjutan: kunci -> kunci catatan asal (asal selalu didefinisikan LEBIH DULU; pekerja yang sama diperiksa trigger saat commit)
  const continuesOf: Record<string, string> = { d13: "d10" };
  const rid = (k: string) => T(`record:${k}`);
  const caseOfKey: Record<string, string> = { d5: caseA, d7: caseA, d10: caseA, d13: caseA, m2: caseA, m4: caseA, d3: caseB };
  const siteOf = (w: typeof w0) => w.siteId;
  for (const r of daily) {
    await tx.insert(activityRecords).values({
      id: rid(r.key), organizationId: orgId, createdBy: r.by.id, authorId: r.by.id, kind: "daily_work", recordDate: dayStr(r.d), clientSiteId: siteOf(r.ws[0]), caseId: caseOfKey[r.key] ?? null, continuesRecordId: continuesOf[r.key] ? rid(continuesOf[r.key]) : null,
      workType: r.type, workTypeOther: r.other ?? null, actionTaken: r.action, result: r.result, pending: r.pending ?? null, nextAction: r.next ?? null, reportToText: r.reportTo ?? null, note: r.note ?? null,
      createdAt: at(r.d, r.ago), updatedAt: at(r.d, r.ago),
    }).onConflictDoNothing();
    await tx.insert(activityRecordSubjects).values(r.ws.map((w) => ({ recordId: rid(r.key), candidateId: w.id, organizationId: orgId }))).onConflictDoNothing();
    bump("records.daily");
    if (continuesOf[r.key]) bump("records.continued");
  }
  // penerima "diminta membaca" (共有・報告先 dalam aplikasi)
  for (const [k, u] of [["d5", admin], ["d7", s2], ["d3", admin], ["d10", admin]] as const) {
    await tx.insert(activityRecordRecipients).values({ recordId: rid(k), userId: u.id, organizationId: orgId }).onConflictDoNothing();
  }

  // ================= Notulen ② (4) =================
  type Meet = { key: string; d: number; hour: number; by: typeof admin; subject: string; ws: Array<typeof w0>; method: string; party: "client" | "worker"; companyId: string | null; handlers: Array<typeof admin>; sections: Record<string, string[]> };
  const co = (w: typeof w0) => siteCompany.get(w.siteId) ?? companies[0]?.id ?? null;
  const meets: Meet[] = [
    { key: "m1", d: 3, hour: 14, by: admin, subject: "新規配属に関する打合せ", ws: [w2], method: "visit", party: "client", companyId: co(w2), handlers: [admin, s1], sections: { consultation: ["受け入れ時の安全教育の内容を確認した。", "勤務シフトと休憩時間について説明を受けた。"], currentStatus: ["本人は配属後2か月で、業務に慣れてきている。"], nextAction: ["来月、現場を訪問して様子を確認する。"], shared: ["夜勤は月4回程度。"] }, },
    { key: "m2", d: 2, hour: 11, by: s1, subject: "寮の騒音トラブルについて（配属先との打合せ）", ws: [w0], method: "online", party: "client", companyId: co(w0), handlers: [s1, admin], sections: { consultation: ["隣室の騒音で本人が眠れていないことを伝えた。"], workerView: ["「夜中の物音で朝がつらい」と話している。"], currentStatus: ["寮の管理者はまだ状況を把握していなかった。"], actionTaken: ["配属先の担当者から寮の管理者へ連絡してもらうことになった。"], nextAction: ["部屋の変更の可否を来週までに回答してもらう。"], pending: ["部屋の変更の最終決定。"] } },
    { key: "m3", d: 1, hour: 16, by: s2, subject: "月次の勤務状況の確認", ws: [w1, w2], method: "phone", party: "client", companyId: co(w1), handlers: [s2], sections: { currentStatus: ["2名とも出勤状況は良好。"], shared: ["来月から繁忙期のため残業が増える見込み。"], nextAction: ["残業時間の上限を本人たちに説明する。"] } },
    { key: "m4", d: 0, hour: 10, by: s1, subject: "本人との面談（生活面の相談）", ws: [w0], method: "in_person", party: "worker", companyId: null, handlers: [s1], sections: { consultation: ["新しい部屋への引っ越しの手順を説明した。"], workerView: ["引っ越しの日は仕事を休みたいと希望している。"], actionTaken: ["配属先に休暇の可否を確認することにした。"], pending: ["引っ越し日の休暇の承認。"] } },
  ];
  for (const m of meets) {
    const day = dayStr(m.d);
    const start = jst(day, `${String(m.hour).padStart(2, "0")}:00`);
    await tx.insert(activityRecords).values({
      id: rid(m.key), organizationId: orgId, createdBy: m.by.id, authorId: m.by.id, kind: "meeting", recordDate: day, clientSiteId: siteOf(m.ws[0]), caseId: caseOfKey[m.key] ?? null, subject: m.subject, startedAt: start, endedAt: new Date(start.getTime() + 60 * 60_000),
      method: m.method, counterparty: m.party, clientCompanyId: m.companyId, sections: m.sections, createdAt: at(m.d, 1), updatedAt: at(m.d, 1),
    }).onConflictDoNothing();
    await tx.insert(activityRecordSubjects).values(m.ws.map((w) => ({ recordId: rid(m.key), candidateId: w.id, organizationId: orgId }))).onConflictDoNothing();
    await tx.insert(activityRecordHandlers).values(m.handlers.map((h) => ({ recordId: rid(m.key), userId: h.id, organizationId: orgId }))).onConflictDoNothing();
    bump("records.meeting");
  }

  type Ev = { key: string; day: number; hm: string | null; event: string; subj?: string; comp?: string; note?: string; by: typeof admin; source?: string; client?: boolean; void?: string };
  const evs: Ev[] = [
    { key: "e1", day: 4, hm: "22:30", event: "夜間（22時半ごろ）、隣室から大きな物音がして、本人が眠れなかった。", subj: "「毎晩のように夜中まで音がして、朝がつらい」と話した。", comp: "状況を聞き取り、記録した。", by: s1, source: "d5" },
    { key: "e2", day: 3, hm: "09:15", event: "本人が睡眠不足のまま出勤。作業中に集中力が落ちているとの連絡が配属先からあった。", subj: "「仕事でミスをしないか不安」と述べた。", comp: "配属先の担当者に状況を共有した。", note: "配属先は安全面を心配している。", by: s1, client: true },
    { key: "e3", day: 2, hm: "11:00", event: "配属先とオンラインで打合せを実施。寮の管理者への連絡を依頼した。", comp: "部屋の変更の可否を来週までに回答してもらうよう依頼した。", by: s1, source: "m2" },
    { key: "e4", day: 1, hm: "16:00", event: "三者面談を実施。配属先が別の部屋の確保を検討することになった。", subj: "「部屋が変われば安心して眠れる」と述べた。", comp: "結果を後日、本人に報告することを伝えた。", note: "社内メモ：寮の管理者との関係に配慮が必要。", by: admin, source: "d7", client: false },
    { key: "e5", day: 0, hm: null, event: "配属先から、来週から別の部屋を用意できるとの連絡があった。", comp: "本人に電話で伝えた。引っ越しの手順を案内する。", by: s1, source: "d10" },
    { key: "e6", day: 0, hm: null, event: "誤って別の就労者の件を記入した行。", by: s2, void: "別の就労者の内容を誤って記入したため" },
  ];
  for (const e of evs) {
    const when = e.hm ? jst(dayStr(e.day), e.hm) : jst(dayStr(e.day), "00:00");
    await tx.insert(caseTimelineEvents).values({
      id: T(`event:${e.key}`), organizationId: orgId, createdBy: e.by.id, caseId: caseA, occurredAt: when, timeKnown: Boolean(e.hm), event: e.event, subjectStatement: e.subj ?? null, companyResponse: e.comp ?? null, note: e.note ?? null,
      sourceRecordId: e.source ? rid(e.source) : null, includeInClientExport: e.client ?? true, createdAt: at(e.day, 2), updatedAt: at(e.day, 2),
    }).onConflictDoNothing();
    bump("events.A");
  }
  const evB = [
    { key: "b1", day: 8, hm: "10:00", event: "本人が体調不良を訴え、通院に同行した。", subj: "「熱があって、のどが痛い」と話した。", comp: "病院で受付と通訳を担当した。" },
    { key: "b2", day: 8, hm: "13:00", event: "診察の結果、軽い風邪と診断された。", comp: "診断結果を配属先の担当者に共有した。" },
    { key: "b3", day: 6, hm: null, event: "体調が回復し、通常勤務に復帰した。", subj: "「もう大丈夫です」と述べた。", comp: "復帰を配属先に確認した。" },
  ];
  for (const e of evB) {
    await tx.insert(caseTimelineEvents).values({ id: T(`event:${e.key}`), organizationId: orgId, createdBy: admin.id, caseId: caseB, occurredAt: e.hm ? jst(dayStr(e.day), e.hm) : jst(dayStr(e.day), "00:00"), timeKnown: Boolean(e.hm), event: e.event, subjectStatement: e.subj ?? null, companyResponse: e.comp ?? null, createdAt: at(e.day, 2), updatedAt: at(e.day, 2) }).onConflictDoNothing();
    bump("events.B");
  }

  // ================= Edit: satu catatan dengan 2 versi, satu dibatalkan, satu kronologi dibatalkan, kasus B ditutup =================
  await act(s1.id, "TSK_STAFF");
  await tx.execute(sql`update activity_records set result = ${"問題なし。仕事にも慣れてきたとのこと。寮の食事にも満足している。"}, next_action = ${"来月、定期面談を実施し、体調も確認する。"} where id = ${rid("d1")}::uuid`);
  await act(s2.id, "TSK_STAFF");
  await tx.execute(sql`update activity_records set status = 'void', void_reason = ${"対象者を誤って選択したため（正しい記録を別途作成済み）"} where id = ${rid("d6")}::uuid`);
  await tx.execute(sql`update case_timeline_events set status = 'void', void_reason = ${evs[5].void!} where id = ${T("event:e6")}::uuid`);
  await act(admin.id, "TSK_ADMIN");
  await tx.execute(sql`update activity_cases set status = 'closed' where id = ${caseB}::uuid`);
  // d12 (staf2, hari ini): diedit SETELAH laporan hari ini dikirim -> penanda "diedit setelah dikirim"
  await act(s2.id, "TSK_STAFF");

  // ================= Laporan harian (3 staf) =================
  const rep = (k: string) => T(`report:${k}`);
  const todayShared = at(0, 1.5);
  await tx.insert(activityDailyReports).values([
    { id: rep("s2-today"), organizationId: orgId, createdBy: s2.id, authorId: s2.id, reportDate: dayStr(0), sharedAt: todayShared, sharedBy: s2.id, createdAt: at(0, 2) },
    { id: rep("s1-y"), organizationId: orgId, createdBy: s1.id, authorId: s1.id, reportDate: dayStr(1), sharedAt: at(1, 0.5), sharedBy: s1.id, createdAt: at(1, 1) },
    { id: rep("adm-y"), organizationId: orgId, createdBy: admin.id, authorId: admin.id, reportDate: dayStr(1), sharedAt: at(1, 0.2), sharedBy: admin.id, createdAt: at(1, 1) },
  ]).onConflictDoNothing();
  await tx.insert(activityDailyReportRecipients).values([
    { reportId: rep("s2-today"), userId: admin.id, organizationId: orgId },
    { reportId: rep("s2-today"), userId: s1.id, organizationId: orgId, readAt: at(0, 1), readSharedAt: todayShared },
    { reportId: rep("s1-y"), userId: admin.id, organizationId: orgId, readAt: at(1, 0), readSharedAt: at(1, 0.5) },
    { reportId: rep("adm-y"), userId: s2.id, organizationId: orgId },
    { reportId: rep("adm-y"), userId: s1.id, organizationId: orgId, readAt: at(0, 20), readSharedAt: at(1, 0.2) },
  ]).onConflictDoNothing();
  bump("reports", 3);
  // d12 dibuat SETELAH laporan dikirim (at(0,0.3) > todayShared) = "ditambahkan setelah dikirim"; d11 diedit setelah dikirim:
  await tx.execute(sql`update activity_records set action_taken = ${"市役所での住民票の手続きに同行し、必要書類の確認も行った。"} where id = ${rid("d11")}::uuid`);

  // ================= Tanda baca (campuran) =================
  const reads: Array<[string, typeof admin, number, number]> = [
    ["d1", admin, 1, 0], ["d2", admin, 1, 0], ["d4", s1, 1, 0], ["d5", admin, 1, 0], ["d7", s1, 1, 0], ["d7", s2, 1, 0], ["d9", admin, 1, 0], ["m1", s1, 1, 0], ["m1", s2, 1, 0], ["m2", admin, 1, 0], ["m3", admin, 1, 0],
  ];
  for (const [k, u, v] of reads) {
    await tx.insert(activityRecordReads).values({ recordId: rid(k), userId: u.id, organizationId: orgId, versionNoRead: v, readAt: at(0, 2) }).onConflictDoNothing();
  }
  // d1 diedit (versi 2) setelah dibaca admin pada versi 1 -> "Diperbarui sejak kamu baca" bagi admin
  bump("reads", reads.length);

  // ================= Tugas tindak lanjut (6) =================
  const fu = (k: string) => T(`followup:${k}`);
  const tasks = [
    { k: "t1", rec: rid("d5"), desc: "寮の管理者へ騒音の件を連絡する。", who: s1, due: dayStr(1), status: "done", by: s1 },
    { k: "t2", case: caseA, desc: "新しい部屋への引っ越し当日に本人の様子を確認する。", who: s1, due: dayStr(-3), status: "open", by: admin },
    { k: "t3", rec: rid("d3"), desc: "次回の受診日を本人に確認する。", who: s2, due: dayStr(2), status: "open", by: s2 },
    { k: "t4", rec: rid("d12"), desc: "一時帰国の休暇申請について会社に確認する。", who: s2, due: dayStr(-1), status: "open", by: s2 },
    { k: "t5", rec: rid("d4"), desc: "在留カードの更新時期を再確認する（期限の4か月前）。", who: admin, due: dayStr(-120), status: "open", by: admin },
    { k: "t6", case: caseA, desc: "寮の管理者との関係について社内で方針を共有する。", who: admin, due: dayStr(3), status: "cancelled", by: admin },
  ];
  for (const t of tasks) {
    await tx.insert(activityFollowups).values({
      id: fu(t.k), organizationId: orgId, createdBy: t.by.id, recordId: t.rec ?? null, caseId: t.case ?? null, description: t.desc, assigneeId: t.who.id, dueDate: t.due, createdAt: at(1, 5),
    }).onConflictDoNothing();
    bump("followups");
  }
  await tx.execute(sql`update activity_followups set status = 'done' where id = ${fu("t1")}::uuid`);
  await tx.execute(sql`update activity_followups set status = 'cancelled' where id = ${fu("t6")}::uuid`);

  // ================= Lampiran (2 gambar dummy dari kode) =================
  const png = dummyPng();
  const atts = [{ k: "a1", rec: "d5", cap: "寮の廊下の様子（イメージ）", pdf: true }, { k: "a2", rec: "d3", cap: "診察券（イメージ）", pdf: false }];
  for (const a of atts) {
    const id = T(`att:${a.k}`);
    await tx.insert(activityAttachments).values({ id, organizationId: orgId, createdBy: s1.id, recordId: rid(a.rec), mime: "image/png", sizeBytes: png.length, originalName: `${a.k}.png`, caption: a.cap, includeInPdf: a.pdf }).onConflictDoNothing();
    files.push({ orgId, id, ext: "png", data: png });
    bump("attachments");
  }

  // ================= Wawancara berkala =================
  const fy = fiscalYearOf(opts.today);
  const months = fiscalMonths(fy);
  const curMonth = `${opts.today.slice(0, 7)}-01`;
  // Pola global (berlaku lintas pekerja) supaya SEMUA status muncul walau tiap pekerja hanya punya beberapa bulan: 問題なし dominan
  const statuses = ["no_issue", "no_issue", "follow_up", "no_issue", "issue", "no_issue", "not_done", "no_issue", "no_issue"];
  const reasons = ["agency", "support", "worker"];
  const contents = ["仕事は順調で、人間関係も良好。体調に問題はない。", "寮での生活に慣れてきた。食事も問題なし。", "残業が多く疲れているが、休日は十分に休めている。", "日本語の勉強を続けており、仕事での会話も増えてきた。", "給与明細の内容を確認し、疑問は解消した。", "休日に友人と出かけており、生活は安定している。"];
  let pi = 0;
  for (const [wi, w] of [w0, w1, w2].entries()) {
    const start = `${String(w.startDate).slice(0, 7)}-01`;
    let rowsMonths = months.filter((m) => m >= start && m < curMonth);
    // Pekerja ke-3 sengaja belum diwawancara di KUARTAL BERJALAN (kuartal "open": masih bisa dikejar sebelum tenggat), asal ia punya wawancara di kuartal sebelumnya
    const beforeThisQuarter = rowsMonths.filter((m) => quarterOfMonth(m) !== quarterOfMonth(curMonth));
    if (wi === 2 && beforeThisQuarter.length > 0) rowsMonths = beforeThisQuarter;
    if (rowsMonths.length === 0) notes.push(`Pekerja ${wi + 1} baru mulai bekerja bulan ini: belum ada wawancara berkala.`);
    for (const [mi, m] of rowsMonths.entries()) {
      const st = statuses[pi % statuses.length];
      const na = wi === 1 && mi === 1; // satu bulan 対象外 (mis. pulang sementara)
      const lastDay = 10 + ((mi * 5 + wi * 3) % 15);
      const date = `${m.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
      const staffPick = [s1, s2, admin][(mi + wi) % 3];
      await tx.insert(periodicInterviews).values({
        id: T(`pi:${wi}:${m}`), organizationId: orgId, createdBy: staffPick.id, candidateId: w.id, periodMonth: m, applicable: !na,
        interviewDate: na || st === "not_done" ? null : date, resultStatus: na ? null : st, reason: na || st === "not_done" ? null : reasons[(mi + wi) % 3],
        content: na ? null : st === "not_done" ? null : contents[(mi + wi) % contents.length], staffId: na ? null : staffPick.id, note: na ? "一時帰国のため対象外" : st === "follow_up" ? "次回の面談で再確認する" : null,
        createdAt: new Date(`${date}T10:00:00${JST_OFFSET}`),
      }).onConflictDoNothing();
      pi++;
    }
    // catatan kuartal (備考): Q1 untuk semua pekerja, Q2 untuk dua pekerja pertama bila kuartalnya sudah lewat
    const curQ = quarterOfMonth(curMonth);
    for (const q of [1, 2].filter((x) => (x === 1 || wi < 2) && x <= curQ)) {
      await tx.insert(periodicInterviewQuarterNotes).values({ id: T(`pq:${wi}:${q}`), organizationId: orgId, createdBy: admin.id, candidateId: w.id, fiscalYear: fy, quarter: q, note: q === 1 ? "第1四半期：全体として安定している。" : "第2四半期：生活面の相談が増えたが、解決済み。" }).onConflictDoNothing();
    }
  }
  bump("interviews", pi);

  // ================= Pekerja yang SUDAH BERHENTI di tengah tahun fiskal (T-008) =================
  // Satu penempatan ENDED (tanpa keputusan DEPARTED: hanya data demo, supaya hitungan keputusan di daftar kandidat tidak bergeser). Masa kerja ~100 hari yang selesai 30 hari lalu:
  // menyentuh >= 2 kuartal; wawancara hanya di kuartal pertama, jadi kuartal berikutnya "Belum" (wajib dilaporkan ke imigrasi walau sudah berhenti).
  const endedExists = (await tx.select({ id: placements.id }).from(placements).where(eq(placements.status, "ENDED"))).length > 0;
  if (!endedExists) {
    const partners = (await tx.select({ lpk: partnerships.lpkId }).from(partnerships).where(and(eq(partnerships.tskId, orgId), eq(partnerships.active, true)))).map((p) => p.lpk);
    const everPlaced = new Set((await tx.select({ c: placements.candidateId }).from(placements)).map((p) => p.c));
    const sels = await tx.select({ c: candidateSelections.candidateId, d: candidateSelections.decision }).from(candidateSelections).where(eq(candidateSelections.tskOrgId, orgId));
    const decided = new Set(sels.filter((x) => ["DEPARTED", "DOCUMENT_PROCESS", "PASSED_CLIENT_INTERVIEW"].includes(x.d)).map((x) => x.c));
    const pool = (await tx.select({ id: candidates.id, org: candidates.organizationId }).from(candidates).where(and(eq(candidates.stage, "READY"), eq(candidates.sharedWithTsk, true))))
      .filter((c) => partners.includes(c.org) && !everPlaced.has(c.id) && !decided.has(c.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const ended = pool[pool.length - 1]; // ujung daftar: jarang dipakai tes lain
    if (ended) {
      const endDate = addDays(opts.today, -30);
      const startDate = addDays(endDate, -100);
      await tx.insert(placements).values({ id: T("placement:ended"), candidateId: ended.id, orgId, siteId: w1.siteId, startDate, endDate, status: "ENDED", note: "契約満了（デモ用）" }).onConflictDoNothing();
      const firstDate = addDays(startDate, 10);
      await tx.insert(periodicInterviews).values({
        id: T("pi:ended:1"), organizationId: orgId, createdBy: s1.id, candidateId: ended.id, periodMonth: `${firstDate.slice(0, 7)}-01`, applicable: true, interviewDate: firstDate, resultStatus: "no_issue",
        reason: "agency", content: "就労開始後の様子を確認した。仕事にも慣れてきており、問題なし。", staffId: s1.id, createdAt: new Date(`${firstDate}T10:00:00${JST_OFFSET}`),
      }).onConflictDoNothing();
      bump("interviews.endedWorker");
      notes.push("Menambah 1 pekerja yang sudah berhenti (penempatan ENDED tanpa keputusan DEPARTED) untuk contoh laporan tahunan.");
    }
  }

  return { files, summary: counts, notes };
}
