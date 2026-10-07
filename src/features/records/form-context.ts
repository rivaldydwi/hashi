import { inSeries } from "@/db/serial";
import { asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { clientCompanies, clientSites } from "@/db/schema";
import { allWorkers, listCases, listStaff } from "./queries";
import type { PickWorker } from "./ui/Pickers";

/** Data pilihan untuk form catatan: staf, pekerja aktif, lokasi klien, perusahaan, kasus terbuka. */
export async function loadFormContext(tx: Tx, extraWorkerIds: string[] = []) {
  const [staff, workersRaw, sitesRaw, companies, cases] = await inSeries(
    () => listStaff(tx),
    () => allWorkers(tx),
    () => tx.select({ id: clientSites.id, name: clientSites.name, company: clientCompanies.name }).from(clientSites).innerJoin(clientCompanies, eq(clientCompanies.id, clientSites.companyId)).where(eq(clientSites.active, true)).orderBy(asc(clientCompanies.name), asc(clientSites.name)),
    () => tx.select({ id: clientCompanies.id, name: clientCompanies.name }).from(clientCompanies).where(eq(clientCompanies.active, true)).orderBy(asc(clientCompanies.name)),
    () => listCases(tx, { status: "open", workerId: "" }),
  );
  const workers: PickWorker[] = workersRaw.map((w) => ({ id: w.id, name: w.fullName, katakana: w.nameKatakana, site: `${w.companyName} / ${w.siteName}`, endedOn: w.status === "ENDED" ? w.endDate : null }));
  void extraWorkerIds;
  return {
    staff,
    workers,
    workersFull: workersRaw,
    sites: sitesRaw.map((s) => ({ id: s.id, label: `${s.company} / ${s.name}` })),
    companies,
    cases: cases.map((c) => ({ id: c.id, label: `${c.code} ${c.title}` })),
  };
}

/** "YYYY-MM-DDTHH:mm" di zona waktu tertentu (untuk input datetime-local). */
export function localDateTime(d: Date | null, tz: string): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).replace(" ", "T");
}
