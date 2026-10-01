import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  candidates,
  candidateSelections,
  candidateStage,
  organizations,
  selectionDecision,
  type CandidateStage,
  type SelectionDecision,
} from "@/db/schema";

export const LIST_PAGE_SIZE = 25;

export type CandidateFilters = {
  q: string;
  stage: CandidateStage | "";
  field: string;
  /** Hanya untuk TSK: keputusan TSK itu sendiri. NONE = belum ada baris keputusan atau NONE. */
  decision: SelectionDecision | "";
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

/** Baca filter dari URL. Nilai yang tidak dikenal diabaikan (bukan error), supaya URL lama tidak rusak. */
export function parseFilters(sp: Params, isTsk: boolean): CandidateFilters {
  const stage = one(sp.stage);
  const decision = one(sp.decision);
  const page = Number.parseInt(one(sp.page), 10);
  return {
    q: one(sp.q).slice(0, 100),
    stage: (candidateStage.enumValues as readonly string[]).includes(stage) ? (stage as CandidateStage) : "",
    field: one(sp.field).slice(0, 120),
    decision: isTsk && (selectionDecision.enumValues as readonly string[]).includes(decision) ? (decision as SelectionDecision) : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Escape karakter khusus LIKE supaya "50%" dicari apa adanya. */
function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, "\\$&")}%`;
}

// LPK tidak punya "TSK sendiri": join keputusan memakai UUID nol, sehingga selalu kosong.
const NO_TSK = "00000000-0000-0000-0000-000000000000";

/**
 * Daftar kandidat yang terlihat oleh pemanggil (RLS yang menentukan: LPK = miliknya, TSK = mitra
 * dengan persetujuan data). `tskOrgId` diisi untuk TSK supaya keputusan miliknya ikut ditampilkan.
 */
export async function listCandidates(tx: Tx, filters: CandidateFilters, tskOrgId: string | null) {
  const conds = [];
  if (filters.q) {
    const pattern = likePattern(filters.q);
    conds.push(or(ilike(candidates.fullName, pattern), ilike(candidates.nameKatakana, pattern)));
  }
  if (filters.stage) conds.push(eq(candidates.stage, filters.stage));
  if (filters.field) conds.push(eq(candidates.field, filters.field));
  if (tskOrgId && filters.decision) {
    conds.push(
      filters.decision === "NONE"
        ? or(isNull(candidateSelections.decision), eq(candidateSelections.decision, "NONE"))
        : eq(candidateSelections.decision, filters.decision),
    );
  }
  const where = conds.length ? and(...conds) : undefined;
  const ownDecision = and(eq(candidateSelections.candidateId, candidates.id), eq(candidateSelections.tskOrgId, tskOrgId ?? NO_TSK));

  const [{ total }] = await tx
    .select({ total: count() })
    .from(candidates)
    .leftJoin(candidateSelections, ownDecision)
    .where(where);

  const rows = await tx
    .select({
      id: candidates.id,
      fullName: candidates.fullName,
      nameKatakana: candidates.nameKatakana,
      field: candidates.field,
      stage: candidates.stage,
      lpkName: organizations.name,
      decision: candidateSelections.decision,
      sharedWithTsk: candidates.sharedWithTsk,
    })
    .from(candidates)
    .innerJoin(organizations, eq(organizations.id, candidates.organizationId))
    .leftJoin(candidateSelections, ownDecision)
    .where(where)
    .orderBy(desc(candidates.createdAt), asc(candidates.fullName), asc(candidates.id))
    .limit(LIST_PAGE_SIZE)
    .offset((filters.page - 1) * LIST_PAGE_SIZE);

  return { rows, total };
}

export type CandidateListRow = Awaited<ReturnType<typeof listCandidates>>["rows"][number];

/** Bidang yang sudah dipakai kandidat yang terlihat (untuk filter dan saran isian). */
export async function listFields(tx: Tx): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ field: candidates.field })
    .from(candidates)
    .where(isNotNull(candidates.field))
    .orderBy(asc(candidates.field));
  return rows.map((r) => r.field!).filter(Boolean);
}
