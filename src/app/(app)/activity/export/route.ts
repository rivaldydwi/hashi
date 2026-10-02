import { getLocale } from "next-intl/server";
import { withTenant } from "@/db";
import { actorLabel, categoryOf, describeAudit, candidateCode } from "@/db/audit-describe";
import { exportAudit, parseAuditFilters, AUDIT_EXPORT_MAX } from "@/db/audit-history";
import { audit } from "@/lib/audit";
import { dateTimeIn, safeTimezone } from "@/lib/org-time";
import { getCurrentUser } from "@/lib/session";

const text = (status: number, body: string) => new Response(body, { status, headers: { "Cache-Control": "no-store" } });

/** Sel CSV aman: kutip, dan awali ' bila diawali = + - @ (mencegah rumus di Excel/Sheets). */
const cell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
};

/**
 * Ekspor riwayat aktivitas ke CSV. Hanya LPK_ADMIN dan TSK_ADMIN (RLS juga). Ekspor ITU SENDIRI dicatat di audit (audit.export: jumlah baris dan rentang
 * tanggal, tanpa isi). Dicatat DULU: bila gagal dicatat, tidak ada berkas. Waktu memakai zona organisasi. Tanpa nama kandidat (hanya kode).
 */
export async function GET(req: Request) {
  const lookup = await getCurrentUser();
  if (lookup.state !== "active") return text(401, "Unauthorized");
  const me = lookup.user;
  if (me.mustChangePassword || (me.role !== "LPK_ADMIN" && me.role !== "TSK_ADMIN")) return text(403, "Forbidden");

  const url = new URL(req.url);
  const f = parseAuditFilters(Object.fromEntries(url.searchParams));
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const locale = (await getLocale()) === "ja" ? "ja" : "id";
  const scope = { orgId: me.organizationId, role: me.role, userId: me.id };

  const rows = await withTenant(scope, async (tx) => {
    const data = await exportAudit(tx, { category: f.category, from: f.from, to: f.to, candidateId: f.candidateId }, tz);
    await audit(tx, {
      organizationId: me.organizationId,
      actorUserId: me.id,
      action: "audit.export",
      entity: "audit_export",
      after: { rows: data.length, from: f.from || undefined, to: f.to || undefined } as Record<string, unknown>,
    });
    return data;
  });

  const head = locale === "ja" ? ["日時", "実行者", "分類", "内容", "候補者コード", "操作"] : ["Waktu", "Pelaku", "Kategori", "Aktivitas", "Kode kandidat", "Aksi"];
  const lines = [head.map(cell).join(",")];
  for (const e of rows) {
    const d = describeAudit(e, locale);
    lines.push([dateTimeIn(e.createdAt, locale, tz), actorLabel(e, locale), categoryOf(e.action), d.text, e.candidateId ? candidateCode(e.candidateId) : "", e.action].map(cell).join(","));
  }
  const body = "﻿" + lines.join("\r\n") + "\r\n"; // BOM supaya Excel membaca UTF-8
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="riwayat-aktivitas-${stamp}.csv"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...(rows.length >= AUDIT_EXPORT_MAX ? { "X-Export-Truncated": "1" } : {}),
    },
  });
}
