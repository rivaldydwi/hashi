import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderCasePdf, renderDailyReportPdf, renderInterviewPdf, renderRecordPdf, type DailyData, type MeetingData } from "../../src/lib/pdf/exports";

const ctx = { orgName: "TSK Demo Tokyo", tz: "Asia/Tokyo", now: new Date("2026-10-05T05:20:00Z") };

async function read(buf: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
  }
  return { pages, n: doc.numPages, text: pages.join("\n") };
}
const norm = (s: string) => s.replace(/\s+/g, "");

const daily = (over: Partial<DailyData> = {}): DailyData => ({
  date: "2026-10-05", authorName: "Rina Staf TSK", subjects: ["Budi Hidayat"], site: "さくらフーズ株式会社 / 本社工場", workType: "interview", workTypeOther: null,
  actionTaken: "電話で本人と面談し、勤務状況を確認した。", result: "問題なし。体調も良好。", pending: "次回の面談日程を調整する。", nextAction: "来月、訪問して確認する。", reportTo: "田中 一郎", note: "特記事項なし", status: "active", voidReason: null, photos: [], ...over,
});

test("① PDF: label baku dan isi Jepang benar-benar ada di teks PDF; font Noto Sans JP tersemat; nomor halaman n / N", async () => {
  const buf = await renderRecordPdf(ctx, { kind: "daily_work", data: daily() });
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  const { text, n, pages } = await read(buf);
  for (const label of ["業務記録", "日付", "担当者", "対象者", "所属先", "業務内容", "対応内容", "結果・状況", "未対応・継続事項", "今後の対応", "共有・報告先", "備考"]) assert.ok(norm(text).includes(label), `label hilang: ${label}`);
  for (const v of ["電話で本人と面談し", "問題なし。体調も良好。", "さくらフーズ株式会社", "2026年10月5日", "Budi Hidayat", "面談"]) assert.ok(norm(text).includes(norm(v)), `isi hilang: ${v}`);
  assert.ok(norm(text).includes("作成日時:2026/10/0514:20"), "tanggal pembuatan menurut zona Tokyo"); // 05:20Z = 14:20 JST
  assert.ok(norm(pages[n - 1]).includes(`${n}/${n}`), "nomor halaman terakhir n / N");
  assert.ok(buf.includes(Buffer.from("FontFile2")) && /NotoSansJP/.test(buf.toString("latin1")), "font Jepang tersemat (subset)");
});

test("② PDF: bagian kosong dilewati dan penomoran mengikuti yang tampil", async () => {
  const m: MeetingData = {
    subject: "技能実習生の勤務条件について", startedAt: new Date("2026-10-03T01:00:00Z"), endedAt: new Date("2026-10-03T02:30:00Z"), subjects: ["Budi Hidayat"], handlers: ["田中 一郎", "Rina Staf TSK"], method: "online",
    sections: { consultation: ["残業時間の確認"], nextAction: ["来週再度連絡する"], pending: ["寮の備品交換"] }, status: "active", voidReason: null, photos: [],
  };
  const { text } = await read(await renderRecordPdf(ctx, { kind: "meeting", data: m }));
  const t = norm(text);
  assert.ok(t.includes("件名:技能実習生の勤務条件について"));
  for (const l of ["日時", "対象者", "対応者", "場所・方法", "オンライン"]) assert.ok(t.includes(l), l);
  assert.ok(t.includes("1.相談・面談内容") && t.includes("2.今後の対応") && t.includes("3.未対応事項"), "penomoran berurutan 1,2,3 untuk bagian yang tampil");
  assert.ok(!t.includes("本人の話・意向") && !t.includes("現在の状況") && !t.includes("共有事項"), "bagian kosong tidak dicetak");
  assert.ok(t.includes("2026/10/0310:00"), "waktu mulai di zona Tokyo (01:00Z = 10:00 JST)");
});

test("laporan harian memuat semua ① hari itu berurutan dengan judul 業務記録 2026年10月5日; record batal ditandai", async () => {
  const { text } = await read(await renderDailyReportPdf(ctx, { date: "2026-10-05", staffName: "Rina Staf TSK", records: [daily({ actionTaken: "最初の対応" }), daily({ actionTaken: "二番目の対応", status: "void", voidReason: "入力ミス" })] }));
  const t = norm(text);
  assert.ok(t.includes("業務記録2026年10月5日"));
  assert.ok(t.indexOf("最初の対応") < t.indexOf("二番目の対応"));
  assert.ok(t.includes("取消済み:入力ミス"));
});

