// KONFIGURASI TUNGGAL lembar klien (langkah 6): label Jepang + padanan Indonesia, urutan bagian, kolom tabel, dan aturan apa yang disembunyikan
// pada versi "untuk dibagikan". FORMAT INI MASIH DRAFT (TSK belum punya format baku): mengubah label, urutan, atau bagian cukup di berkas ini.
// Modul murni (tanpa pdfkit/DB) supaya dipakai juga oleh pratinjau di layar dan tes. Pasangan Indonesia mengikuti docs/glossary.md.

export type SheetKind = "company" | "jobOrder";
export type SheetMode = "internal" | "share";
export type LabelLang = "ja" | "jaid";

/** [Jepang, Indonesia]. Bahasa "ja" hanya memakai yang pertama; "jaid" menampilkan "Jepang / Indonesia". */
export const LABELS = {
  // judul dokumen dan penanda mode (pojok kanan atas)
  docCompany: ["取引先プロフィール", "Profil klien"],
  docJobOrder: ["求人票", "Lembar job order"],
  modeInternal: ["社内用", "Hanya internal"],
  modeShare: ["提供用", "Untuk dibagikan"],
  createdBy: ["作成", "Disusun oleh"],
  // bagian
  secBasic: ["基本情報", "Informasi dasar"],
  secIntro: ["紹介文", "Perkenalan"],
  secSites: ["事業所", "Lokasi kerja"],
  secOpenings: ["求人", "Lowongan terbuka"],
  secInternalNote: ["備考（社内用）", "Catatan internal"],
  secConditions: ["労働条件", "Kondisi kerja"],
  secRequirements: ["応募条件", "Persyaratan"],
  secSite: ["勤務地", "Lokasi kerja"],
  secContacts: ["担当者", "Penanggung jawab klien"],
  // kolom
  corporateName: ["法人名", "Nama badan usaha"],
  address: ["所在地", "Alamat"],
  industry: ["業種・施設種別", "Jenis usaha / fasilitas"],
  employeeCount: ["従業員数", "Jumlah karyawan"],
  foreignExperience: ["外国人受入れ実績", "Pengalaman menerima pekerja asing"],
  acceptedFields: ["受入れ可能分野", "Bidang yang diterima"],
  siteName: ["事業所名", "Nama lokasi"],
  phone: ["電話番号", "Telepon"],
  access: ["最寄り駅・アクセス", "Stasiun terdekat / akses"],
  contactPerson: ["担当者", "Penanggung jawab"],
  field: ["分野", "Bidang"],
  positions: ["募集人数", "Jumlah dibutuhkan"],
  jpRequirement: ["日本語要件", "Syarat bahasa Jepang"],
  startDate: ["就業開始予定", "Rencana mulai kerja"],
  deadline: ["応募締切", "Batas pendaftaran"],
  genderReq: ["性別条件", "Syarat jenis kelamin"],
  company: ["会社名", "Perusahaan"],
  duties: ["業務内容", "Isi pekerjaan"],
  workHours: ["勤務時間", "Jam kerja"],
  daysOff: ["休日・休暇", "Hari libur / cuti"],
  salary: ["給与", "Gaji"],
  housing: ["住居", "Tempat tinggal"],
  commute: ["通勤", "Transportasi"],
  benefits: ["福利厚生", "Fasilitas / kesejahteraan"],
  workPlace: ["勤務地", "Lokasi kerja"],
  jobTitle: ["募集職種", "Posisi"],
  note: ["備考", "Catatan"],
  // nilai pilihan
  perMonth: ["月", "bulan"],
  housingProvided: ["寮あり", "Asrama tersedia"],
  housingAllowance: ["住宅手当", "Tunjangan perumahan"],
  housingNone: ["なし", "Tidak ada"],
  housingUnspecified: ["未定", "Belum ditentukan"],
  male: ["男性", "Laki-laki"],
  female: ["女性", "Perempuan"],
  jlptAtLeast: ["日本語能力試験", "JLPT"],
  jftRequired: ["JFT-Basic 合格（200点以上）", "lulus JFT-Basic (skor 200 ke atas)"],
} as const satisfies Record<string, readonly [string, string]>;
export type LabelKey = keyof typeof LABELS;

export const label = (key: LabelKey, lang: LabelLang): string => (lang === "jaid" ? `${LABELS[key][0]} / ${LABELS[key][1]}` : LABELS[key][0]);

