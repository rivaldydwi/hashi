// Pembantu route handler ekspor PDF dan unduhan lampiran: otorisasi staf TSK, pencatatan audit, dan respons berkas privat.
import { withTenant, type Tx } from "@/db";
import { audit } from "@/lib/audit";
import { safeTimezone } from "@/lib/org-time";
import { getCurrentUser, type CurrentUser } from "@/lib/session";
import { isStaff } from "./access";

export const text = (status: number, body: string) => new Response(body, { status, headers: { "Cache-Control": "no-store" } });
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Staf TSK yang sudah login dan bukan kata sandi sementara; selain itu respons error (401/403/404: LPK tidak diberi tahu halamannya ada). */
export async function staffOrResponse(): Promise<{ me: CurrentUser; scope: { orgId: string; role: CurrentUser["role"]; userId: string }; tz: string } | Response> {
  const lookup = await getCurrentUser();
  if (lookup.state !== "active") return text(401, "Unauthorized");
  const me = lookup.user;
  if (!isStaff(me)) return text(404, "Not found");
  if (me.mustChangePassword) return text(403, "Forbidden");
  return { me, scope: { orgId: me.organizationId, role: me.role, userId: me.id }, tz: safeTimezone(me.organizationTimezone, me.organizationType) };
}

/** Catat ekspor di audit (jenis, jumlah baris/catatan, versi klien). TIDAK ada isi, nama pekerja, atau nama berkas. */
export function auditExport(tx: Tx, me: CurrentUser, p: { exportKind: string; rows: number; clientVersion: boolean }) {
  return audit(tx, { organizationId: me.organizationId, actorUserId: me.id, action: "activity_export", entity: "activity_export", entityId: undefined, after: { exportKind: p.exportKind, rows: p.rows, clientVersion: p.clientVersion } });
}

export function pdfResponse(buf: Buffer, filename: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

export { withTenant };
