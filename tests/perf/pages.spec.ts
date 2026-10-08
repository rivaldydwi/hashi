import { test, type Page } from "@playwright/test";
import { login, ownerQuery } from "../e2e/helpers";

// Waktu server halaman utama pada volume PILOT (T-014). Diukur dari `request.timing()`: TTFB (responseStart) dan selesai di-stream (responseEnd) dalam ms, bukan perasaan.
// Per halaman: 1 permintaan pemanasan (dicatat terpisah) lalu RUNS permintaan terukur; dilaporkan median dan terburuk. Batas kriteria: <= 1000 ms (selesai di-stream).
const RUNS = Number(process.env.PERF_RUNS ?? 7);
const LIMIT_MS = Number(process.env.PERF_LIMIT_MS ?? 1000);

type Row = { role: string; page: string; warm: number; median: number; worst: number; ttfb: number };
const rows: Row[] = [];

async function measure(page: Page, role: string, name: string, url: string) {
  const one = async () => {
    const res = await page.goto(url, { waitUntil: "load" });
    const t = res!.request().timing();
    return { end: t.responseEnd, start: t.responseStart, status: res!.status() };
  };
  const warm = await one();
  if (warm.status !== 200) throw new Error(`${name}: status ${warm.status}`);
  const runs: Array<{ end: number; start: number }> = [];
  for (let i = 0; i < RUNS; i++) runs.push(await one());
  const ends = runs.map((r) => r.end).sort((a, b) => a - b);
  rows.push({ role, page: name, warm: Math.round(warm.end), median: Math.round(ends[Math.floor(ends.length / 2)]), worst: Math.round(ends[ends.length - 1]), ttfb: Math.round(runs.map((r) => r.start).sort((a, b) => a - b)[Math.floor(runs.length / 2)]) });
}

test("waktu server halaman utama pada volume pilot", async ({ browser }) => {
  const [c] = await ownerQuery<{ id: string }>("select c.id::text from candidates c join organizations o on o.id = c.organization_id where o.name = 'LPK Demo Bandung' and c.stage = 'READY' order by c.id offset 20 limit 1");
  const [t] = await ownerQuery<{ id: string }>("select c.id::text from candidates c where c.shared_with_tsk and exists (select 1 from placements p where p.candidate_id = c.id and p.status = 'ACTIVE') order by c.id offset 10 limit 1");

  const lpk = await (await browser.newContext()).newPage();
  await login(lpk, "lpk1.admin@hashi.test");
  await measure(lpk, "LPK_ADMIN", "/ (dashboard)", "/");
  await measure(lpk, "LPK_ADMIN", "/candidates", "/candidates");
  await measure(lpk, "LPK_ADMIN", "/candidates?avg=4 (filter penilaian)", "/candidates?avg=4");
  await measure(lpk, "LPK_ADMIN", "/candidates?attendance=90&jlpt=N4", "/candidates?attendance=90&jlpt=N4");
  await measure(lpk, "LPK_ADMIN", "/candidates/<id> (detail)", `/candidates/${c.id}`);
  await measure(lpk, "LPK_ADMIN", "/assessments/pending", "/assessments/pending");
  await measure(lpk, "LPK_ADMIN", "/activity", "/activity");

  const tsk = await (await browser.newContext()).newPage();
  await login(tsk, "tsk.admin@hashi.test");
  await measure(tsk, "TSK_ADMIN", "/ (dashboard)", "/");
  await measure(tsk, "TSK_ADMIN", "/candidates", "/candidates");
  await measure(tsk, "TSK_ADMIN", "/candidates?avg=4 (filter penilaian)", "/candidates?avg=4");
  await measure(tsk, "TSK_ADMIN", "/candidates/<id> (detail)", `/candidates/${t.id}`);
  await measure(tsk, "TSK_ADMIN", "/records/interviews", "/records/interviews");
  await measure(tsk, "TSK_ADMIN", "/records/responsible", "/records/responsible");
  await measure(tsk, "TSK_ADMIN", "/records/cards", "/records/cards");
  await measure(tsk, "TSK_ADMIN", "/records (daftar catatan)", "/records");
  await measure(tsk, "TSK_ADMIN", "/records/workers/<id>", `/records/workers/${t.id}`);
  await measure(tsk, "TSK_ADMIN", "/activity", "/activity");

  console.log(`\nWaktu halaman (ms; ${RUNS} permintaan terukur + 1 pemanasan; selesai di-stream; batas ${LIMIT_MS} ms)`);
  console.log("| Peran | Halaman | Pemanasan | Median | Terburuk | TTFB (median) | Batas |");
  console.log("|---|---|---:|---:|---:|---:|---|");
  for (const r of rows) console.log(`| ${r.role} | ${r.page} | ${r.warm} | ${r.median} | ${r.worst} | ${r.ttfb} | ${r.worst <= LIMIT_MS ? "ok" : "LEBIH"} |`);
  const over = rows.filter((r) => r.worst > LIMIT_MS);
  if (over.length) throw new Error(`Melewati ${LIMIT_MS} ms: ${over.map((r) => `${r.role} ${r.page} (${r.worst} ms)`).join(", ")}`);
});
