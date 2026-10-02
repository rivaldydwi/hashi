import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/PageHeader";
import { btnPrimary, btnSecondary, cardClass } from "@/components/styles";
import { CandidateFilters } from "@/features/candidates/CandidateFilters";
import { CandidateTable } from "@/features/candidates/CandidateTable";
import { LIST_PAGE_SIZE, listCandidatesFiltered, parseFilters } from "@/features/candidates/queries";
import { getSkillFieldOptions } from "@/features/skill-fields/server";
import { requireUser, tenantQuery } from "@/lib/session";

export const metadata: Metadata = { title: "Candidates" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CandidatesPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireUser();
  if (me.role === "SUPER_ADMIN") redirect("/"); // super admin tidak punya akses ke data kandidat

  const t = await getTranslations("candidates");
  const sp = await searchParams;
  const isTsk = me.organizationType === "TSK";
  const filters = parseFilters(sp, isTsk);

  const { list, stats } = await tenantQuery((tx) => listCandidatesFiltered(tx, filters, isTsk ? me.organizationId : null));
  const fields = (await getSkillFieldOptions()).filter((f) => f.active || f.code === filters.field);

  const pages = Math.max(1, Math.ceil(list.total / LIST_PAGE_SIZE));
  const active = filters.q || filters.stage || filters.field || filters.decision || filters.avg || filters.attendance || filters.jlpt || filters.view;
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: filters.q, stage: filters.stage, field: filters.field, decision: filters.decision, avg: filters.avg, attendance: filters.attendance, jlpt: filters.jlpt, view: filters.view })) {
      if (v) params.set(k, v);
    }
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/candidates?${qs}` : "/candidates";
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        intro={isTsk ? t("introTsk") : t("introLpk", { org: me.organizationName })}
      />

      {sp.deleted && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="candidate-deleted">
          {t("deleted")}
        </p>
      )}

      {sp.added && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" data-testid="candidate-added">
          {t("added")}
        </p>
      )}

      {filters.view && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm" data-testid="view-chip">
          <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent-soft px-4 font-medium text-accent-text">
            {t(`viewLabel.${filters.view}`)}
          </span>
          <Link href="/candidates" className="inline-flex min-h-11 items-center text-ink-2 underline hover:text-ink">{t("viewClear")}</Link>
        </p>
      )}

      <CandidateFilters filters={filters} fields={fields} isTsk={isTsk} />

      <p className="mb-2 text-sm text-stone-500" data-testid="candidate-total-label">
        <span className="font-medium tabular-nums text-stone-800" data-testid="candidate-total">{list.total}</span>{" "}
        {t("totalSuffix")}
      </p>

      {list.rows.length === 0 ? (
        <div className={`${cardClass} p-8 text-center text-sm text-stone-500`} data-testid="candidate-empty">
          {active ? t("noMatch") : t("empty")}
          {!active && me.role === "LPK_ADMIN" && (
            <div className="mt-3">
              <Link href="/candidates/new" className={btnPrimary}>+ {t("add")}</Link>
            </div>
          )}
        </div>
      ) : (
        <CandidateTable rows={list.rows} isTsk={isTsk} stats={stats} />
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          {filters.page > 1 ? (
            <Link href={pageHref(filters.page - 1)} className={btnSecondary}>← {t("prev")}</Link>
          ) : <span />}
          <span className="text-stone-500">{t("pageOf", { page: filters.page, pages })}</span>
          {filters.page < pages ? (
            <Link href={pageHref(filters.page + 1)} className={btnSecondary}>{t("next")} →</Link>
          ) : <span />}
        </nav>
      )}
    </>
  );
}
