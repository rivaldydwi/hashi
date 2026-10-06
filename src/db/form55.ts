// Form 参考様式第5-5号「定期面談報告書（1号特定技能外国人用）」 (T-009): SATU berkas konfigurasi untuk daftar butir, label, dan validator.
// Modul murni (hanya zod) supaya dipakai aplikasi, PDF, skrip seed/verifikasi, dan tes. Kode butir TETAP ("work.1" dst.): jangan diganti nomornya,
// data lama merujuk kode ini. Label Jepang = teks yang tercetak di PDF; label Indonesia = bantuan di form (id).
// FORMAT DRAFT: kalimat butir disusun dari rincian tugas T-009 (staf TSK), BUKAN salinan kata-per-kata form resmi; cocokkan dengan form 出入国在留管理庁 terbaru
// lalu ubah di sini saja bila perlu (tidak ada migrasi: data hanya menyimpan kode butir).
import { z } from "zod";

export type Form55Item = { code: string; ja: string; id: string };
export type Form55Group = { key: "work" | "treatment" | "protection" | "life" | "other"; no: string; ja: string; id: string; items: readonly Form55Item[] };

export const FORM55_GROUPS: readonly Form55Group[] = [
  {
    key: "work", no: "①", ja: "業務内容", id: "Isi pekerjaan",
    items: [
      { code: "work.1", ja: "雇用契約に定められた業務以外の業務に従事していないか", id: "Tidak mengerjakan pekerjaan di luar isi kontrak kerja" },
      { code: "work.2", ja: "契約外の他の事業者の下で就労していないか", id: "Tidak bekerja di bawah pemberi kerja lain di luar kontrak" },
      { code: "work.3", ja: "安全衛生に配慮した環境で就労しているか", id: "Bekerja dengan memperhatikan keselamatan dan kesehatan kerja (K3)" },
    ],
  },
  {
    key: "treatment", no: "②", ja: "待遇", id: "Perlakuan / syarat kerja",
    items: [
      { code: "treatment.1", ja: "報酬が契約どおり毎月支払われているか", id: "Gaji diterima setiap bulan sesuai kontrak" },
      { code: "treatment.2", ja: "労働時間が契約どおりか", id: "Jam kerja sesuai kontrak" },
      { code: "treatment.3", ja: "休日・休暇（一時帰国のための休暇を含む）が与えられているか", id: "Hari libur dan cuti diberikan (termasuk cuti pulang sementara)" },
      { code: "treatment.4", ja: "住居が適切に確保されているか", id: "Tempat tinggal layak" },
      { code: "treatment.5", ja: "食費・居住費等の費用が合意どおりか", id: "Biaya makan, tempat tinggal, dan sejenisnya sesuai kesepakatan" },
      { code: "treatment.6", ja: "支援計画に沿った支援を受けているか", id: "Menerima dukungan sesuai rencana dukungan (支援計画)" },
    ],
  },
  {
    key: "protection", no: "③", ja: "保護", id: "Perlindungan",
    items: [
      { code: "protection.1", ja: "暴行・脅迫・監禁を受けていないか", id: "Tidak mengalami kekerasan, ancaman, atau pengurungan" },
      { code: "protection.2", ja: "保証金の徴収・違約金契約がないか", id: "Tidak ada uang jaminan atau kontrak denda" },
      { code: "protection.3", ja: "預金通帳等の不当な管理がないか", id: "Tidak ada pengelolaan harta yang tidak wajar (buku tabungan dan sejenisnya)" },
      { code: "protection.4", ja: "旅券・在留カードを本人が保管しているか", id: "Paspor dan kartu izin tinggal dipegang sendiri" },
      { code: "protection.5", ja: "私生活の自由が制限されていないか", id: "Kebebasan pribadi tidak dibatasi" },
    ],
  },
  {
    key: "life", no: "④", ja: "生活", id: "Kehidupan",
    items: [
      { code: "life.1", ja: "日常生活上の問題がないか", id: "Tidak ada masalah kehidupan sehari-hari" },
      { code: "life.2", ja: "健康上の問題がないか", id: "Tidak ada masalah kesehatan" },
    ],
  },
  {
    key: "other", no: "⑤", ja: "その他", id: "Lain-lain",
    items: [
      { code: "other.1", ja: "不法就労者がいないか", id: "Tidak ada pekerja ilegal" },
      { code: "other.2", ja: "その他", id: "Lainnya" },
    ],
  },
];

