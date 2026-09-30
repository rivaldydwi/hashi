import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db";
import { candidateDocuments, candidates } from "@/db/schema";
import { audit } from "@/lib/audit";
import { attachmentHeader, documentPath, extForMime } from "@/features/documents/storage";
import { isTskRole } from "@/features/candidates/permissions";
import { getCurrentUser } from "@/lib/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (status: number, body: string) => new Response(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Unduh dokumen. Login wajib; RLS menentukan dokumen mana yang terlihat (LPK_ADMIN pemilik, TSK mitra
 * dengan persetujuan data). Sensei tidak pernah. Setiap unduhan dicatat di audit_logs (document.download).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const lookup = await getCurrentUser();
  if (lookup.state !== "active") return text(401, "Unauthorized");
  const me = lookup.user;
  if (me.mustChangePassword) return text(403, "Forbidden");
  if (me.role !== "LPK_ADMIN" && !isTskRole(me.role)) return text(403, "Forbidden"); // sensei, super admin

  const { id, docId } = await ctx.params;
  if (!UUID.test(id) || !UUID.test(docId)) return text(404, "Not found");
  const scope = { orgId: me.organizationId, role: me.role, userId: me.id };

  const doc = await withTenant(scope, async (tx) => {
    const [row] = await tx
      .select({
        id: candidateDocuments.id,
        type: candidateDocuments.type,
        mime: candidateDocuments.mimeType,
        name: candidateDocuments.originalFilename,
        size: candidateDocuments.sizeBytes,
        candidateId: candidateDocuments.candidateId,
        lpkOrgId: candidates.organizationId,
      })
      .from(candidateDocuments)
      .innerJoin(candidates, eq(candidates.id, candidateDocuments.candidateId))
      .where(and(eq(candidateDocuments.id, docId), eq(candidateDocuments.candidateId, id)))
      .limit(1);
    return row;
  });
  if (!doc) return text(404, "Not found"); // tidak ada ATAU tidak terlihat (RLS): sama saja bagi pemanggil

  const ext = extForMime(doc.mime);
  const file = documentPath(doc.lpkOrgId, doc.candidateId, doc.id, ext); // path dari database, bukan dari user
  try {
    await stat(file);
  } catch {
    return text(404, "File not found");
  }

  // Catat DULU; bila gagal dicatat, tidak ada unduhan. Hanya id + jenis dokumen, tanpa isi.
  await withTenant(scope, (tx) =>
    audit(tx, {
      organizationId: doc.lpkOrgId,
      actorOrgId: me.organizationId,
      candidateId: doc.candidateId,
      actorUserId: me.id,
      action: "document.download",
      entity: "candidate_document",
      entityId: doc.id,
      after: { type: doc.type },
    }),
  );

  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": doc.mime,
      "Content-Length": String(doc.size),
      "Content-Disposition": attachmentHeader(doc.name, `${doc.type.toLowerCase()}-${doc.id.slice(0, 8)}`, ext),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
