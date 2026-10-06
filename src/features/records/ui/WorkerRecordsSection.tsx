import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { btnPrimary, btnSecondary, cardClass } from "@/components/styles";
import { tenantQuery, type CurrentUser } from "@/lib/session";
import { recordsOfWorker } from "../queries";
import { Badge, dateLabelSync } from "./common";

/** Bagian "Catatan kegiatan" di detail pekerja AKTIF (hanya sisi TSK; tidak pernah dirender untuk LPK). */
export async function WorkerRecordsSection({ candidateId, me }: { candidateId: string; me: CurrentUser }) {
  void me;
  const t = await getTranslations("records");
  const locale = await getLocale();
  const { recs, cases } = await tenantQuery((tx) => recordsOfWorker(tx, candidateId, 15));
  return (
    <section className={`${cardClass} p-4 sm:p-5`} id="catatan-kegiatan" data-testid="section-worker-records" aria-labelledby="wr-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="wr-title" className="mr-auto text-[17px] font-semibold">{t("worker.title")}</h2>
        <Link href={`/records/new?kind=daily_work&worker=${candidateId}`} className={btnPrimary} data-testid="worker-add-record">+ {t("worker.add")}</Link>
        <Link href={`/records/workers/${candidateId}`} className={btnSecondary} data-testid="worker-history-open">{t("whistory.openHistory")}</Link>
        <Link href={`/records/interviews`} className={btnSecondary}>{t("tabs.interviews")}</Link>
      </div>
      <h3 className="mt-4 text-sm font-semibold">{t("worker.cases")}</h3>
      {cases.length === 0 ? <p className="mt-1 text-sm text-ink-2">{t("worker.noCases")}</p> : (
        <ul className="mt-1 divide-y divide-line" data-testid="worker-cases">
          {cases.map((c) => (
            <li key={c.id}><Link href={`/records/cases/${c.id}`} className="flex min-h-11 flex-wrap items-center gap-2 py-2 text-sm hover:bg-hover"><span className="font-mono text-xs text-ink-2">{c.code}</span><span lang="ja">{c.title}</span><Badge tone={c.status === "open" ? "warn" : "ok"}>{c.status === "open" ? "● " : "✓ "}{t(`cases.status.${c.status}`)}</Badge></Link></li>
          ))}
        </ul>
      )}
      <h3 className="mt-4 text-sm font-semibold">{t("worker.records")}</h3>
      {recs.length === 0 ? <p className="mt-1 text-sm text-ink-2" data-testid="worker-records-empty">{t("worker.noRecords")}</p> : (
        <ul className="mt-1 divide-y divide-line" data-testid="worker-records">
          {recs.map((r) => (
            <li key={r.id}><Link href={`/records/${r.id}`} className="flex min-h-11 flex-wrap items-center gap-2 py-2 text-sm hover:bg-hover">
              <Badge>{t(`kinds.${r.kind}`)}</Badge><span className={r.status === "void" ? "line-through" : ""}>{dateLabelSync(r.recordDate, locale)} · {r.kind === "meeting" ? r.subject : t(`workTypes.${r.workType ?? "other"}`)}</span><span className="text-xs text-ink-2">{r.authorName}</span>
            </Link></li>
          ))}
        </ul>
      )}
    </section>
  );
}
