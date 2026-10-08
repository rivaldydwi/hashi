// Pemetaan data pekerja -> butir 1-14 form 在留期間更新許可申請書 (申請人等作成用1) untuk diajukan ONLINE (T-021). Murni (tanpa DB/React), dites unit.
// Keluarannya BUKAN PDF formulir: daftar butir berlabel dengan nilai yang tinggal disalin ke 在留申請オンラインシステム. Butir 15 (riwayat pidana) dan 16 (keluarga di Jepang)
// TIDAK disimpan; hanya pengingat. Nomor kartu (butir 12) TIDAK pernah ada di sini: diambil lewat aksi yang diaudit (T-020).

// ---------------------------------------------------------------------------------------------------- tanggal
const ERAS = [
  { name: "令和", start: "2019-05-01" },
  { name: "平成", start: "1989-01-08" },
  { name: "昭和", start: "1926-12-25" },
  { name: "大正", start: "1912-07-30" },
  { name: "明治", start: "1868-01-25" },
] as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (v: string | null | undefined): v is string => !!v && YMD.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** 2026-10-08 → "2026/10/08" (西暦, format isian online). */
export const toSeireki = (ymd: string): string => ymd.replace(/-/g, "/");

/** 2026-10-08 → "令和8年10月8日"; tahun pertama "元年". null bila di luar era yang dikenal atau tanggal tidak sah. */
export function toWareki(ymd: string): string | null {
  if (!isYmd(ymd)) return null;
  const era = ERAS.find((e) => ymd >= e.start);
  if (!era) return null;
  const y = Number(ymd.slice(0, 4)) - Number(era.start.slice(0, 4)) + 1;
  return `${era.name}${y === 1 ? "元" : y}年${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日`;
}

/** Tanggal 西暦 + 和暦 di sampingnya: "2026/10/08（令和8年10月8日）". */
export const dateBoth = (ymd: string): string => {
  const w = toWareki(ymd);
  return w ? `${toSeireki(ymd)}（${w}）` : toSeireki(ymd);
};

