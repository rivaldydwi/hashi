// Ikon kecil (garis 1,75 px) untuk sidebar. Dekoratif: selalu aria-hidden.
const PATHS: Record<string, string> = {
  records: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 8h6M9 12h6M9 16h3",
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  candidates: "M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  assessments: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  users: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  clients: "M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h6",
  jobOrders: "M3 7h18v13H3zM8 7V4h8v3M3 13h18",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  organizations: "M4 21V5l8-2v18M20 21V9l-8-2M8 9h1M8 13h1M8 17h1M16 13h1M16 17h1",
  skillFields: "M20 12l-8 8-9-9V3h8zM7.5 7.5h.01",
  partnerships: "M8 12l3 3 5-6M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0",
  residence: "M3 5h18v14H3zM7 10h6M7 14h3M16 10a2 2 0 1 0 0 .01",
  periodic: "M8 2v4M16 2v4M3 8h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  plus: "M12 5v14M5 12h14",
  chevron: "M6 9l6 6 6-6",
  // Ikon kartu KPI dashboard (T-012)
  check: "M5 13l4 4L19 7",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  tasks: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
};

/** Semua nama ikon yang tersedia (dites: ikon setiap KPI di katalog harus ada di sini). */
export const ICON_NAMES = Object.keys(PATHS);

export function Icon({ name, className = "h-[18px] w-[18px]" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={PATHS[name] ?? PATHS.dashboard} />
    </svg>
  );
}