export const FORM55_ITEMS: readonly Form55Item[] = FORM55_GROUPS.flatMap((g) => g.items);
export const FORM55_ITEM_CODES: readonly string[] = FORM55_ITEMS.map((i) => i.code);

export const FORM55_METHODS = ["in_person", "online"] as const;
export const FORM55_RESPONDER_ROLES = ["support_manager", "support_staff"] as const;
/** Penanganan ke pekerja (4-③-ア): dirujuk ke instansi / tidak ada penanganan (+ alasan). */
export const FORM55_WORKER_HANDLING = ["referred", "none"] as const;
/** 已/未 untuk penanganan ke perusahaan dan instansi terkait. */
export const FORM55_DONE = ["done", "not_done"] as const;

export const FORM55_LIMITS = { item: 1000, text: 4000, short: 200 } as const;

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const txt = (n: number) => z.string().trim().max(n);
const dateOrNull = z.string().regex(ymd).nullable();

/** Jawaban satu butir: "ok" (無) atau "problem" (有) + isi masalah. Butir yang belum dijawab tidak ada di peta. */
const itemSchema = z.object({ a: z.enum(["ok", "problem"]), text: txt(FORM55_LIMITS.item).default("") });

/** 4 基準不適合等への対応: dipakai hanya bila ⑥ = 有. */
const responseSchema = z.object({
  occurredOn: dateOrNull, // ① 発生日
  content: txt(FORM55_LIMITS.text), // ② 内容
  worker: z.object({ kind: z.enum(FORM55_WORKER_HANDLING).nullable(), body: txt(FORM55_LIMITS.short), reason: txt(FORM55_LIMITS.text) }), // ③ア
  company: z.object({
    notified: z.enum(FORM55_DONE).nullable(), notifiedOn: dateOrNull, notifiedTo: txt(FORM55_LIMITS.short), notifiedReason: txt(FORM55_LIMITS.text), // イ(ア)
    immigration: z.enum(FORM55_DONE).nullable(), immigrationNote: txt(FORM55_LIMITS.text), // イ(イ)
  }),
  agency: z.object({ reported: z.enum(FORM55_DONE).nullable(), on: dateOrNull, body: txt(FORM55_LIMITS.short), reason: txt(FORM55_LIMITS.text) }), // ウ
});

export const form55Schema = z.object({
  v: z.literal(1),
  items: z.record(z.string(), itemSchema),
  /** ⑥ 基準不適合等の有無: true = 有, false = なし, null = belum dijawab. */
  nonconformity: z.boolean().nullable(),
  special: txt(FORM55_LIMITS.text), // ⑦ その他特筆事項
  response: responseSchema.nullable(),
  createdOn: dateOrNull, // 作成年月日
});

export type Form55 = z.infer<typeof form55Schema>;
export type Form55Response = z.infer<typeof responseSchema>;

export const emptyResponse = (): Form55Response => ({
  occurredOn: null, content: "",
  worker: { kind: null, body: "", reason: "" },
  company: { notified: null, notifiedOn: null, notifiedTo: "", notifiedReason: "", immigration: null, immigrationNote: "" },
  agency: { reported: null, on: null, body: "", reason: "" },
});

export const emptyForm55 = (): Form55 => ({ v: 1, items: {}, nonconformity: null, special: "", response: null, createdOn: null });

/** Kunci galat yang dipahami UI (records.errors.<kunci> di messages) bila isi form tidak sah. */
export type Form55Error = "form55Invalid" | "form55ItemText" | "form55ResponseRequired";

/**
 * Validasi + normalisasi. Aturan: kode butir harus dari daftar tetap; butir "problem" wajib isi masalah; response dibuang bila ⑥ bukan 有
 * (tidak pernah menyimpan jawaban 4 untuk laporan tanpa 基準不適合) dan wajib berisi 発生日 + 内容 bila 有. Butir kosong (belum dijawab) boleh (draf).
 */
export function parseForm55(input: unknown): { ok: true; value: Form55 } | { ok: false; error: Form55Error } {
  const p = form55Schema.safeParse(input);
  if (!p.success) return { ok: false, error: "form55Invalid" };
  const f = p.data;
  if (Object.keys(f.items).some((k) => !FORM55_ITEM_CODES.includes(k))) return { ok: false, error: "form55Invalid" };
  const items: Form55["items"] = {};
  for (const code of FORM55_ITEM_CODES) {
    const it = f.items[code];
    if (!it) continue;
    if (it.a === "problem" && !it.text) return { ok: false, error: "form55ItemText" };
    items[code] = it.a === "ok" ? { a: "ok", text: "" } : it;
  }
  let response: Form55Response | null = null;
  if (f.nonconformity === true) {
    response = f.response ?? emptyResponse();
    if (!response.occurredOn || !response.content) return { ok: false, error: "form55ResponseRequired" };
  }
  return { ok: true, value: { ...f, items, response } };
}

