import assert from "node:assert/strict";
import { test } from "node:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { FORM55_GROUPS, FORM55_ITEM_CODES, emptyResponse, f55Name, form55FromFields, parseForm55, readForm55, summarizeForm55, type Form55 } from "../../src/db/form55";
import { renderForm55Pdf, renderForm55YearPdf, type Form55PdfData } from "../../src/lib/pdf/form55";

const ctx = { orgName: "TSK Demo Tokyo", tz: "Asia/Tokyo", now: new Date("2026-10-06T05:20:00Z") };
async function read(buf: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join(" "));
  return { n: doc.numPages, text: pages.join("\n") };
}
const norm = (s: string) => s.replace(/\s+/g, "");
const fields = (o: Record<string, string>) => (n: string) => o[n] ?? "";

test("daftar butir: 3+6+5+2+2 = 18 butir, kode unik dan tetap", () => {
  assert.deepEqual(FORM55_GROUPS.map((g) => g.items.length), [3, 6, 5, 2, 2]);
  assert.equal(new Set(FORM55_ITEM_CODES).size, 18);
  assert.ok(FORM55_GROUPS.every((g) => g.items.every((i) => i.ja && i.id && i.code.startsWith(g.key))));
});

test("form kosong dari HTML = null (belum diisi, data lama tetap sah)", () => {
  assert.equal(form55FromFields(fields({})), null);
  assert.equal(summarizeForm55(null).filled, false);
  assert.equal(readForm55(null), null);
  assert.equal(readForm55({ v: 99 }), null); // jsonb rusak tidak melempar
});

test("butir 'problem' wajib punya isi; 'ok' membuang teks; kode asing ditolak", () => {
  const raw = form55FromFields(fields({ [f55Name.answer("work.1")]: "problem", [f55Name.text("work.1")]: "" }))!;
  const bad = parseForm55(raw);
  assert.deepEqual(bad, { ok: false, error: "form55ItemText" });
  const ok = parseForm55(form55FromFields(fields({ [f55Name.answer("work.1")]: "ok", [f55Name.text("work.1")]: "sisa teks", [f55Name.answer("life.2")]: "problem", [f55Name.text("life.2")]: "sakit gigi" }))!);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value.items["work.1"], { a: "ok", text: "" });
    assert.equal(ok.value.items["life.2"].text, "sakit gigi");
  }
  const foreign = parseForm55({ v: 1, items: { "work.9": { a: "ok", text: "" } }, nonconformity: null, special: "", response: null, createdOn: null });
  assert.deepEqual(foreign, { ok: false, error: "form55Invalid" });
});

test("⑥ 有 mewajibkan 発生日 + 内容; ⑥ なし/belum dijawab membuang jawaban bagian 4", () => {
  const base = { [f55Name.nonconformity]: "yes" };
  assert.deepEqual(parseForm55(form55FromFields(fields(base))!), { ok: false, error: "form55ResponseRequired" });
  const good = parseForm55(form55FromFields(fields({ ...base, [f55Name.occurredOn]: "2026-09-01", [f55Name.content]: "isi kejadian", [f55Name.workerKind]: "none", [f55Name.workerReason]: "tidak perlu" }))!);
  assert.ok(good.ok && good.value.response?.content === "isi kejadian");
  const no = form55FromFields(fields({ [f55Name.nonconformity]: "no", [f55Name.content]: "tidak boleh tersimpan", [f55Name.occurredOn]: "2026-09-01" }))!;
  assert.equal(no.response, null);
  const p = parseForm55(no);
  assert.ok(p.ok && p.value.response === null && p.value.nonconformity === false);
  // response diberikan langsung tetapi ⑥ = なし: dibuang
  const sneaky = parseForm55({ ...no, response: { ...emptyResponse(), occurredOn: "2026-09-01", content: "x" } });
  assert.ok(sneaky.ok && sneaky.value.response === null);
});

test("ringkasan untuk audit/daftar: hitungan saja, tanpa teks", () => {
  const f = (parseForm55(form55FromFields(fields({ [f55Name.answer("work.1")]: "ok", [f55Name.answer("work.2")]: "problem", [f55Name.text("work.2")]: "RAHASIA", [f55Name.nonconformity]: "no" }))!) as { ok: true; value: Form55 }).value;
  const s = summarizeForm55(f);
  assert.deepEqual(s, { filled: true, answered: 2, problems: 1, nonconformity: false });
  assert.ok(!JSON.stringify(s).includes("RAHASIA"));
});

