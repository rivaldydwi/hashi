// Pembantu route handler ekspor lembar klien (langkah 6): parameter, nama berkas netral, dan audit `client_sheet_export` (tanpa nama perusahaan/isi).
import { audit } from "@/lib/audit";
import type { LabelLang, SheetKind, SheetMode } from "@/lib/pdf/client-sheet.config";
import type { CurrentUser } from "@/lib/session";
import type { Tx } from "@/db";

export type SheetParams = { mode: SheetMode; lang: LabelLang; confirmed: boolean };

/** `mode` dan `lang` harus nilai yang dikenal (null = 400). Versi dibagikan hanya sah bila `confirm=1` (centang konfirmasi di dialog). */
export function parseSheetParams(url: URL): SheetParams | null {
  const mode = url.searchParams.get("mode");
  const lang = url.searchParams.get("lang") ?? "ja";
  if ((mode !== "internal" && mode !== "share") || (lang !== "ja" && lang !== "jaid")) return null;
  return { mode, lang, confirmed: url.searchParams.get("confirm") === "1" };
}

/** Nama berkas netral: tanpa nama perusahaan, lokasi, atau pekerja. */
export function sheetFilename(kind: SheetKind, now: Date): string {
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `${kind === "company" ? "profil-klien" : "lembar-job-order"}-${stamp}.pdf`;
}

export function auditSheetExport(tx: Tx, me: CurrentUser, p: { kind: SheetKind; mode: SheetMode; lang: LabelLang; pages: number }) {
  return audit(tx, {
    organizationId: me.organizationId, actorUserId: me.id, action: "client_sheet_export", entity: "client_sheet_export", entityId: undefined,
    after: { sheetKind: p.kind, mode: p.mode, labelLang: p.lang, pages: p.pages },
  });
}
