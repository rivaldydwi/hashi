import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cardClass } from "@/components/styles";
import { candidateAudit } from "@/db/audit-history";
import { safeTimezone } from "@/lib/org-time";
import { tenantQuery, type CurrentUser } from "@/lib/session";
import { AuditList } from "./AuditList";

/** Riwayat aktivitas satu kandidat (LPK_ADMIN pemilik dan TSK_ADMIN; RLS juga membatasi: TSK hanya melihat aksinya sendiri). */
export async function CandidateActivity({ candidateId, me }: { candidateId: string; me: CurrentUser }) {
  const t = await getTranslations("activity");
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const rows = await tenantQuery((tx) => candidateAudit(tx, candidateId, 30));
  return (
    <section id="riwayat" className={`${cardClass} scroll-mt-4 p-4 sm:p-5`} data-testid="section-activity">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold">{t("candidateTitle")}</h2>
        {rows.length > 0 && <Link href={`/activity?candidate=${candidateId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent-text hover:underline">{t("viewAll")}</Link>}
      </div>
      <div className="mt-2">
        <AuditList rows={rows} timezone={tz} emptyText={t("candidateEmpty")} testId="candidate-audit" />
      </div>
    </section>
  );
}
