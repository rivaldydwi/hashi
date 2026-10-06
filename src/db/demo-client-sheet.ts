// Data DEMO "Informasi untuk lembar" (langkah 6): mengisi kolom baru klien/lokasi/job order dummy yang MASIH NULL. Tidak pernah menimpa nilai yang sudah ada,
// tidak membuat atau menghapus baris. Dipakai (1) scripts/seed.ts untuk lingkungan baru dan (2) scripts/seed-client-sheet.ts (produksi/demo, TANPA reseed).
// Semua isi karangan (alamat/stasiun fiktif). Id baris dummy deterministik (sama dengan scripts/seed.ts). Berjalan di koneksi OWNER.
import { eq } from "drizzle-orm";
import type { Tx } from "./index";
import { clientCompanies, clientSites, jobOrders } from "./schema";
import { uuidFor } from "./demo-rng";

export type ClientSheetSeedResult = { companies: number; sites: number; jobOrders: number; skipped: string[] };

/** Satu perusahaan (indeks 2, 北斗; semua lowongannya terisi/ditutup, jadi bagian 求人 profilnya kosong) dan satu job order OPEN (restaurant) SENGAJA dibiarkan tidak lengkap: untuk menguji bagian kosong dan petunjuk kelengkapan. */
export const INCOMPLETE_COMPANY_INDEX = 2;
export const INCOMPLETE_JOB_ORDER_KEY = "restaurant";

const COMPANIES: Record<number, { industry: string; employeeCount: number; foreignWorkerExperience: string; publicIntro: string }> = {
  0: { industry: "介護事業（特別養護老人ホーム・デイサービス）", employeeCount: 180, foreignWorkerExperience: "2019年から特定技能・技能実習生を受け入れ（累計12名）", publicIntro: "愛知県で二つの介護施設を運営しています。入居者一人ひとりの暮らしを大切にし、外国人スタッフには日本語の勉強会や先輩職員による個別指導を行っています。" },
  1: { industry: "食品製造・外食", employeeCount: 320, foreignWorkerExperience: "2020年から特定技能を受け入れ（現在8名在籍）", publicIntro: "静岡県で惣菜の製造と食堂の運営を行う会社です。清潔で安全な職場づくりに力を入れ、社宅や食事補助など生活面のサポートも整えています。" },
};
const SITES: Record<string, string> = {
  S1: "名鉄ダミー線「ダミー北駅」から徒歩10分／ダミー駅前バス「ひまわり苑前」下車すぐ",
  S2: "ダミー市営地下鉄「ダミー南駅」から徒歩7分",
  S3: "JRダミー線「工業団地前駅」から送迎バスで15分",
  S4: "静岡ダミー鉄道「中央ダミー駅」から徒歩3分",
};
// Kunci INCOMPLETE_JOB_ORDER_KEY sengaja tidak ada di sini.
const JOB_ORDERS: Record<string, { workHours: string; daysOff: string; housing: "provided" | "allowance" | "none" | "unspecified"; housingNote: string; commuteNote: string; benefitsNote: string }> = {
  kaigo: { workHours: "日勤 8:30〜17:30（休憩60分）、早番・遅番・夜勤あり（月4回程度）\n1日8時間、週40時間", daysOff: "シフト制 月8〜9日休み、年末年始、有給休暇（入社6か月後に10日）", housing: "provided", housingNote: "施設近くの寮（個室、家賃月1万円）", commuteNote: "寮から徒歩10分。自転車通勤可", benefitsNote: "社会保険完備、夜勤手当、資格取得支援、日本語学習支援" },
  food: { workHours: "8:00〜17:00（休憩60分）1日8時間、残業は月10時間程度", daysOff: "週休2日（日曜・祝日ほか）、夏季・年末年始休暇、有給休暇", housing: "allowance", housingNote: "社宅あり（家賃補助月2万円）", commuteNote: "社宅から送迎バスあり", benefitsNote: "社会保険完備、制服貸与、食事補助、年1回の昇給" },
  manufacture: { workHours: "8:00〜17:00（休憩60分）1日8時間、繁忙期は残業あり", daysOff: "週休2日（土日）、GW・お盆・年末年始、有給休暇", housing: "allowance", housingNote: "住宅手当 月2万円", commuteNote: "電車・バス通勤（交通費全額支給）", benefitsNote: "社会保険完備、残業手当、技能検定の受験支援" },
  agri: { workHours: "7:00〜16:00（休憩60分）、収穫期は早朝作業あり", daysOff: "週休2日（シフト制）、年末年始、有給休暇", housing: "provided", housingNote: "会社の寮（2人部屋、寮費補助あり）", commuteNote: "寮からハウスまで徒歩圏内", benefitsNote: "社会保険完備、収穫物のおすそ分け、作業服支給" },
  construction: { workHours: "8:00〜17:00（休憩は午前・昼・午後）、現場により変動", daysOff: "日曜・祝日、雨天時は振替、年末年始、有給休暇", housing: "none", housingNote: "", commuteNote: "現場までは会社の車で送迎", benefitsNote: "社会保険完備、現場手当、安全靴・作業服支給" },
};

export async function seedClientSheet(tx: Tx): Promise<ClientSheetSeedResult> {
  const res: ClientSheetSeedResult = { companies: 0, sites: 0, jobOrders: 0, skipped: [] };

  for (const [idx, vals] of Object.entries(COMPANIES)) {
    const id = uuidFor(`client:company:${idx}`);
    const [row] = await tx.select().from(clientCompanies).where(eq(clientCompanies.id, id));
    if (!row) { res.skipped.push(`perusahaan ${idx} tidak ada`); continue; }
    const set: Partial<typeof clientCompanies.$inferInsert> = {};
    for (const [k, v] of Object.entries(vals) as Array<[keyof typeof vals, string | number]>) if (row[k] === null) (set as Record<string, unknown>)[k] = v;
    if (Object.keys(set).length) { await tx.update(clientCompanies).set(set).where(eq(clientCompanies.id, id)); res.companies++; }
  }

  for (const [key, access] of Object.entries(SITES)) {
    const id = uuidFor(`client:site:${key}`);
    const [row] = await tx.select().from(clientSites).where(eq(clientSites.id, id));
    if (!row) { res.skipped.push(`lokasi ${key} tidak ada`); continue; }
    if (row.accessNote === null) { await tx.update(clientSites).set({ accessNote: access }).where(eq(clientSites.id, id)); res.sites++; }
  }

  for (const [key, vals] of Object.entries(JOB_ORDERS)) {
    const id = uuidFor(`client:job-order:${key}`);
    const [row] = await tx.select().from(jobOrders).where(eq(jobOrders.id, id));
    if (!row) { res.skipped.push(`job order ${key} tidak ada`); continue; }
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(vals)) if (row[k as keyof typeof row] === null && (v !== "" || k !== "housingNote")) set[k] = v === "" ? null : v;
    if (Object.keys(set).length) { await tx.update(jobOrders).set(set).where(eq(jobOrders.id, id)); res.jobOrders++; }
  }
  return res;
}
