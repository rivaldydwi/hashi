import { readFile } from "node:fs/promises";
import { and, eq, isNull } from "drizzle-orm";
import { activityAttachments } from "@/db/schema";
import { UUID, staffOrResponse, text, withTenant } from "@/features/records/export-route";
import { attachmentPath } from "@/features/records/images";
import { audit } from "@/lib/audit";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Unduh/tampilkan lampiran foto: login + RLS (hanya staf TSK organisasi pemilik). Dibuka langsung (unduh) = dicatat di audit; tampilan miniatur di halaman
 * (Sec-Fetch-Dest: image) tidak dicatat per gambar supaya log tidak penuh, sama seperti tampilan halaman itu sendiri. `attachment` + nosniff.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await staffOrResponse();
  if (g instanceof Response) return g;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return text(404, "Not found");
  const inline = req.headers.get("sec-fetch-dest") === "image";
  const att = await withTenant(g.scope, async (tx) => {
    const [row] = await tx.select().from(activityAttachments).where(and(eq(activityAttachments.id, id), isNull(activityAttachments.removedAt))).limit(1);
    if (!row) return null;
    if (!inline) await audit(tx, { organizationId: g.me.organizationId, actorUserId: g.me.id, action: "activity_attachment.download", entity: "activity_attachment", entityId: id });
    return row;
  });
  if (!att) return text(404, "Not found");
  let data: Buffer;
  try {
    data = await readFile(attachmentPath(g.me.organizationId, att.id, EXT[att.mime]));
  } catch {
    return text(404, "File not found");
  }
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": att.mime, "Content-Disposition": `attachment; filename="foto-${att.id.slice(0, 8)}.${EXT[att.mime]}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Length": String(data.length) },
  });
}
