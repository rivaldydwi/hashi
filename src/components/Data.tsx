import type { ElementType, HTMLAttributes } from "react";
import type React from "react";

/**
 * Pembungkus IDENTITAS (T-016, dikoreksi T-023): nama orang/katakana, nama organisasi/perusahaan/lokasi/PIC, alamat, telepon, email, kode, nomor dokumen, merek.
 * Terjemahan otomatis peramban (Chrome "Terjemahkan") boleh menerjemahkan LABEL dan TEKS BEBAS (catatan, motivasi, isi catatan kegiatan: JANGAN dibungkus
 * dan JANGAN diberi `lang`, biar peramban menebak bahasa sumbernya) tetapi TIDAK identitas: terjemahan mengubah nama ke huruf Latin yang salah atau mengganti nama perusahaan.
 * `translate="no"` + kelas `notranslate` (Google Translate). JANGAN memasang `translate="no"` pada <html> atau seluruh halaman. Untuk elemen yang sudah ada (td, a, h1),
 * cukup pasang atribut `translate="no"` langsung. Kolom profil kandidat: sifatnya ditentukan `data: "identity" | "prose"` di `candidate-sections.ts`.
 */
export function Data<T extends ElementType = "span">({ as, className, children, ...rest }: { as?: T; className?: string } & Omit<HTMLAttributes<HTMLElement>, "translate" | "className">) {
  const Tag = (as ?? "span") as ElementType;
  return (
    <Tag translate="no" className={className ? `notranslate ${className}` : "notranslate"} {...rest}>
      {children}
    </Tag>
  );
}

/** Pembungkus untuk `t.rich`: pesan "Oleh <n>{name}</n>" menandai HANYA nama sebagai data, kata "Oleh" tetap bisa diterjemahkan. Pakai: `t.rich(key, { name, n: dataTag })`. */
export const dataTag = (chunks: React.ReactNode) => <Data>{chunks}</Data>;