/** Urutan bagian tiap dokumen. Bagian kosong dilewati; bagian bertanda internal tidak ikut versi dibagikan. Ubah urutan/hapus di sini. */
export const SECTIONS = {
  company: [
    { id: "basic", label: "secBasic" },
    { id: "intro", label: "secIntro" },
    { id: "sites", label: "secSites" },
    { id: "openings", label: "secOpenings" },
    { id: "internalNote", label: "secInternalNote", internalOnly: true },
  ],
  jobOrder: [
    { id: "basic", label: "secBasic" },
    { id: "conditions", label: "secConditions" },
    { id: "requirements", label: "secRequirements" },
    { id: "site", label: "secSite" },
    { id: "contacts", label: "secContacts", internalOnly: true },
    { id: "internalNote", label: "secInternalNote", internalOnly: true },
  ],
} as const satisfies Record<SheetKind, ReadonlyArray<{ id: string; label: LabelKey; internalOnly?: boolean }>>;

/** Kolom tabel lowongan di profil klien (kolom `internalOnly` tidak ikut versi dibagikan). Lebar relatif. */
export const OPENING_COLUMNS = [
  { id: "field", label: "field", width: 22 },
  { id: "positions", label: "positions", width: 14 },
  { id: "jp", label: "jpRequirement", width: 26 },
  { id: "start", label: "startDate", width: 19 },
  { id: "deadline", label: "deadline", width: 19 },
  { id: "gender", label: "genderReq", width: 14, internalOnly: true },
] as const satisfies ReadonlyArray<{ id: string; label: LabelKey; width: number; internalOnly?: boolean }>;

/** Yang SENGAJA tidak disertakan pada versi dibagikan (kunci pesan `sheet.excluded.<kunci>` di dialog). */
export const SHARE_EXCLUDES = {
  company: ["contactDetails", "internalNote", "genderRequirement", "staffName"],
  jobOrder: ["contacts", "internalNote", "genderRequirement", "staffName"],
} as const satisfies Record<SheetKind, readonly string[]>;

/** Isian "Informasi untuk lembar" yang dicek untuk petunjuk kelengkapan (kunci pesan `sheet.missing.<kunci>`). */
export const COMPLETENESS = {
  company: ["industry", "employeeCount", "foreignWorkerExperience", "publicIntro", "accessNote"],
  jobOrder: ["description", "workHours", "daysOff", "monthlySalary", "housing", "commuteNote", "benefitsNote", "targetStartDate", "applicationDeadline"],
} as const satisfies Record<SheetKind, readonly string[]>;

// ------------------------------------------------------------------------------------------------ pemformat murni (dites di tests/unit/client-sheet.test.ts)

/** 170000 -> "¥170,000 / 月" (pemisah ribuan tetap koma, bukan menurut bahasa UI). */
export function formatSalaryYen(n: number, lang: LabelLang = "ja"): string {
  const digits = Math.trunc(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `¥${digits} / ${lang === "jaid" ? `${LABELS.perMonth[0]} (${LABELS.perMonth[1]})` : LABELS.perMonth[0]}`;
}

/** "2026-10-05" -> "2026年10月5日". */
export function formatYmd(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return "";
  return `${Number(ymd.slice(0, 4))}年${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
}

/** Syarat bahasa: "日本語能力試験 N4以上、JFT-Basic 合格（200点以上）"; kosong bila tidak ada syarat. */
export function formatJpRequirement(minJlpt: string | null, jftRequired: boolean, lang: LabelLang): string {
  const parts: string[] = [];
  if (minJlpt) parts.push(`${LABELS.jlptAtLeast[0]} ${minJlpt}以上`);
  if (jftRequired) parts.push(lang === "jaid" ? `${LABELS.jftRequired[0]} / ${LABELS.jftRequired[1]}` : LABELS.jftRequired[0]);
  return parts.join("、");
}

const HOUSING_LABEL = { provided: "housingProvided", allowance: "housingAllowance", none: "housingNone", unspecified: "housingUnspecified" } as const;
export function formatHousing(housing: string | null, note: string | null, lang: LabelLang): string {
  const key = housing ? HOUSING_LABEL[housing as keyof typeof HOUSING_LABEL] : undefined;
  const head = key ? label(key, lang) : "";
  return [head, note?.trim() ?? ""].filter(Boolean).join("　");
}

export function formatGender(g: string | null, lang: LabelLang): string {
  return g === "MALE" ? label("male", lang) : g === "FEMALE" ? label("female", lang) : "";
}

export function formatEmployees(n: number | null): string {
  return n === null || n === undefined ? "" : `${Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}名`;
}
