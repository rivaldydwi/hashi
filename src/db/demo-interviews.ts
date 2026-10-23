// Rencana data demo wawancara berkala (定期面談) untuk seed (T-037). MURNI (tanpa DB) supaya dites unit untuk SETIAP hari beberapa tahun fiskal:
// dulu seed dihitung dari bulan-bulan tahun fiskal berjalan + tanggal mulai pekerja yang kebetulan, sehingga `verify:seed` dan e2e merah mendadak
// saat kuartal berganti (PR #35). Sekarang semua tanggal diturunkan dari KUARTAL BERJALAN (K) dan kuartal-kuartal sebelumnya (K-1, K-2, K-3),
// melewati batas tahun fiskal bila perlu:
//   w0: mulai di K-3, wawancara tiap bulan sampai bulan ini; bulan pertama K-1 = 対象外 (tidak berlaku)
//   w1: mulai di K-2, TANPA wawancara di K-1 -> K-1 "missed" (terlewat)
//   w2: mulai di K-1, belum diwawancara di K -> K "open" (berjalan)
//   pekerja berhenti: dua kuartal berurutan yang SUDAH LEWAT dalam SATU tahun fiskal; wawancara hanya di kuartal pertama -> kuartal kedua "missed"
// Di Q1 (April-Juni) kuartal yang sudah lewat semuanya milik tahun fiskal LALU, jadi missed + 対象外 ada di `showcaseFy` (FY berjalan, atau FY lalu bila K = Q1).
import { addDays } from "./demo-rng";
import { fiscalQuarterRange, fiscalYearOf, quarterOfMonth } from "./records-core";

export type DemoInterviewStatus = "no_issue" | "follow_up" | "issue" | "not_done";
export type DemoInterviewRow = {
  worker: 0 | 1 | 2;
  /** Indeks baris dalam pekerja itu (dipakai pola penulis, alasan, isi). */
  index: number;
  month: string; // YYYY-MM-01
  applicable: boolean;
  status: DemoInterviewStatus | null; // null = 対象外
  date: string | null; // null = 対象外 atau 未実施
  reason: "agency" | "support" | "worker" | null;
  method: "in_person" | "online" | null;
  /** 0 = staf 1, 1 = staf 2, 2 = admin */
  staff: 0 | 1 | 2;
  /** Form 5-5 terisi (sebagian 問題なし sengaja kosong: data lama). */
  form: boolean;
};
export type DemoInterviewPlan = {
  /** Tanggal mulai penempatan ACTIVE w0, w1, w2 (seed menyetelnya). */
  starts: [string, string, string];
  rows: DemoInterviewRow[];
  /** Catatan kuartal (備考) per pekerja: Q1 semua pekerja, Q2 untuk w0 dan w1 bila kuartalnya sudah dimulai; tahun fiskal berjalan. */
  quarterNotes: Array<{ worker: 0 | 1 | 2; fiscalYear: number; quarter: 1 | 2 }>;
  ended: { start: string; end: string; interviewDate: string };
  /** Tahun fiskal yang dijamin memuat kuartal missed dan bulan 対象外. */
  showcaseFy: number;
};

type Q = { fy: number; q: 1 | 2 | 3 | 4 };
const prev = ({ fy, q }: Q): Q => (q === 1 ? { fy: fy - 1, q: 4 } : { fy, q: (q - 1) as 1 | 2 | 3 });
const range = (x: Q) => fiscalQuarterRange(x.fy, x.q);
const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
const nextMonth = (m: string) => {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
};
/** Bulan (YYYY-MM-01) dari bulan `from` sampai bulan `to`, inklusif. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(from); m <= monthOf(to); m = nextMonth(m)) out.push(m);
  return out;
}
const clamp = (d: string, lo: string, hi: string) => (d < lo ? lo : d > hi ? hi : d);

/** Pola status lintas pekerja: keempat status ada di 5 baris PERTAMA yang tidak 対象外, 問題なし dominan. */
export const DEMO_STATUS_PATTERN: readonly DemoInterviewStatus[] = ["no_issue", "follow_up", "no_issue", "issue", "not_done", "no_issue", "no_issue", "no_issue", "no_issue"];
const REASONS = ["agency", "support", "worker"] as const;

export function planDemoInterviews(today: string): DemoInterviewPlan {
  const cur: Q = { fy: fiscalYearOf(today), q: quarterOfMonth(monthOf(today)) };
  const p1 = prev(cur);
  const p2 = prev(p1);
  const p3 = prev(p2);
  const starts: [string, string, string] = [addDays(range(p3).start, 5), addDays(range(p2).start, 12), addDays(range(p1).start, 3)];
  const p1Months = monthsBetween(range(p1).start, range(p1).end);
  const naMonth = p1Months[0];

  const monthsFor = (w: 0 | 1 | 2): string[] => {
    if (w === 0) return monthsBetween(starts[0], today);
    if (w === 1) return monthsBetween(starts[1], today).filter((m) => !p1Months.includes(m));
    return monthsBetween(starts[2], range(p1).end);
  };

  const rows: DemoInterviewRow[] = [];
  let slot = 0;
  for (const w of [0, 1, 2] as const) {
    for (const [i, month] of monthsFor(w).entries()) {
      const na = w === 0 && month === naMonth;
      const status = na ? null : DEMO_STATUS_PATTERN[slot++ % DEMO_STATUS_PATTERN.length];
      const conducted = !na && status !== "not_done";
      const day = 10 + ((i * 5 + w * 3) % 15);
      const date = conducted ? clamp(`${month.slice(0, 8)}${String(day).padStart(2, "0")}`, starts[w], today) : null;
      rows.push({
        worker: w, index: i, month, applicable: !na, status, date,
        reason: conducted ? REASONS[(i + w) % 3] : null,
        method: conducted ? ((i + w) % 2 === 0 ? "in_person" : "online") : null,
        staff: ((i + w) % 3) as 0 | 1 | 2,
        form: conducted && !(status === "no_issue" && (i + w) % 4 === 3),
      });
    }
  }

  const quarterNotes: DemoInterviewPlan["quarterNotes"] = [];
  for (const w of [0, 1, 2] as const) for (const q of [1, 2] as const) if ((q === 1 || w < 2) && q <= cur.q) quarterNotes.push({ worker: w, fiscalYear: cur.fy, quarter: q });

  // Pekerja berhenti: (K-2, K-1) bila satu tahun fiskal, selain itu (K-3, K-2) (terjadi saat K-1 = Q1 atau K = Q1... keduanya sudah lewat penuh).
  const [a, b] = p2.fy === p1.fy ? [p2, p1] : [p3, p2];
  const endedStart = addDays(range(a).start, 9);
  const ended = { start: endedStart, end: addDays(range(b).end, -14), interviewDate: addDays(endedStart, 10) };

  return { starts, rows, quarterNotes, ended, showcaseFy: cur.q === 1 ? cur.fy - 1 : cur.fy };
}