const data = (over: Partial<Form55PdfData> = {}, form: Form55 | null = null): Form55PdfData => ({
  workerName: "ダミー 太郎", orgName: "さくらフーズ株式会社", interviewDate: "2026-09-15", method: "online", responderName: "鈴木 花子", responderRole: "support_staff", responderTitle: "主任", form, savedOn: "2026-09-25", ...over,
});
const fullForm = (): Form55 => {
  const r = parseForm55(form55FromFields(fields({
    [f55Name.answer("work.1")]: "ok", [f55Name.answer("treatment.3")]: "problem", [f55Name.text("treatment.3")]: "有給の取得が難しい（ISI-TREATMENT3）",
    [f55Name.answer("protection.4")]: "ok", [f55Name.nonconformity]: "yes", [f55Name.special]: "TOKKI-ISI", [f55Name.otherLabel]: "通勤手段", [f55Name.createdOn]: "2026-09-20",
    [f55Name.occurredOn]: "2026-09-01", [f55Name.content]: "KEJADIAN-ISI", [f55Name.workerKind]: "referred", [f55Name.workerBody]: "労働基準監督署",
    [f55Name.notified]: "done", [f55Name.notifiedOn]: "2026-09-03", [f55Name.notifiedTo]: "工場長", [f55Name.immigration]: "not_done", [f55Name.immigrationNote]: "IMM-CATATAN",
    [f55Name.reported]: "not_done", [f55Name.reportedReason]: "ALASAN-INSTANSI",
  }))!);
  assert.ok(r.ok);
  return (r as { ok: true; value: Form55 }).value;
};

test("PDF per wawancara: label bagian 1-2, kalimat butir RESMI, ⑤(2) その他（isian）, ⑥/⑦, bagian 4 hanya bila ⑥ = 有", async () => {
  const { n, text } = await read(await renderForm55Pdf(ctx, data({}, fullForm())));
  const t = norm(text);
  assert.ok(n >= 1);
  for (const s of [
    "参考様式第5－5号", "定期面談報告書（1号特定技能外国人用）", "1面談対象者", "①特定技能外国人の氏名", "ダミー太郎", "②特定技能所属機関の氏名又は名称", "さくらフーズ株式会社", "③面談日", "2026/09/15",
    "④方式", "□対面", "■オンライン", "2面談対応者", "①対応者の氏名", "鈴木花子", "②対応者の役職", "■支援担当者", "□支援責任者", "役職名", "主任",
    "3面談結果", "面談事項", "面談内容", "問題の有無", "問題の内容", "①業務内容に関する事項", "②待遇に関する事項", "③保護に関する事項", "④生活に関する事項", "⑤その他の事項",
    "雇用契約と異なる業務に従事していないこと。", "他の事業主の下で業務に従事していないこと。", "安全衛生に配慮して適切に業務を行っていること。",
    "休日、休暇等が適切に付与されていること（一時帰国休暇を含む）", "定期的に負担する食費、居住費等が合意したとおりの内容であること。", "支援計画にのっとった支援の提供を受けていること。",
    "相手方を問わず保証金の徴収・違約金を定める契約等がないこと。", "旅券・在留カードを自分で保管していること。", "健康状態に異常がないこと。", "不法就労者が働いていないこと。", "その他（通勤手段）",
    "⑥基準不適合等の有無", "■有り（下記4に詳細を記載）", "□なし", "⑦その他特筆すべき事項", "TOKKI-ISI", "■有□無", // butir 有 (③待遇(3))
  ]) assert.ok(t.includes(norm(s)), `tidak ada: ${s}`);
  for (const g of FORM55_GROUPS) for (const it of g.items) if (it.code !== "other.2") assert.ok(t.includes(norm(it.ja)), `butir tidak tercetak: ${it.code}`);
  assert.ok(t.includes("ISI-TREATMENT3"));
  assert.ok(t.includes("4基準不適合等への対応") && t.includes("①基準不適合等の発生年月日") && t.includes("②基準不適合等の内容") && t.includes("KEJADIAN-ISI"));
  for (const s of ["③基準不適合等への対応結果", "ア1号特定技能外国人への対応", "■労働基準監督署等の関係行政機関案内（案内した機関:労働基準監督署）", "□特段対応なし", "イ特定技能所属機関への対応", "(ア)責任者への基準不適合等の通知", "■通知済み（通知日:2026/09/03/通知の相手方:工場長）", "□未通知",
    "(イ)基準不適合等の出入国在留管理庁への案内", "□案内済み□未了".replace("□未了", "■未了"), "IMM-CATATAN", "ウ関係行政機関への対応", "□関係行政機関へ通報済み", "■関係行政機関への通報未了（通報不要と判断した場合を含む。）（理由:ALASAN-INSTANSI）"]) assert.ok(t.includes(norm(s)), `bagian 4 tidak ada: ${s}`);
  assert.ok(!t.includes("所属機関（受入れ企業）"), "istilah non-resmi tidak boleh ada");
  assert.ok(t.includes("2026/09/20") && t.includes("作成年月日") && t.includes("面談実施者の氏名"));
  // tanpa 基準不適合: bagian 4 tidak ada
  const none = parseForm55({ ...fullForm(), nonconformity: false, response: null }) as { ok: true; value: Form55 };
  const t2 = norm((await read(await renderForm55Pdf(ctx, data({}, none.value)))).text);
  assert.ok(!t2.includes("4基準不適合等への対応") && !t2.includes("KEJADIAN-ISI"));
  assert.ok(t2.includes("■なし") && t2.includes("□有り（下記4に詳細を記載）"));
});

