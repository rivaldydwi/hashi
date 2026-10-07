// Kueri massal kartu izin tinggal 在留カード untuk DAFTAR dan KPI (T-019). SATU sumber: halaman `/records/cards`, KPI dashboard, dan `verify:seed` memakai fungsi INI
// (angka KPI = jumlah baris daftar). Semua di dalam withTenant (RLS: hanya staf TSK organisasi sesi). Kueri berurutan (bukan Promise.all) pada satu transaksi.
import { eq } from "drizzle-orm";
import type { Tx } from "./index";
import { residenceCards } from "./schema";
import { listResponsibleStaff, workersWithResponsible } from "./responsibility-queries";
import { cardStage, compareCardItems, countViews, currentCard, matchesView, type CardCounts, type CardStage, type CardView, type RenewalStatus } from "./zairyu";

export type CardListRow = {
  workerId: string;
  workerName: string;
  nameKatakana: string | null;
  companyId: string;
  companyName: string;
  siteName: string;
  responsibleId: string | null;
  responsibleName: string | null;
  hasCard: boolean;
  cardId: string | null;
  stage: CardStage | null;
  daysLeft: number | null;
  additionalDocs: boolean;
  specialUntil: string | null;
  expiryDate: string | null;
  renewalStatus: RenewalStatus | null;
  periodMonths: number | null;
  appliedOn: string | null;
};

/** SEMUA pekerja AKTIF (penempatan ACTIVE) dengan kartu terkini + tahap pada `today` + penanggung jawab efektif, urut paling mendesak dulu. */
export async function loadCardRows(tx: Tx, today: string): Promise<CardListRow[]> {
  const { workers } = await workersWithResponsible(tx, today);
  const staff = await listResponsibleStaff(tx);
  const cards = await tx.select().from(residenceCards).where(eq(residenceCards.status, "active"));
  const byCandidate = new Map<string, typeof cards>();
  for (const c of cards) byCandidate.set(c.candidateId, [...(byCandidate.get(c.candidateId) ?? []), c]);
  const name = new Map(staff.map((s) => [s.id, s.name]));
  const rows: CardListRow[] = workers
    .filter((w) => w.status === "ACTIVE")
    .map((w) => {
      const card = currentCard(byCandidate.get(w.id) ?? []);
      const st = card ? cardStage({ expiryDate: card.expiryDate, renewalStatus: card.renewalStatus as RenewalStatus, receivedOn: card.receivedOn, today }) : null;
      return {
        workerId: w.id, workerName: w.fullName, nameKatakana: w.nameKatakana, companyId: w.companyId, companyName: w.companyName, siteName: w.siteName,
        responsibleId: w.responsible.staffId, responsibleName: w.responsible.staffId ? (name.get(w.responsible.staffId) ?? null) : null,
        hasCard: card !== null, cardId: card?.id ?? null, stage: st?.stage ?? null, daysLeft: st?.daysLeft ?? null, additionalDocs: st?.additionalDocs ?? false, specialUntil: st?.specialUntil ?? null,
        expiryDate: card?.expiryDate ?? null, renewalStatus: (card?.renewalStatus as RenewalStatus | undefined) ?? null, periodMonths: card?.periodMonths ?? null, appliedOn: card?.appliedOn ?? null,
      };
    });
  return rows.sort((a, b) => compareCardItems({ stage: a.stage, daysLeft: a.daysLeft, name: a.workerName }, { stage: b.stage, daysLeft: b.daysLeft, name: b.workerName }));
}

export type CardFilter = { view?: CardView; mineUserId?: string | null; companyId?: string | null; stage?: CardStage | null };

/** Saring baris (murni): kelompok tampilan, "milikku" (penanggung jawab efektif = pengguna), perusahaan, tahap tertentu. */
export function filterCardRows(rows: readonly CardListRow[], f: CardFilter): CardListRow[] {
  return rows.filter((r) => matchesView(r, f.view ?? "all") && (!f.mineUserId || r.responsibleId === f.mineUserId) && (!f.companyId || r.companyId === f.companyId) && (!f.stage || r.stage === f.stage));
}

/**
 * Angka KPI kartu: TSK_STAFF menghitung pekerja yang ia 担当 ("milikku"), TSK_ADMIN menghitung SEMUA (salinan cadangan). Daftar `/records/cards?view=…[&mine=1]` memakai
 * `filterCardRows` pada baris yang sama, jadi angka dan daftar tidak pernah berbeda.
 */
export function cardKpiCounts(rows: readonly CardListRow[], scope: { role: string; userId: string }): { counts: CardCounts; mine: boolean } {
  const mine = scope.role !== "TSK_ADMIN";
  return { counts: countViews(mine ? rows.filter((r) => r.responsibleId === scope.userId) : rows), mine };
}
