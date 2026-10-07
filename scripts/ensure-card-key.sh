#!/usr/bin/env bash
# Pastikan CARD_DATA_KEY (kunci enkripsi nomor/foto 在留カード, T-020) ada di berkas env. Bila belum ada, buat kunci acak 32 byte dan TAMBAHKAN ke berkas itu
# (mode 600). NILAI KUNCI TIDAK PERNAH DICETAK: skrip hanya melaporkan "sudah ada" atau "ditambahkan". Tidak pernah menimpa kunci yang sudah ada.
#
#   scripts/ensure-card-key.sh [BERKAS_ENV]        bawaan: .env di folder repo
#
# Setelah kunci BARU dibuat di produksi: salin nilainya ke tempat aman DI LUAR server (pengelola kata sandi) SEBELUM data nyata dimasukkan. Tanpa kunci ini data kartu tidak bisa
# dipulihkan, juga dari cadangan (docs/backup.md). Baca nilainya sendiri dari berkas env; jangan tempel ke chat/log/git.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${1:-$ROOT/.env}"
[[ -f "$FILE" ]] || { echo "✗ berkas env tidak ada: $FILE" >&2; exit 1; }
command -v openssl >/dev/null || { echo "✗ perintah 'openssl' tidak ditemukan" >&2; exit 1; }
if grep -Eq '^CARD_DATA_KEY=.+' "$FILE"; then
  echo "✓ CARD_DATA_KEY sudah ada di $FILE (tidak diubah)."
  exit 0
fi
chmod 600 "$FILE"
sed -i '/^CARD_DATA_KEY=$/d' "$FILE"   # buang baris kosong sisa, bila ada
[[ -z "$(tail -c1 "$FILE")" ]] || printf '\n' >> "$FILE"
printf 'CARD_DATA_KEY=%s\n' "$(openssl rand -base64 32)" >> "$FILE"
echo "✓ CARD_DATA_KEY dibuat dan ditambahkan ke $FILE (nilai tidak dicetak)."
echo "  SALIN kunci itu ke tempat aman di luar server sebelum memasukkan data nyata (docs/backup.md)."