test("作成年月日: eksplisit dipakai; kosong = tanggal form terakhir disimpan (savedOn), BUKAN tanggal wawancara", async () => {
  const f = fullForm();
  const explicit = norm((await read(await renderForm55Pdf(ctx, data({}, f)))).text);
  assert.ok(explicit.includes("作成年月日2026/09/20"));
  const auto = parseForm55({ ...f, createdOn: null }) as { ok: true; value: Form55 };
  const t = norm((await read(await renderForm55Pdf(ctx, data({ savedOn: "2026-10-02" }, auto.value)))).text);
  assert.ok(t.includes("作成年月日2026/10/02") && !t.includes("作成年月日2026/09/15"));
  const none = norm((await read(await renderForm55Pdf(ctx, data({ savedOn: "2026-10-03" }, null)))).text);
  assert.ok(none.includes("作成年月日2026/10/03"));
});

test("header PDF: nomor form resmi di kiri atas, nama organisasi kecil di kanan; formulir lama tanpa otherLabel tetap terbaca (default kosong)", async () => {
  const { text } = await read(await renderForm55Pdf(ctx, data({}, fullForm())));
  assert.ok(text.indexOf("参考様式第5－5号") < text.indexOf("TSK Demo Tokyo"));
  const old = readForm55({ v: 1, items: {}, nonconformity: null, special: "", response: null, createdOn: null }); // data T-009 awal (tanpa otherLabel)
  assert.equal(old?.otherLabel, "");
});

test("PDF form kosong (data lama): tetap tercetak, butir kosong, tanpa galat", async () => {
  const { text } = await read(await renderForm55Pdf(ctx, data({ method: null, responderName: null, responderRole: null, responderTitle: null }, null)));
  const t = norm(text);
  assert.ok(t.includes("□対面") && t.includes("□オンライン") && t.includes("③保護に関する事項") && !t.includes("4基準不適合等への対応"));
});

test("PDF gabungan setahun: satu form per pekerja-bulan, urut seperti diberikan; tanpa form = halaman kosong berpesan", async () => {
  const a = data({ interviewDate: "2026-06-10", responderName: "BULAN-ENAM" }, fullForm());
  const b = data({ interviewDate: "2026-09-15", responderName: "BULAN-SEMBILAN" }, null);
  const { n, text } = await read(await renderForm55YearPdf(ctx, { fy: 2026, workerName: "ダミー 太郎", forms: [a, b] }));
  assert.ok(n >= 3, `halaman: ${n}`);
  assert.ok(text.indexOf("BULAN-ENAM") < text.indexOf("BULAN-SEMBILAN"));
  assert.equal((norm(text).match(/1面談対象者/g) ?? []).length, 2);
  const empty = await read(await renderForm55YearPdf(ctx, { fy: 2026, workerName: "ダミー 太郎", forms: [] }));
  assert.equal(empty.n, 1);
});
