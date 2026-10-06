// Menggambar lembar klien (langkah 6) dari model `Sheet` (client-sheet-model.ts) memakai PdfBuilder bersama dari 7A.
import { PdfBuilder } from "./core";
import { jaDateTime } from "./dates";
import type { Sheet } from "./client-sheet-model";

export type SheetPdfCtx = { orgName: string; tz: string; now: Date };

export async function renderSheetPdf(ctx: SheetPdfCtx, sheet: Sheet): Promise<{ buf: Buffer; pages: number }> {
  const b = new PdfBuilder({ orgName: ctx.orgName, headerRight: sheet.headerRight, createdAt: jaDateTime(ctx.now, ctx.tz), title: sheet.docTitle });
  b.para(sheet.badge, { size: 8.5, color: "#6B645B" });
  b.title(sheet.title, sheet.subtitle || undefined);
  for (const s of sheet.sections) {
    b.h2(s.heading);
    if (s.kind === "kv") b.kv(s.rows, 130);
    else if (s.kind === "text") b.para(s.text);
    else if (s.kind === "blocks") {
      for (const blk of s.blocks) {
        b.para(blk.heading, { bold: true, size: 10 });
        if (blk.rows.length) b.kv(blk.rows, 130);
      }
    } else b.table(s.cols, s.rows.map((cells) => ({ cells })));
  }
  const pages = b.pageCount;
  const buf = await b.finish();
  return { buf, pages };
}
