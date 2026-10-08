import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Data } from "@/components/Data";
import { btnSecondary, cardClass } from "@/components/styles";
import { buildRenewal, missingItems, type FixTarget } from "@/db/renewal";
import { RENEWAL_LABELS_JA } from "@/features/cards/renewal-labels";
import { loadRenewal } from "@/features/cards/renewal-queries";
import { CopyButton } from "@/features/cards/ui/CopyButton";
import { NumberReveal } from "@/features/cards/ui/NumberReveal";
import { ReasonField } from "@/features/cards/ui/ReasonField";
import { cardLog } from "@/features/cards/guards";
import { requireStaff } from "@/features/records/access";
import { Badge } from "@/features/records/ui/common";
import { safeTimezone, ymdIn } from "@/lib/org-time";
import { tenantQuery } from "@/lib/session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Data perpanjangan 在留カード untuk pengajuan ONLINE (T-021): butir 1-14 form 在留期間更新許可申請書 (申請人等作成用1) yang tinggal disalin ke 在留申請オンラインシステム.
 * Hanya 担当 efektif + TSK_ADMIN (selain itu 404, juga LPK/sensei/super admin). Membuka halaman dicatat di audit (`residence_card.renewal_view`, tanpa nilai). Nomor kartu TIDAK ada di halaman:
 * butir 12 lewat tombol "Tampilkan" yang diaudit (T-020). Alasan perpanjangan (14) bisa disunting di halaman dan tidak disimpan.
 */
export default async function RenewalPage({ params }: { params: Promise<{ candidateId: string }> }) {
  const me = await requireStaff();
  const { candidateId } = await params;
  if (!UUID.test(candidateId)) notFound();
  const t = await getTranslations("cards.renewalData");
  const locale = await getLocale();
  const tz = safeTimezone(me.organizationTimezone, me.organizationType);
  const today = ymdIn(new Date(), tz);
  const loaded = await tenantQuery(async (tx) => {
    const r = await loadRenewal(tx, me, candidateId, today);
    if (!r.canEdit || !r.data) return null;
    await cardLog(tx, me, "residence_card.renewal_view", r.data.cardId ?? candidateId, { status: "active" }); // dicatat setiap halaman dibuka; tanpa nilai
    return r.data;
  });
  if (!loaded) notFound();
  const { items, warnings } = buildRenewal(loaded.input);
  const missing = missingItems(items);
  const base = `/records/workers/${candidateId}`;
  const fixHref: Record<FixTarget, string> = { profile: `/candidates/${candidateId}`, passport: `/candidates/${candidateId}`, card: `${base}#card-title`, jp: `${base}#jp-profile` };

  return (
    <div className="space-y-5" data-testid="renewal-page">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={base} className={btnSecondary} data-testid="renewal-back">← {t("back")}</Link>
        <h2 className="text-[19px] font-semibold" data-testid="renewal-title">{t.rich("title", { name: loaded.workerName, n: (c) => <Data>{c}</Data> })}</h2>
      </div>
      <p className="text-sm text-ink-2">{t("intro")}</p>

      {warnings.length > 0 && (
        <ul className="space-y-2" data-testid="renewal-warnings">
          {warnings.map((w) => (
            <li key={w} className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert" data-warning={w}>{t(`warnings.${w}`)}</li>
          ))}
        </ul>
      )}
      <p className="text-sm" data-testid="renewal-missing-summary" data-missing={missing.length}>
        {missing.length === 0 ? t("allFilled") : t("missingCount", { n: missing.length })}
      </p>

      <ol className="space-y-3">
        {items.map((it) => (
          <li key={it.no} className={`${cardClass} space-y-2 p-4`} data-testid="renewal-item" data-no={it.no} data-key={it.key} data-missing={it.missing && !it.reminder ? "true" : "false"}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-[15px] font-semibold" lang="ja">{RENEWAL_LABELS_JA[it.key]}</p>
                {locale !== "ja" && <p className="text-xs text-ink-2">{t(`items.${it.key}`)}</p>}
              </div>
              {it.missing && !it.reminder && <Badge tone="warn" testId="renewal-missing">{t("missing")}</Badge>}
              {it.reminder && <Badge tone="neutral">{t("reminderBadge")}</Badge>}
            </div>

            {it.secret ? (
              it.missing ? <p className="text-sm text-ink-2">{t("cardNumberMissing")}</p> : loaded.cardId ? <NumberReveal cardId={loaded.cardId} masked="••••••••••••" /> : null
            ) : it.reminder ? (
              <p className="text-sm text-ink-menu">{t(`reminders.${it.key}`)}</p>
            ) : it.editable ? (
              <ReasonField initial={it.values[0]?.text ?? ""} />
            ) : it.values.length === 0 ? (
              <p className="text-sm text-ink-2">{t("emptyValue")}</p>
            ) : (
              <ul className="space-y-1.5">
                {it.values.map((v, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2" data-testid="renewal-value">
                    {v.label && <span className="min-w-16 text-xs font-medium text-ink-2" lang="ja">{v.label}</span>}
                    <span className="font-mono text-[15px]" translate="no" lang="ja" data-testid="renewal-value-text">{v.text}</span>
                    {v.sub && <span className="text-xs text-ink-2" translate="no" lang="ja">{v.sub}</span>}
                    <CopyButton value={v.text} label={RENEWAL_LABELS_JA[it.key]} />
                  </li>
                ))}
              </ul>
            )}

            {it.key === "name" && it.values.length > 0 && <p className="text-xs text-ink-2">{t("nameGuess")}</p>}
            {it.key === "homeAddress" && it.values.length > 0 && <p className="text-xs text-ink-2">{t("homeAddressHint")}</p>}
            {it.missing && !it.reminder && it.fix && <Link href={fixHref[it.fix]} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text underline" data-testid="renewal-fix">{t(`fix.${it.fix}`)}</Link>}
          </li>
        ))}
      </ol>
    </div>
  );
}
