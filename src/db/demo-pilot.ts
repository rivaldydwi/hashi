// Data PILOT (langkah 8, T-014): +200 kandidat dummy lengkap di atas seed dasar, untuk membuktikan aplikasi tetap cepat dan benar pada volume pilot. TIDAK mengubah/menghapus apa pun yang sudah ada
// (hanya menambah), deterministik (PRNG ber-seed tetap + id dari `uuidFor`), dan idempoten: kandidat pilot yang sudah ada dilewati BESERTA seluruh turunannya, jadi menjalankan dua kali
// tidak menggandakan. Hanya data dummy; skrip pemanggil (scripts/seed-pilot.ts) menolak database di luar _dev/_test/_demo dan organisasi di luar daftar dummy.
//
// Isi: 90 kandidat LPK Bandung, 70 Surabaya, 40 Medan (bukan mitra); sebaran status LPK, berbagi ke TSK, keputusan TSK (sebagian besar kandidat READY yang terlihat BERANGKAT = pekerja aktif),
// penilaian bulanan, dokumen dummy kecil; 6 job order pilot (posisi besar); pekerja aktif punya penanggung jawab per penempatan (SATU staf memegang 47 pekerja -> peringatan beban kuning),
// kartu 在留カード dengan SEBARAN SEMUA TAHAP, catatan harian, wawancara berkala, dan catatan kuartal.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "./index";
import { buildAssessments, buildProfile, FIELD_KEYS, FIELDS, type DemoProfile, type Stage } from "./demo-data";
import { addDays, addMonths, makeRng, pick, uuidFor } from "./demo-rng";
import { fiscalYearOf, quarterOfMonth } from "./records-core";
import { currentPeriod, periodMonthsAgo } from "./time";
import {
  activityRecordSubjects, activityRecords, candidateAssessments, candidateCertificates, candidateDocuments, candidateEducations, candidateFamilyMembers, candidateNotes, candidatePrivate,
  candidateSelections, candidateWorkHistories, candidates, clientSites, jobOrders, organizations, periodicInterviewQuarterNotes, periodicInterviews, placements, residenceCards,
  responsibleAssignments, skillFields, users,
  type SelectionDecision,
} from "./schema";
import { cardStage, type CardStage, type RenewalStatus } from "./zairyu";

export const PILOT_ORG_COUNTS = [90, 70, 40] as const; // Bandung, Surabaya, Medan
export const PILOT_CANDIDATES = PILOT_ORG_COUNTS.reduce((a, b) => a + b, 0);
export const PILOT_ORG_NAMES = ["LPK Demo Bandung", "LPK Demo Surabaya", "LPK Non-Mitra Medan"] as const;
/** Staf TSK yang sengaja memegang banyak pekerja (>= WORKLOAD.warnAt = 45, <= max = 50): peringatan beban kuning. */
export const PILOT_HEAVY_STAFF_EMAIL = "tsk.staff@hashi.test";
export const PILOT_HEAVY_STAFF_WORKERS = 47;
/** Pekerja aktif pilot yang dipegang staf lain / admin (sisanya tetap mengikuti penetapan per perusahaan dari seed dasar). */
const PILOT_SECOND_STAFF_WORKERS = 15;

const T = (key: string) => uuidFor(`pilot:${key}`);

