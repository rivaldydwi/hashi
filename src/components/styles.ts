// Kelas Tailwind yang dipakai berulang, supaya tampilan konsisten. Warna memakai token tema (globals.css).

export const inputClass =
  "block min-h-11 w-full rounded-xl border border-line-btn bg-card px-3 py-2 text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-hover disabled:text-ink-2";

export const labelClass = "block text-[13px] font-medium text-ink-menu";

const btnBase =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-[14px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";

export const btnPrimary = `${btnBase} bg-accent text-white hover:bg-accent-dark`;
export const btnSecondary = `${btnBase} border border-line-btn bg-card text-ink-menu hover:bg-hover`;
export const btnDanger = `${btnBase} border border-rose-300 bg-card text-rose-800 hover:bg-rose-50`;

export const cardClass = "rounded-2xl border border-line bg-card";

export const tableHeadClass = "border-y border-line bg-page text-xs uppercase tracking-wide text-ink-2";

/**
 * Kelas tabel lebar yang dipakai bersama (T-011): header tidak patah di bahasa Jepang (aturan global `th` di globals.css), sel teks pendek memakai `cjk-phrase`
 * (pecah di batas frasa) dan SELALU diberi lebar minimum, nilai pendek (tanggal, telepon, hitungan) `whitespace-nowrap`.
 */
export const gridTh = "border border-line bg-page px-2 py-2 text-left text-xs font-semibold text-ink-2";
export const gridTd = "border border-line px-2 py-2 align-top text-sm";
/** Sel teks pendek (nama, perusahaan, alamat): pasang bersama `min-w-*`. */
export const gridTdText = `${gridTd} cjk-phrase`;
/** Sel nilai pendek yang tidak boleh patah (tanggal, telepon, jumlah). */
export const gridTdShort = `${gridTd} whitespace-nowrap`;