/** 在留期間 dalam bulan → teks Jepang di form ("4か月", "6か月", "1年", "1年6か月"). */
export function periodJa(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y ? `${y}年` : ""}${m ? `${m}か月` : ""}`;
}

// ---------------------------------------------------------------------------------------------------- nama
export type PassportName = { full: string; family: string; given: string; guess: boolean };
/**
 * Nama huruf Latin KAPITAL seperti paspor. Aksen dibuang; hanya huruf, spasi, tanda hubung, apostrof. Pemisahan marga/nama hanya PERKIRAAN (nama Indonesia tidak punya marga baku):
 * satu kata = marga saja (nama tunggal); banyak kata = kata terakhir marga, sisanya nama. Selalu `guess: true`: cocokkan dengan paspor.
 */
export function passportName(fullName: string): PassportName {
  const full = fullName.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z' -]/g, " ").replace(/\s+/g, " ").trim();
  const parts = full.split(" ").filter(Boolean);
  if (parts.length <= 1) return { full, family: full, given: "", guess: true };
  return { full, family: parts[parts.length - 1], given: parts.slice(0, -1).join(" "), guess: true };
}

// ---------------------------------------------------------------------------------------------------- butir
/** Tempat memperbaiki butir yang kosong: profil kandidat, data kartu, atau data Jepang pekerja. */
export type FixTarget = "profile" | "card" | "jp" | "passport";
export type RenewalValue = { label?: string; text: string; sub?: string };
export type RenewalItem = {
  no: number;
  key: string;
  /** Nilai yang disalin (satu atau lebih baris berlabel). Kosong = butir belum terisi. */
  values: RenewalValue[];
  missing: boolean;
  fix?: FixTarget;
  /** Butir yang diambil lewat aksi diaudit, bukan ditampilkan langsung (nomor kartu). */
  secret?: boolean;
  /** Butir yang bisa disunting di halaman dan TIDAK disimpan (alasan perpanjangan). */
  editable?: boolean;
  /** Butir yang hanya pengingat (tidak disimpan). */
  reminder?: boolean;
};
export type RenewalWarning = "passportExpired" | "passportBeforeCardExpiry" | "noCard" | "cardNotEditable";

export type RenewalInput = {
  fullName: string;
  birthDate: string | null;
  gender: "MALE" | "FEMALE" | null;
  maritalStatus: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | null;
  /** Alamat di Indonesia (candidate_private.address) untuk butir 7. */
  homeAddress: string | null;
  addressJp: string | null;
  phoneJp: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  card: { periodMonths: number | null; expiryDate: string; hasNumber: boolean } | null;
  companyName: string | null;
  fieldNameJa: string | null;
  today: string;
};

export const DEFAULT_OCCUPATION = "会社員";

/** Alasan perpanjangan bawaan (butir 14): lanjut bekerja sebagai 特定技能 di perusahaan penempatan. Bisa diubah di halaman, TIDAK disimpan. */
export function defaultRenewalReason(company: string | null, fieldJa: string | null): string {
  const where = company ? `${company}において` : "現在の所属機関において";
  const what = fieldJa ? `${fieldJa}分野の業務に` : "特定技能に係る業務に";
  return `引き続き特定技能1号の在留資格で、${where}${what}従事するため、在留期間の更新を申請します。`;
}

const text = (v: string | null | undefined) => (v ?? "").trim();
const one = (t: string, sub?: string): RenewalValue[] => (t ? [{ text: t, sub }] : []);

export function buildRenewal(i: RenewalInput): { items: RenewalItem[]; warnings: RenewalWarning[] } {
  const warnings: RenewalWarning[] = [];
  const name = passportName(i.fullName);
  const marital = i.maritalStatus === null ? "" : i.maritalStatus === "MARRIED" ? "有" : "無";
  const dob = isYmd(i.birthDate) ? i.birthDate : null;
  const passExpiry = isYmd(i.passportExpiry) ? i.passportExpiry : null;
  const card = i.card;

  const items: RenewalItem[] = [
    { no: 1, key: "nationality", values: one("インドネシア"), missing: false },
    { no: 2, key: "birth", values: dob ? [{ text: toSeireki(dob), sub: toWareki(dob) ?? undefined }] : [], missing: !dob, fix: "profile" },
    {
      no: 3, key: "name", missing: !name.full, fix: "profile",
      values: name.full ? [{ label: "FULL", text: name.full }, { label: "FAMILY", text: name.family }, ...(name.given ? [{ label: "GIVEN", text: name.given }] : [])] : [],
    },
    { no: 4, key: "gender", values: one(i.gender === "MALE" ? "男" : i.gender === "FEMALE" ? "女" : ""), missing: !i.gender, fix: "profile" },
    { no: 5, key: "marital", values: one(marital), missing: !marital, fix: "profile" },
    { no: 6, key: "occupation", values: one(DEFAULT_OCCUPATION), missing: false },
    { no: 7, key: "homeAddress", values: one(text(i.homeAddress)), missing: !text(i.homeAddress), fix: "profile" },
    { no: 8, key: "addressJp", values: one(text(i.addressJp)), missing: !text(i.addressJp), fix: "jp" },
    { no: 9, key: "phoneJp", values: one(text(i.phoneJp)), missing: !text(i.phoneJp), fix: "jp" },
    {
      no: 10, key: "passport", missing: !text(i.passportNumber) || !passExpiry, fix: "passport",
      values: [
        ...(text(i.passportNumber) ? [{ label: "NO.", text: text(i.passportNumber) }] : []),
        ...(passExpiry ? [{ label: "有効期限", text: toSeireki(passExpiry), sub: toWareki(passExpiry) ?? undefined }] : []),
      ],
    },
    {
      no: 11, key: "currentStatus", missing: !card, fix: "card",
      values: card ? [{ label: "在留資格", text: "特定技能1号" }, ...(card.periodMonths ? [{ label: "在留期間", text: periodJa(card.periodMonths) }] : []), { label: "満了日", text: toSeireki(card.expiryDate), sub: toWareki(card.expiryDate) ?? undefined }] : [],
    },
    { no: 12, key: "cardNumber", values: [], missing: !card || !card.hasNumber, fix: "card", secret: true },
    { no: 13, key: "desiredPeriod", values: card?.periodMonths ? one(periodJa(card.periodMonths)) : [], missing: !card?.periodMonths, fix: "card" },
    { no: 14, key: "reason", values: one(defaultRenewalReason(text(i.companyName) || null, text(i.fieldNameJa) || null)), missing: false, editable: true },
    { no: 15, key: "criminal", values: [], missing: false, reminder: true },
    { no: 16, key: "familyInJapan", values: [], missing: false, reminder: true },
  ];

  if (!card) warnings.push("noCard");
  if (passExpiry && passExpiry < i.today) warnings.push("passportExpired");
  else if (passExpiry && card && passExpiry <= card.expiryDate) warnings.push("passportBeforeCardExpiry");
  return { items, warnings };
}

/** Butir yang belum terisi (tidak termasuk pengingat). */
export const missingItems = (items: readonly RenewalItem[]): RenewalItem[] => items.filter((x) => x.missing && !x.reminder);