/** Ringkasan untuk daftar/riwayat/audit: tanpa isi teks. */
export function summarizeForm55(f: Form55 | null | undefined): { filled: boolean; answered: number; problems: number; nonconformity: boolean | null } {
  if (!f) return { filled: false, answered: 0, problems: 0, nonconformity: null };
  const vals = Object.values(f.items);
  return { filled: true, answered: vals.length, problems: vals.filter((x) => x.a === "problem").length, nonconformity: f.nonconformity };
}

/** Parse longgar untuk BACA data dari database (jsonb lama/rusak -> null, tidak melempar). */
export function readForm55(raw: unknown): Form55 | null {
  if (raw === null || raw === undefined) return null;
  const p = form55Schema.safeParse(raw);
  return p.success ? p.data : null;
}

/** Kunci input form HTML (nama field) <-> struktur; dipakai form dan action supaya tidak ada definisi ganda. */
export const f55Name = {
  answer: (code: string) => `f55.${code}.a`,
  text: (code: string) => `f55.${code}.text`,
  nonconformity: "f55.nonconformity",
  special: "f55.special",
  createdOn: "f55.createdOn",
  occurredOn: "f55.r.occurredOn",
  content: "f55.r.content",
  workerKind: "f55.r.worker.kind", workerBody: "f55.r.worker.body", workerReason: "f55.r.worker.reason",
  notified: "f55.r.company.notified", notifiedOn: "f55.r.company.notifiedOn", notifiedTo: "f55.r.company.notifiedTo", notifiedReason: "f55.r.company.notifiedReason",
  immigration: "f55.r.company.immigration", immigrationNote: "f55.r.company.immigrationNote",
  reported: "f55.r.agency.reported", reportedOn: "f55.r.agency.on", reportedBody: "f55.r.agency.body", reportedReason: "f55.r.agency.reason",
} as const;

/** Bangun Form55 mentah dari data form HTML (string -> struktur). Bagian yang tidak diisi sama sekali -> null (form dianggap belum diisi). */
export function form55FromFields(get: (name: string) => string): Form55 | null {
  const s = (n: string) => get(n).trim();
  const d = (n: string) => (s(n) ? s(n) : null);
  const items: Form55["items"] = {};
  for (const code of FORM55_ITEM_CODES) {
    const a = s(f55Name.answer(code));
    if (a === "ok" || a === "problem") items[code] = { a, text: s(f55Name.text(code)) };
  }
  const nc = s(f55Name.nonconformity);
  const nonconformity = nc === "yes" ? true : nc === "no" ? false : null;
  const response: Form55Response = {
    occurredOn: d(f55Name.occurredOn), content: s(f55Name.content),
    worker: { kind: (FORM55_WORKER_HANDLING as readonly string[]).includes(s(f55Name.workerKind)) ? (s(f55Name.workerKind) as "referred" | "none") : null, body: s(f55Name.workerBody), reason: s(f55Name.workerReason) },
    company: {
      notified: (FORM55_DONE as readonly string[]).includes(s(f55Name.notified)) ? (s(f55Name.notified) as "done" | "not_done") : null, notifiedOn: d(f55Name.notifiedOn), notifiedTo: s(f55Name.notifiedTo), notifiedReason: s(f55Name.notifiedReason),
      immigration: (FORM55_DONE as readonly string[]).includes(s(f55Name.immigration)) ? (s(f55Name.immigration) as "done" | "not_done") : null, immigrationNote: s(f55Name.immigrationNote),
    },
    agency: { reported: (FORM55_DONE as readonly string[]).includes(s(f55Name.reported)) ? (s(f55Name.reported) as "done" | "not_done") : null, on: d(f55Name.reportedOn), body: s(f55Name.reportedBody), reason: s(f55Name.reportedReason) },
  };
  const special = s(f55Name.special);
  const createdOn = d(f55Name.createdOn);
  if (Object.keys(items).length === 0 && nonconformity === null && !special && !createdOn) return null;
  return { v: 1, items, nonconformity, special, response: nonconformity === true ? response : null, createdOn };
}