const FIRST: Array<[string, string, "MALE" | "FEMALE"]> = [
  ["Adi", "アディ", "MALE"], ["Bayu", "バユ", "MALE"], ["Citra", "チトラ", "FEMALE"], ["Dian", "ディアン", "FEMALE"], ["Eko", "エコ", "MALE"], ["Fitri", "フィトリ", "FEMALE"],
  ["Galih", "ガリ", "MALE"], ["Hana", "ハナ", "FEMALE"], ["Imam", "イマム", "MALE"], ["Jihan", "ジハン", "FEMALE"], ["Krisna", "クリスナ", "MALE"], ["Laras", "ララス", "FEMALE"],
  ["Mulyadi", "ムリャディ", "MALE"], ["Novi", "ノヴィ", "FEMALE"], ["Oky", "オキ", "MALE"], ["Pelangi", "プランギ", "FEMALE"], ["Rangga", "ランガ", "MALE"], ["Sinta", "シンタ", "FEMALE"],
  ["Tegar", "テガル", "MALE"], ["Umi", "ウミ", "FEMALE"], ["Vino", "ヴィノ", "MALE"], ["Winda", "ウィンダ", "FEMALE"], ["Yoga", "ヨガ", "MALE"], ["Zahra", "ザフラ", "FEMALE"],
];
const LAST: Array<[string, string]> = [
  ["Ramadhan", "ラマダン"], ["Permana", "プルマナ"], ["Lestari", "レスタリ"], ["Firmansyah", "フィルマンシャ"], ["Anggraini", "アンググライニ"], ["Maulana", "マウラナ"], ["Purnama", "プルナマ"],
  ["Kurniawan", "クルニアワン"], ["Handayani", "ハンダヤニ"], ["Syahputra", "シャハプトラ"], ["Utami", "ウタミ"], ["Gunawan", "グナワン"],
];
const MIDDLE = ["Putra", "Putri", "Adi", "Dwi", "Tri", "Eka", "Nur", "Sri", "Aji", "Budi"];

const PIPELINE: Record<Stage, number[]> = { STUDYING: [0, 1, 2, 3], READY: [4, 5, 6, 7, 8, 9, 10], WITHDRAWN: [11] };
const STAGE_BY_MOD = (k: number): Stage => (k % 10 === 0 || k % 10 === 1 ? "STUDYING" : k % 10 === 9 ? "WITHDRAWN" : "READY");

// Job order pilot: satu per bidang, di lokasi yang menerima bidang itu (kode lokasi seed dasar). Posisi besar supaya tetap OPEN walau banyak yang berangkat.
const PILOT_JOB_ORDERS = [
  { key: "kaigo", site: "S1", title: "介護職員（パイロット）", salary: 215000 },
  { key: "food", site: "S3", title: "食品工場スタッフ（パイロット）", salary: 198000 },
  { key: "restaurant", site: "S4", title: "外食スタッフ（パイロット）", salary: 202000 },
  { key: "manufacture", site: "S3", title: "製造オペレーター（パイロット）", salary: 222000 },
  { key: "construction", site: "S5", title: "建設作業員（パイロット）", salary: 232000 },
  { key: "agri", site: "S5", title: "施設園芸スタッフ（パイロット）", salary: 192000 },
] as const;

const DOCS = [
  { type: "PASSPORT", file: "paspor", ext: "pdf" },
  { type: "PHOTO", file: "foto", ext: "png" },
  { type: "MEDICAL_CHECKUP", file: "medical-checkup", ext: "pdf" },
] as const;

/** Sebaran tahap kartu untuk pekerja aktif pilot (bergilir). `offset` = tanggal habis relatif terhadap hari ini; tahap diperiksa dengan cardStage saat seed. */
type CardPlan = { label: string; stage: CardStage | "nodata"; status?: RenewalStatus; offset?: number; applied?: number; docs?: number; rejected?: number; special?: boolean; docsFlag?: boolean };
export const CARD_PLAN: readonly CardPlan[] = [
  { label: "prepare", stage: "prepare", offset: 105 },
  { label: "can_apply", stage: "can_apply", offset: 70 },
  { label: "h30", stage: "h30", offset: 25 },
  { label: "h14", stage: "h14", offset: 11 },
  { label: "h7", stage: "h7", offset: 4 },
  { label: "expired", stage: "expired", offset: -6 },
  { label: "waiting", stage: "waiting_result", status: "applied", offset: 40, applied: -3 },
  { label: "waiting_special", stage: "waiting_result", status: "applied", offset: -20, applied: -45, special: true },
  { label: "additional_docs", stage: "waiting_result", status: "additional_docs", offset: 25, applied: -12, docs: -3, docsFlag: true },
  { label: "special_overdue", stage: "special_overdue", status: "applied", offset: -90, applied: -120 },
  { label: "rejected", stage: "rejected", status: "rejected", offset: 30, applied: -20, rejected: -2 },
  { label: "far", stage: "none", offset: 250 },
  { label: "far2", stage: "none", offset: 300 },
  { label: "nodata", stage: "nodata" },
  { label: "prepare2", stage: "prepare", offset: 100 },
];

