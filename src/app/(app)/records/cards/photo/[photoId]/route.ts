import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db";
import { residenceCardPhotos, residenceCards } from "@/db/schema";
import { cardLog } from "@/features/cards/guards";
import { readCardPhoto } from "@/features/cards/secret-storage";
import { isStaff } from "@/features/records/access";
import { CardDecryptError, CardKeyError } from "@/lib/card-crypto";
import { getCurrentUser } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (status: number, body: string) => new Response(body, { status, headers: { "Cache-Control": "no-store" } });
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };

/**
 * Unduh foto 在留カード (T-020). Login staf TSK; RLS (`card_editor`) menentukan: HANYA TSK_ADMIN dan 担当 efektif pekerja yang melihat barisnya (selain itu 404, sama seperti tidak ada).
 * Dicatat di audit (`residence_card.photo_view`, sisi saja) SEBELUM berkas didekripsi. `attachment` + `nosniff`, tanpa cache. Kunci hilang / berkas rusak: 500 tanpa rincian.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ photoId: string }> }) {
  const lookup = await getCurrentUser();
  if (lookup.state !== "active") return text(401, "Unauthorized");
  const me = lookup.user;
  if (me.mustChangePassword || !isStaff(me)) return text(403, "Forbidden");
  const { photoId } = await ctx.params;
  if (!UUID.test(photoId)) return text(404, "Not found");

  const photo = await withTenant({ orgId: me.organizationId, role: me.role, userId: me.id }, async (tx) => {
    const [row] = await tx
      .select({ id: residenceCardPhotos.id, cardId: residenceCardPhotos.cardId, side: residenceCardPhotos.side, mime: residenceCardPhotos.mime, orgId: residenceCardPhotos.organizationId, cardStatus: residenceCards.status })
      .from(residenceCardPhotos)
      .innerJoin(residenceCards, eq(residenceCards.id, residenceCardPhotos.cardId))
      .where(and(eq(residenceCardPhotos.id, photoId), isNull(residenceCardPhotos.removedAt)))
      .limit(1);
    if (!row || row.cardStatus !== "active") return null;
    await cardLog(tx, me, "residence_card.photo_view", row.cardId, { side: row.side }); // gagal dicatat = tidak ada unduhan
    return row;
  });
  if (!photo) return text(404, "Not found");

  let data: Buffer;
  try {
    data = await readCardPhoto(photo.orgId, photo.id);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return text(404, "File not found");
    if (err instanceof CardKeyError || err instanceof CardDecryptError) return text(500, "Tidak bisa membuka berkas (kunci atau berkas bermasalah)");
    throw err;
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": photo.mime,
      "Content-Length": String(data.length),
      "Content-Disposition": `attachment; filename="residence-card-${photo.side}.${EXT[photo.mime] ?? "bin"}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
