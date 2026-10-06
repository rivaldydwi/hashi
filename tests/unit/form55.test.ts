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
  workerName: "ダミー 太郎", orgName: "さくらフーズ株式会社", interviewDate: "2026-09-15", method: "online", responderName: "鈴木 花子", responderRole: "support_staff", responderTitle: "主任", form, ...over,
});
const fullForm = (): Form55 => {
  const r = parseForm55(form55FromFields(fields({
    [f55Name.answer("work.1")]: "ok", [f55Name.answer("treatment.3")]: "problem", [f55Name.text("treatment.3")]: "有給の取得が難しい（ISI-TREATMENT3）",
    [f55Name.answer("protection.4")]: "ok", [f55Name.nonconformity]: "yes", [f55Name.special]: "TOKKI-ISI", [f55Name.createdOn]: "2026-09-20",
    [f55Name.occurredOn]: "2026-09-01", [f55Name.content]: "KEJADIAN-ISI", [f55Name.workerKind]: "referred", [f55Name.workerBody]: "労働基準監督署",
    [f55Name.notified]: "done", [f55Name.notifiedOn]: "2026-09-03", [f55Name.notifiedTo]: "工場長", [f55Name.immigration]: "not_done", [f55Name.immigrationNote]: "IMM-CATATAN",
    [f55Name.reported]: "not_done", [f55Name.reportedReason]: "ALASAN-INSTANSI",
  }))!);
  assert.ok(r.ok);
  return (r as { ok: true; value: Form55 }).value;
};

test("PDF per wawancara: bagian 1-3 dan butir pada tempatnya; bagian 4 hanya bila ⑥ = 有", async () => {
  const { n, text } = await read(await renderForm55Pdf(ctx, data({}, fullForm())));
  const t = norm(text);
  assert.ok(n >= 1);
  for (const s of ["参考様式第5-5号", "定期面談報告書（1号特定技能外国人用）", "1面談対象者", "ダミー太郎", "さくらフーズ株式会社", "2026/09/15", "□対面", "■オンライン", "■支援担当者", "主任", "鈴木花子", "3面談結果", "①業務内容", "⑤その他"]) assert.ok(t.includes(s), `tidak ada: ${s}`);
  for (const g of FORM55_GROUPS) for (const it of g.items) assert.ok(t.includes(norm(it.ja)), `butir tidak tercetak: ${it.code}`);
  assert.ok(t.includes("ISI-TREATMENT3") && t.includes("TOKKI-ISI"));
  assert.ok(t.includes("4基準不適合等への対応") && t.includes("KEJADIAN-ISI") && t.includes("労働基準監督署") && t.includes("工場長") && t.includes("IMM-CATATAN") && t.includes("ALASAN-INSTANSI"));
  assert.ok(t.includes("2026/09/20") && t.includes("作成年月日") && t.includes("面談実施者の氏名"));
  // tanpa 基準不適合: bagian 4 tidak ada
  const none = parseForm55({ ...fullForm(), nonconformity: false, response: null }) as { ok: true; value: Form55 };
  const t2 = norm((await read(await renderForm55Pdf(ctx, data({}, none.value)))).text);
  assert.ok(!t2.includes("4基準不適合等への対応") && !t2.includes("KEJADIAN-ISI"));
  assert.ok(t2.includes("なし"));
});

test("PDF form kosong (data lama): tetap tercetak, butir kosong, tanpa galat", async () => {
  const { text } = await read(await renderForm55Pdf(ctx, data({ method: null, responderName: null, responderRole: null, responderTitle: null }, null)));
  const t = norm(text);
  assert.ok(t.includes("□対面") && t.includes("□オンライン") && t.includes("③保護") && !t.includes("4基準不適合等への対応"));
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