test("時系列: internal memuat nama penyusun dan baris batal; klien tanpa nama staf, tanpa kode kasus, 備考 mengikuti pilihan", async () => {
  const kase = { code: "K-2026-0007", title: "寮の騒音トラブル", category: "trouble", status: "open", openedAt: new Date("2026-10-01T00:00:00Z"), subjects: ["Budi Hidayat"], site: "さくらフーズ株式会社 / 本社工場" };
  const events = [
    { occurredAt: new Date("2026-10-02T03:30:00Z"), timeKnown: true, event: "夜間に騒音の苦情があった", subjectStatement: "「眠れなかった」と本人が述べた", companyResponse: "寮長に連絡した", note: "備考ひみつ文", status: "active", voidReason: null, creatorName: "Rina Staf TSK" },
    { occurredAt: new Date("2026-10-03T00:00:00Z"), timeKnown: false, event: "誤記入の行", subjectStatement: null, companyResponse: null, note: null, status: "void", voidReason: "重複", creatorName: "田中 一郎" },
  ];
  const internal = norm((await read(await renderCasePdf(ctx, { mode: "internal", includeNotes: true, kase, events }))).text);
  assert.ok(internal.includes("K-2026-0007") && internal.includes("RinaStafTSK") && internal.includes("【取消済み】重複"));
  for (const h of ["日時", "出来事・状況", "本人の発言・対応", "当社の対応", "備考"]) assert.ok(internal.includes(h), h);
  const clientEvents = events.filter((e) => e.status === "active");
  const client = norm((await read(await renderCasePdf(ctx, { mode: "client", includeNotes: true, kase, events: clientEvents }))).text);
  assert.ok(client.includes("夜間に騒音の苦情があった") && client.includes("備考ひみつ文") && client.includes("備考"), "備考 tetap tampil");
  assert.ok(!client.includes("RinaStafTSK") && !client.includes("田中一郎") && !client.includes("K-2026-0007") && !client.includes("作成:"), "tanpa nama penyusun dan kode internal");
  assert.ok(!client.includes("誤記入の行"), "baris batal tidak ikut");
  const noNote = norm((await read(await renderCasePdf(ctx, { mode: "client", includeNotes: false, kase, events: clientEvents }))).text);
  assert.ok(!noNote.includes("備考ひみつ文") && !noNote.includes("備考"), "kolom 備考 hilang bila dimatikan");
});

test("定期面談: judul tahun fiskal, identitas pekerja, 対象外, dan catatan kuartal", async () => {
  const rows = new Map([
    ["2026-04-01", { month: "2026-04-01", applicable: true, interviewDate: "2026-04-20", resultStatus: "no_issue", reason: "agency", content: "仕事は順調", staffName: "Rina", note: null }],
    ["2026-05-01", { month: "2026-05-01", applicable: false, interviewDate: null, resultStatus: null, reason: null, content: null, staffName: null, note: "一時帰国" }],
    ["2026-06-01", { month: "2026-06-01", applicable: true, interviewDate: "2026-06-18", resultStatus: "follow_up", reason: "worker", content: "寮について相談", staffName: "田中", note: null }],
  ]);
  const { text } = await read(await renderInterviewPdf(ctx, { fy: 2026, worker: { name: "Budi Hidayat", field: "外食業", startDate: "2026-04-01", company: "さくらフーズ株式会社", address: "東京都千代田区1-1", phone: "03-0000-0000", pic: "山田 太郎" }, rows, quarterNotes: new Map([[1, "第一四半期は安定"]]) }));
  const t = norm(text);
  assert.ok(t.includes("定期面談2026/4-2027/3"));
  for (const l of ["氏名", "特定技能分野", "就労開始日", "配属先企業名", "面談日", "ステータス", "面談内容", "実施理由", "担当者", "Q1備考:第一四半期は安定", "Q2備考"]) assert.ok(t.includes(l), l);
  assert.ok(t.includes("対象外") && t.includes("問題なし") && t.includes("要フォロー") && t.includes("機関判断") && t.includes("本人申出"));
  assert.ok(t.includes("2026/04/01") || t.includes("2026/4/1"));
});

test("foto: JPEG disematkan ke PDF dan jumlah halaman bertambah untuk isi panjang", async () => {
  const jpeg = await sharp({ create: { width: 320, height: 200, channels: 3, background: "#c2410c" } }).jpeg().toBuffer();
  const long = "長い文章。".repeat(400);
  const buf = await renderRecordPdf(ctx, { kind: "daily_work", data: daily({ actionTaken: long, photos: [{ data: jpeg, caption: "現場の写真" }] }) });
  const { text, n, pages } = await read(buf);
  assert.ok(n >= 2, "isi panjang menghasilkan lebih dari satu halaman");
  assert.ok(norm(pages[0]).includes(`1/${n}`) && norm(pages[n - 1]).includes(`${n}/${n}`), "nomor halaman n / N benar");
  assert.ok(buf.includes(Buffer.from("DCTDecode")), "gambar JPEG tertanam");
  assert.ok(norm(text).includes("現場の写真") && norm(text).includes("写真"));
});
