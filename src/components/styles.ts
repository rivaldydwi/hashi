// Kelas Tailwind yang dipakai berulang, supaya tampilan konsisten.

export const inputClass =
  "block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-stone-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-stone-100 disabled:text-stone-500";

export const labelClass = "block text-sm font-medium text-stone-700";

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";

export const btnPrimary = `${btnBase} bg-brand-600 text-white hover:bg-brand-700`;
export const btnSecondary = `${btnBase} border border-stone-300 bg-white text-stone-700 hover:bg-stone-100`;
export const btnDanger = `${btnBase} border border-rose-300 bg-white text-rose-700 hover:bg-rose-50`;

export const cardClass = "rounded-2xl border border-stone-200 bg-white";

export const tableHeadClass = "border-y border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500";