export type SeedPilotOpts = { today: string; now?: Date };
export type PilotFile = { orgId: string; candidateId: string; documentId: string; ext: "pdf" | "png"; type: string };
export type SeedPilotResult = { files: PilotFile[]; summary: Record<string, number>; notes: string[] };

export async function seedPilot(tx: Tx, opts: SeedPilotOpts): Promise<SeedPilotResult> {
  const { today } = opts;
  const now = opts.now ?? new Date();
  const notes: string[] = [];
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  // ---- Organisasi dan pengguna dasar (seed dasar HARUS sudah dijalankan)
  const orgRows = await tx.select({ id: organizations.id, name: organizations.name, type: organizations.type }).from(organizations);
  const lpks = PILOT_ORG_NAMES.map((n) => orgRows.find((o) => o.name === n && o.type === "LPK"));
  const tsk = orgRows.find((o) => o.name === "TSK Demo Tokyo" && o.type === "TSK");
  if (!tsk || lpks.some((l) => !l)) throw new Error("Seed dasar belum ada (organisasi demo tidak lengkap): jalankan npm run db:seed dulu");
  const userRows = await tx.select({ id: users.id, email: users.email, role: users.role, org: users.organizationId }).from(users);
  const U = (email: string) => {
    const u = userRows.find((x) => x.email === email);
    if (!u) throw new Error(`Pengguna dasar ${email} tidak ada: jalankan npm run db:seed dulu`);
    return u.id;
  };
  const tskAdmin = U("tsk.admin@hashi.test");
  const heavyStaff = U(PILOT_HEAVY_STAFF_EMAIL);
  const staff2 = userRows.find((x) => x.email === "tsk.staff2@hashi.test")?.id ?? heavyStaff;
  const lpkStaff = [
    [U("lpk1.admin@hashi.test"), U("lpk1.sensei@hashi.test")],
    [U("lpk2.admin@hashi.test")],
    [U("lpk3.admin@hashi.test")],
  ];
  const fieldRows = await tx.select({ id: skillFields.id, code: skillFields.code }).from(skillFields);
  const fieldId = (code: string) => fieldRows.find((f) => f.code === code)!.id;

  // ---- 1. Kandidat (yang sudah ada dilewati; turunan hanya untuk yang BARU)
  type Seeded = { id: string; orgIndex: number; i: number; stage: Stage; fieldKey: string; shared: boolean; profile: DemoProfile; fullName: string; gender: "MALE" | "FEMALE"; row: typeof candidates.$inferInsert };
  const all: Seeded[] = [];
  for (const [orgIndex, n] of PILOT_ORG_COUNTS.entries()) {
    for (let k = 0; k < n; k++) {
      // indeks pipeline 0..11 menentukan rencana JLPT yang SELARAS dengan status: Belajar 0-3, Siap seleksi 4-10, Mundur 11 (seperti seed dasar); `variant` membuat profilnya berbeda
      const [first, firstKana, gender] = FIRST[(k * 7 + orgIndex * 5) % FIRST.length];
      const [last, lastKana] = LAST[(k * 5 + orgIndex * 3) % LAST.length];
      const middle = MIDDLE[(k + orgIndex) % MIDDLE.length];
      const fullName = `${first} ${middle} ${last}`;
      const stage = STAGE_BY_MOD(k);
      const birthDate = `${1996 + (k % 10)}-${String((k * 7) % 12 + 1).padStart(2, "0")}-${String(((k * 11) % 27) + 1).padStart(2, "0")}`;
      const fieldIndex = (k + orgIndex * 2) % FIELDS.length;
      const i = PIPELINE[stage][k % PIPELINE[stage].length];
      const profile = buildProfile({ variant: `p${k}`, orgIndex, i, stage, gender, fullName, firstName: first, lastName: last, birthDate, fieldIndex, today });
      const shared = orgIndex === 2 ? true : k % 8 !== 7;
      all.push({
        id: T(`candidate:${orgIndex}:${k}`), orgIndex, i, stage, fieldKey: FIELD_KEYS[fieldIndex % FIELD_KEYS.length], shared, profile, fullName, gender,
        row: {
          id: T(`candidate:${orgIndex}:${k}`), organizationId: lpks[orgIndex]!.id, fullName, nameKatakana: `${firstKana}・${lastKana}`, gender, birthDate,
          fieldId: fieldId(FIELD_KEYS[fieldIndex % FIELD_KEYS.length]), stage, dataConsentDate: shared ? `2026-${String((k % 6) + 1).padStart(2, "0")}-10` : null, sharedWithTsk: shared,
          ...profile.candidatePatch,
        },
      });
    }
  }
  const existing = new Set((await tx.select({ id: candidates.id }).from(candidates).where(inArray(candidates.id, all.map((c) => c.id)))).map((r) => r.id));
  const fresh = all.filter((c) => !existing.has(c.id));
  if (fresh.length === 0) {
    notes.push(`Semua ${all.length} kandidat pilot sudah ada: tidak ada yang ditambahkan (idempoten).`);
    return { files: [], summary: { candidates: 0 }, notes };
  }
  if (existing.size > 0) notes.push(`${existing.size} kandidat pilot sudah ada dan dilewati; ${fresh.length} ditambahkan.`);

  const chunk = <T,>(rows: T[], size: number): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, i * size + size));
  for (const part of chunk(fresh, 40)) await tx.insert(candidates).values(part.map((c) => c.row));
  for (const c of fresh.filter((x) => x.shared)) {
    await tx.update(candidates).set({ sharedWithTskAt: new Date(now.getTime() - (2 + (c.i % 40)) * 86_400_000) }).where(eq(candidates.id, c.id));
  }
  bump("candidates", fresh.length);
  for (const part of chunk(fresh, 40)) {
    await tx.insert(candidatePrivate).values(part.map((c) => ({ candidateId: c.id, ...c.profile.private })));
    await tx.insert(candidateFamilyMembers).values(part.flatMap((c) => c.profile.family.map((f, j) => ({ id: T(`family:${c.id}:${j}`), candidateId: c.id, ...f }))));
    await tx.insert(candidateEducations).values(part.flatMap((c) => c.profile.educations.map((e, j) => ({ id: T(`edu:${c.id}:${j}`), candidateId: c.id, ...e }))));
    await tx.insert(candidateWorkHistories).values(part.flatMap((c) => c.profile.works.map((w, j) => ({ id: T(`work:${c.id}:${j}`), candidateId: c.id, ...w }))));
    await tx.insert(candidateCertificates).values(part.flatMap((c) => c.profile.certificates.map((x, j) => ({ id: T(`cert:${c.id}:${j}`), candidateId: c.id, ...x }))));
  }

  // ---- 2. Dokumen dummy kecil (metadata; berkas ditulis pemanggil)
  const files: PilotFile[] = [];
  const docRows: Array<typeof candidateDocuments.$inferInsert> = [];
  for (const c of fresh) {
    for (const d of DOCS) {
      const id = T(`doc:${c.id}:${d.type}`);
      docRows.push({
        id, candidateId: c.id, type: d.type, originalFilename: `${d.file}-${c.id.slice(0, 8)}.${d.ext}`, mimeType: d.ext === "png" ? "image/png" : "application/pdf", sizeBytes: 1024,
        issuedDate: d.type === "PASSPORT" ? c.profile.private.passportIssuedDate : d.type === "MEDICAL_CHECKUP" ? c.profile.mcuDate : addDays(today, -60),
        expiryDate: d.type === "PASSPORT" ? c.profile.private.passportExpiryDate : d.type === "MEDICAL_CHECKUP" ? addMonths(c.profile.mcuDate, 6) : null,
        uploadedBy: lpkStaff[c.orgIndex][0],
      });
      files.push({ orgId: c.row.organizationId, candidateId: c.id, documentId: id, ext: d.ext, type: d.type });
    }
  }
  for (const part of chunk(docRows, 200)) await tx.insert(candidateDocuments).values(part);
  bump("documents", docRows.length);

  // ---- 3. Penilaian bulanan LPK
  const lpkRows: Array<typeof candidateAssessments.$inferInsert> = [];
  for (const c of fresh) {
    for (const a of buildAssessments({ orgIndex: c.orgIndex, i: c.i, stage: c.stage, bestJlpt: c.profile.bestJlpt, today, currentPeriod: currentPeriod(), periodOf: (n) => periodMonthsAgo(n) })) {
      const { assessorSlot, ...rest } = a;
      lpkRows.push({ id: T(`assess:${c.id}:${rest.assessedOn}`), candidateId: c.id, orgId: c.row.organizationId!, kind: "LPK_MONTHLY", assessorId: lpkStaff[c.orgIndex][assessorSlot % lpkStaff[c.orgIndex].length], ...rest });
    }
  }
  for (const part of chunk(lpkRows, 100)) await tx.insert(candidateAssessments).values(part);
  bump("assessments", lpkRows.length);

  // ---- 4. Job order pilot (satu per bidang)
  const sites = await tx.select({ id: clientSites.id, name: clientSites.name, address: clientSites.address }).from(clientSites).where(eq(clientSites.orgId, tsk.id));
  const siteByKey = (key: string) => {
    const name = { S1: "ひまわり苑", S3: "本社工場", S4: "さくら食堂", S5: "北斗総合産業" }[key as "S1"];
    const s = sites.find((x) => x.name.includes(name!));
    if (!s) throw new Error(`Lokasi seed dasar ${key} tidak ditemukan`);
    return s;
  };
  const jobOrderOf = new Map<string, string>();
  for (const jo of PILOT_JOB_ORDERS) {
    const id = T(`job-order:${jo.key}`);
    jobOrderOf.set(jo.key, id);
    const site = siteByKey(jo.site);
    await tx.insert(jobOrders).values({
      id, orgId: tsk.id, siteId: site.id, fieldId: fieldId(jo.key), title: jo.title, positions: 200, program: "SSW", status: "OPEN", description: "パイロット用ダミー求人（デモ用）",
      salaryNote: "ダミー", monthlySalary: jo.salary, workPlace: site.address ?? "ダミー", minJlpt: "N5", jftRequired: false, genderRequirement: null,
      targetStartDate: addDays(today, 60), applicationDeadline: addDays(today, 120), note: "パイロット用ダミーデータ",
    }).onConflictDoNothing();
  }
  bump("jobOrders", PILOT_JOB_ORDERS.length);

  // ---- 5. Keputusan TSK: hanya LPK mitra (Bandung, Surabaya) dan kandidat yang DIBAGIKAN. Keputusan lanjut hanya untuk READY; mayoritas READY BERANGKAT.
  const partner = fresh.filter((c) => c.orgIndex < 2 && c.shared);
  const ready = partner.filter((c) => c.stage === "READY");
  const dist: Array<[SelectionDecision | null, number]> = [["DEPARTED", 74], ["DOCUMENT_PROCESS", 5], ["PASSED_CLIENT_INTERVIEW", 5], ["SUBMITTED_TO_CLIENT", 5], ["PASSED_TSK_INTERVIEW", 4], ["SHORTLISTED", 3], ["REJECTED", 2]];
  const decisions = new Map<string, SelectionDecision>();
  let idx = 0;
  const readyScale = Math.min(1, ready.length / 100); // idempoten sebagian (jumlah READY baru lebih sedikit): skala proporsional
  for (const [decision, n] of dist) {
    for (let j = 0; j < Math.round(n * readyScale) && idx < ready.length; j++, idx++) decisions.set(ready[idx].id, decision!);
  }
  // kandidat STUDYING yang dibagikan: sebagian sudah di-shortlist
  for (const c of partner.filter((x) => x.stage === "STUDYING").slice(0, 8)) decisions.set(c.id, "SHORTLISTED");
  const selRows: Array<typeof candidateSelections.$inferInsert> = [];
  for (const c of partner) {
    const d = decisions.get(c.id);
    if (!d) continue;
    const needsJob = d === "DEPARTED" || d === "DOCUMENT_PROCESS" || d === "PASSED_CLIENT_INTERVIEW";
    selRows.push({ candidateId: c.id, tskOrgId: tsk.id, decision: d, jobOrderId: needsJob || d === "SUBMITTED_TO_CLIENT" ? jobOrderOf.get(c.fieldKey)! : null, decidedBy: tskAdmin });
  }
  // DEPARTED terakhir: trigger membuat penempatan ACTIVE. Sisanya dimasukkan dulu.
  const nonDeparted = selRows.filter((r) => r.decision !== "DEPARTED");
  const departed = selRows.filter((r) => r.decision === "DEPARTED");
  for (const part of chunk(nonDeparted, 50)) await tx.insert(candidateSelections).values(part);
  for (const part of chunk(departed, 25)) await tx.insert(candidateSelections).values(part);
  bump("selections", selRows.length);
  bump("workers", departed.length);

  // catatan TSK (campuran, sebagian dibagikan ke LPK)
  const noteRows = partner.filter((c) => decisions.has(c.id)).slice(0, 24).map((c, j) => ({
    id: T(`note:${c.id}`), candidateId: c.id, tskOrgId: tsk.id, authorId: j % 2 === 0 ? tskAdmin : heavyStaff,
    body: j % 2 === 0 ? "面談メモ：日本語は安定。次の段階に進める。" : "Catatan pilot: komunikasi baik, dokumen lengkap.", visibility: (j % 3 === 0 ? "SHARED_WITH_LPK" : "TSK_ONLY") as "SHARED_WITH_LPK" | "TSK_ONLY",
  }));
  if (noteRows.length) await tx.insert(candidateNotes).values(noteRows).onConflictDoNothing();
  bump("notes", noteRows.length);

  // ---- 6. Pekerja aktif: tanggal mulai bervariasi, penanggung jawab per penempatan (47 ke staf berat, 15 ke staf lain, sisanya admin)
  const departedIds = departed.map((r) => r.candidateId);
  const placed = await tx.select({ id: placements.id, candidateId: placements.candidateId, siteId: placements.siteId }).from(placements).where(and(inArray(placements.candidateId, departedIds), eq(placements.status, "ACTIVE")));
  const placeByCand = new Map(placed.map((p) => [p.candidateId, p]));
  const workers = departedIds.map((id) => ({ id, placement: placeByCand.get(id)! })).filter((w) => w.placement);
  if (workers.length !== departedIds.length) throw new Error(`Penempatan otomatis tidak lengkap: ${workers.length} dari ${departedIds.length}`);
  const rngW = makeRng("pilot:workers");
  for (const w of workers) {
    await tx.execute(sql`update placements set start_date = ${addDays(today, -(30 + Math.floor(rngW() * 520)))}::date where id = ${w.placement.id}::uuid`);
  }
  const assignRows = workers.map((w, j) => ({
    id: T(`resp:${w.id}`), organizationId: tsk.id, placementId: w.placement.id, createdBy: tskAdmin,
    staffId: j < PILOT_HEAVY_STAFF_WORKERS ? heavyStaff : j < PILOT_HEAVY_STAFF_WORKERS + PILOT_SECOND_STAFF_WORKERS ? staff2 : tskAdmin,
    effectiveFrom: addDays(today, -200), createdAt: new Date(now.getTime() - 200 * 86_400_000),
  }));
  for (const part of chunk(assignRows, 100)) await tx.insert(responsibleAssignments).values(part).onConflictDoNothing();
  bump("responsible", assignRows.length);

  // ---- 7. Kartu 在留カード: sebaran SEMUA tahap (dicek dengan cardStage)
  const cardRows: Array<typeof residenceCards.$inferInsert> = [];
  const cardStageCount: Record<string, number> = {};
  for (const [j, w] of workers.entries()) {
    const plan = CARD_PLAN[j % CARD_PLAN.length];
    cardStageCount[plan.label] = (cardStageCount[plan.label] ?? 0) + 1;
    if (plan.stage === "nodata") continue;
    const cand = fresh.find((c) => c.id === w.id)!;
    const expiryDate = addDays(today, plan.offset!);
    const status = plan.status ?? "not_started";
    const got = cardStage({ expiryDate, renewalStatus: status, today });
    if (got.stage !== plan.stage || got.additionalDocs !== Boolean(plan.docsFlag) || (plan.special ? !got.specialUntil : false)) {
      throw new Error(`Rencana kartu '${plan.label}' menghasilkan tahap ${got.stage} (diharapkan ${plan.stage}); sesuaikan CARD_PLAN`);
    }
    cardRows.push({
      id: T(`card:${w.id}`), organizationId: tsk.id, createdBy: tskAdmin, candidateId: w.id, skillFieldId: cand.row.fieldId!, periodMonths: 12, expiryDate, renewalStatus: status,
      appliedOn: plan.applied !== undefined ? addDays(today, plan.applied) : null, additionalDocsOn: plan.docs !== undefined ? addDays(today, plan.docs) : null,
      rejectedOn: plan.rejected !== undefined ? addDays(today, plan.rejected) : null,
    });
  }
  for (const part of chunk(cardRows, 50)) await tx.insert(residenceCards).values(part).onConflictDoNothing();
  bump("cards", cardRows.length);
  for (const [k, v] of Object.entries(cardStageCount)) bump(`cardPlan.${k}`, v);

  // ---- 8. Catatan harian, wawancara berkala, catatan kuartal
  const authors = [heavyStaff, staff2, tskAdmin];
  const rngR = makeRng("pilot:records");
  const WORK = ["interview", "consultation", "interview", "hospital_visit", "residence_card"] as const;
  const ACTION = ["電話で近況を確認した。", "寮での生活について相談に対応した。", "配属先の担当者と状況を共有した。", "体調と勤務状況を面談で確認した。"];
  const RESULT = ["問題なし。", "経過を見守る。", "本人は納得した。", "追加の確認が必要。"];
  const recRows: Array<typeof activityRecords.$inferInsert> = [];
  const subjRows: Array<typeof activityRecordSubjects.$inferInsert> = [];
  for (const [j, w] of workers.entries()) {
    for (let r = 0; r < 2; r++) {
      const id = T(`record:${w.id}:${r}`);
      const by = authors[(j + r) % authors.length];
      const daysAgo = 1 + Math.floor(rngR() * 60);
      const at = new Date(now.getTime() - daysAgo * 86_400_000);
      recRows.push({
        id, organizationId: tsk.id, createdBy: by, authorId: by, kind: "daily_work", recordDate: addDays(today, -daysAgo), clientSiteId: w.placement.siteId, workType: pick(rngR, WORK),
        actionTaken: pick(rngR, ACTION), result: pick(rngR, RESULT), createdAt: at, updatedAt: at,
      });
      subjRows.push({ recordId: id, candidateId: w.id, organizationId: tsk.id });
    }
  }
  for (const part of chunk(recRows, 80)) await tx.insert(activityRecords).values(part).onConflictDoNothing();
  for (const part of chunk(subjRows, 200)) await tx.insert(activityRecordSubjects).values(part).onConflictDoNothing();
  bump("records", recRows.length);

  const fy = fiscalYearOf(today);
  const curMonth = `${today.slice(0, 7)}-01`;
  const statuses = ["no_issue", "no_issue", "follow_up", "no_issue", "issue", "no_issue", "not_done", "no_issue"];
  const piRows: Array<typeof periodicInterviews.$inferInsert> = [];
  for (const [j, w] of workers.entries()) {
    const start = String(addDays(today, -400)).slice(0, 7);
    for (let m = 1; m <= 3; m++) {
      const month = addMonths(curMonth, -m);
      if (month.slice(0, 7) < start) continue;
      const st = statuses[(j + m) % statuses.length];
      const date = `${month.slice(0, 7)}-${String(10 + ((j * 3 + m) % 15)).padStart(2, "0")}`;
      const by = authors[(j + m) % authors.length];
      piRows.push({
        id: T(`pi:${w.id}:${month}`), organizationId: tsk.id, createdBy: by, candidateId: w.id, periodMonth: month, applicable: true,
        interviewDate: st === "not_done" ? null : date, resultStatus: st, reason: st === "not_done" ? null : pick(rngR, ["agency", "support", "worker"] as const),
        content: st === "not_done" ? null : "仕事は順調。生活面の問題はない。", staffId: by,
      });
    }
  }
  for (const part of chunk(piRows, 80)) await tx.insert(periodicInterviews).values(part).onConflictDoNothing();
  bump("interviews", piRows.length);
  const qRows = workers.filter((_, j) => j % 3 === 0).map((w) => ({
    id: T(`pq:${w.id}:${fy}:${quarterOfMonth(curMonth)}`), organizationId: tsk.id, createdBy: tskAdmin, candidateId: w.id, fiscalYear: fy, quarter: quarterOfMonth(curMonth), note: "第四半期：安定している。",
  }));
  for (const part of chunk(qRows, 100)) await tx.insert(periodicInterviewQuarterNotes).values(part).onConflictDoNothing();
  bump("quarterNotes", qRows.length);

  return { files, summary: counts, notes };
}
