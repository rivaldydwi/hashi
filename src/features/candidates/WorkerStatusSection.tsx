import { getFormatter, getTranslations } from "next-intl/server";
import { StatusBadge } from "@/components/StatusBadge";
import { cardClass } from "@/components/styles";
import { visaCodeOf } from "@/db/zairyu";
import type { LpkWorkerStatus } from "./lpk-status";

/**
 * "Setelah berangkat" (T-024), HANYA LPK_ADMIN pemilik kandidat: tanggal tiba + status visa + berlaku sampai, dari fungsi sempit `lpk_worker_status`.
 * Tidak memuat klien, lokasi, job order, kartu (nomor/tahap/catatan), atau data TSK lain. Komponen dirender hanya bila fungsi mengembalikan nilai (selain itu null: tidak ada).
 */
export async function WorkerStatusSection({ status }: { status: LpkWorkerStatus }) {
  const t = await getTranslations("workerStatus");
  const format = await getFormatter();
  const day = (ymd: string) => format.dateTime(new Date(`${ymd}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  return (
    <section className={`${cardClass} space-y-3 p-5`} data-testid="section-worker-status" data-visa={status.visaState}>
      <div>
        <h2 className="font-medium">{t("title")}</h2>
        <p className="text-sm text-stone-600">{t("intro")}</p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-stone-500">{t("arrivedOn")}</dt>
          <dd className="font-medium text-stone-900" data-testid="worker-arrived">{status.arrivedOn ? day(status.arrivedOn) : <span className="font-normal text-stone-500">{t("arrivedNone")}</span>}</dd>
        </div>
        <div>
          <dt className="text-stone-500">{t("visa")}</dt>
          <dd className="mt-0.5" data-testid="worker-visa"><StatusBadge kind="visa" code={visaCodeOf(status.visaState)} /></dd>
        </div>
        <div>
          <dt className="text-stone-500">{t("validUntil")}</dt>
          <dd className="font-medium text-stone-900" data-testid="worker-valid-until">{status.validUntil ? day(status.validUntil) : <span className="font-normal text-stone-500">—</span>}</dd>
        </div>
      </dl>
    </section>
  );
}
