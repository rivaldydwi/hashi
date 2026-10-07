import type { ElementType, HTMLAttributes } from "react";
import type React from "react";

/**
 * Pembungkus DATA pengguna (T-016): nama orang/katakana, nama perusahaan/lokasi/PIC, alamat, telepon, email, kode, dan isi catatan/teks bebas.
 * Terjemahan otomatis peramban (Chrome "Terjemahkan") boleh menerjemahkan LABEL (judul kolom, tombol, status, teks bantuan) tetapi TIDAK data:
 * menerjemahkan data menyesatkan (nama berubah ke huruf Latin yang salah, perusahaan jadi lain). `translate="no"` + kelas `notranslate` (Google Translate).
 * JANGAN memasang `translate="no"` pada <html> atau seluruh halaman. `lang` diisi "ja" untuk teks Jepang di halaman berbahasa Indonesia (katakana, istilah)
 * supaya peramban menebak bahasa sumber dengan benar. Untuk elemen yang sudah ada (td, a, h1), cukup pasang atribut `translate="no"` langsung.
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
