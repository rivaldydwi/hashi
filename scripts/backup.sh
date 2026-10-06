#!/usr/bin/env bash
# Cadangan terenkripsi PRODUKSI Hashi ke disk lokal (T-002; desain dan alasan di docs/backup.md).
#
#   HASHI_BACKUP_PASSPHRASE='...' scripts/backup.sh
#
# Yang dicadangkan: database `hashi` (pg_dump -Fc) dan volume dokumen `hashi_docs-data`. TIDAK menyentuh demo atau db-dev.
# Hasil (di $HASHI_BACKUP_DIR, bawaan ~/hashi-backups), dua berkas terenkripsi + checksum + manifest TANPA data pribadi:
#   hashi-YYYYmmdd-HHMMSS-db.dump.gpg   hashi-YYYYmmdd-HHMMSS-docs.tar.gpg
#   hashi-YYYYmmdd-HHMMSS.sha256        hashi-YYYYmmdd-HHMMSS.manifest
# Data tidak pernah ditulis ke disk tanpa enkripsi (semua lewat pipa). Setelah menulis, cadangan DIBACA ULANG (didekripsi lewat pipa dan diperiksa
# isinya); bila gagal, semua berkas set ini dihapus dan skrip keluar dengan kode bukan 0.
#
# Variabel lingkungan (nilainya TIDAK boleh ditulis di repo):
#   HASHI_BACKUP_PASSPHRASE   wajib, minimal 16 karakter. Simpan di luar server (pengelola kata sandi): tanpa ini cadangan tidak bisa dibuka.
#   HASHI_BACKUP_DIR          opsional, bawaan $HOME/hashi-backups
#   HASHI_BACKUP_KEEP         opsional: simpan N set terbaru bernama hashi-<tanggal>-<jam>-*; set lain dalam folder (mis. pre-*-dump manual) TIDAK pernah disentuh.
#                             Kosong = tidak ada yang dihapus.
#   HASHI_DB_CONTAINER        bawaan hashi-db-1 (harus berbentuk hashi-db-<angka>: produksi saja)
#   HASHI_DOCS_VOLUME         bawaan hashi_docs-data
#   HASHI_BACKUP_HELPER_IMAGE bawaan alpine (HARUS sudah ada di host; tidak pernah diunduh: --pull=never)
set -Eeuo pipefail

fail() { echo "✗ backup: $*" >&2; exit 1; }

DB_CONTAINER="${HASHI_DB_CONTAINER:-hashi-db-1}"
DOCS_VOLUME="${HASHI_DOCS_VOLUME:-hashi_docs-data}"
HELPER_IMAGE="${HASHI_BACKUP_HELPER_IMAGE:-alpine}"
DIR="${HASHI_BACKUP_DIR:-$HOME/hashi-backups}"
KEEP="${HASHI_BACKUP_KEEP:-}"
DB_NAME="hashi"

[[ "$DB_CONTAINER" =~ ^hashi-db-[0-9]+$ ]] || fail "HASHI_DB_CONTAINER harus berbentuk hashi-db-<angka> (produksi), bukan '$DB_CONTAINER'"
[[ "$DOCS_VOLUME" == "hashi_docs-data" ]] || fail "HASHI_DOCS_VOLUME harus hashi_docs-data, bukan '$DOCS_VOLUME'"
[[ -n "${HASHI_BACKUP_PASSPHRASE:-}" ]] || fail "HASHI_BACKUP_PASSPHRASE belum di-set (kunci enkripsi; simpan juga di luar server)"
(( ${#HASHI_BACKUP_PASSPHRASE} >= 16 )) || fail "HASHI_BACKUP_PASSPHRASE minimal 16 karakter"
[[ -n "$DIR" && "$DIR" != "/" ]] || fail "HASHI_BACKUP_DIR tidak valid"
[[ -z "$KEEP" || "$KEEP" =~ ^[1-9][0-9]*$ ]] || fail "HASHI_BACKUP_KEEP harus bilangan bulat >= 1"
for t in docker gpg sha256sum tar; do command -v "$t" >/dev/null || fail "perintah '$t' tidak ditemukan"; done
[[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" == "true" ]] || fail "container $DB_CONTAINER tidak berjalan"
docker volume inspect "$DOCS_VOLUME" >/dev/null 2>&1 || fail "volume $DOCS_VOLUME tidak ada"
docker image inspect "$HELPER_IMAGE" >/dev/null 2>&1 || fail "image $HELPER_IMAGE belum ada di host (skrip tidak mengunduh image apa pun)"

umask 077
mkdir -p "$DIR" && chmod 700 "$DIR" || fail "tidak bisa membuat $DIR"
[[ -w "$DIR" ]] || fail "$DIR tidak bisa ditulis"

# gpg memakai folder sementara supaya tidak menyentuh ~/.gnupg; passphrase lewat fd, bukan argumen (tidak tampak di `ps`)
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME
TS="$(date +%Y%m%d-%H%M%S)"
BASE="$DIR/hashi-$TS"
PARTIAL=("$BASE-db.dump.gpg" "$BASE-docs.tar.gpg" "$BASE.sha256" "$BASE.manifest")
cleanup() {
  local rc=$? f
  rm -rf "${GNUPGHOME:?}"
  if (( rc != 0 )); then
    for f in "${PARTIAL[@]}"; do rm -f "${f:?}"; done
    echo "✗ backup gagal (kode $rc); berkas set $TS yang belum lengkap dihapus." >&2
  fi
}
trap cleanup EXIT

encrypt() { gpg --batch --yes --quiet --no-options --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 --compress-algo none --output "$1" 3<<<"$HASHI_BACKUP_PASSPHRASE"; }
decrypt() { gpg --batch --yes --quiet --no-options --pinentry-mode loopback --passphrase-fd 3 --decrypt "$1" 3<<<"$HASHI_BACKUP_PASSPHRASE"; }

echo "→ database $DB_NAME (pg_dump -Fc) dari $DB_CONTAINER"
docker exec "$DB_CONTAINER" pg_dump -U hashi_owner -Fc "$DB_NAME" | encrypt "$BASE-db.dump.gpg"
echo "→ volume dokumen $DOCS_VOLUME (container sementara $HELPER_IMAGE, baca-saja, tanpa jaringan)"
docker run --rm --pull=never --network none --read-only -v "$DOCS_VOLUME":/d:ro "$HELPER_IMAGE" tar -C /d -cf - . | encrypt "$BASE-docs.tar.gpg"

echo "→ memeriksa cadangan (dekripsi lewat pipa, baca isinya)"
DB_ENTRIES="$(decrypt "$BASE-db.dump.gpg" | docker exec -i "$DB_CONTAINER" pg_restore --list | grep -c '^[0-9]*;' || true)"
(( DB_ENTRIES > 100 )) || fail "isi dump database mencurigakan (hanya $DB_ENTRIES entri); cadangan dianggap gagal"
DOC_FILES="$(decrypt "$BASE-docs.tar.gpg" | tar -tf - | grep -vc '/$' || true)"

( cd "$DIR" && sha256sum "$(basename "$BASE")-db.dump.gpg" "$(basename "$BASE")-docs.tar.gpg" > "$(basename "$BASE").sha256" && sha256sum -c --quiet "$(basename "$BASE").sha256" ) || fail "checksum tidak cocok"

{
  echo "hashi-backup-manifest: 1"
  echo "dibuat: $(date -Iseconds)"
  echo "database: $DB_NAME (entri pg_restore --list: $DB_ENTRIES)"
  echo "berkas_dokumen: $DOC_FILES"
  echo "ukuran_db_terenkripsi_byte: $(stat -c %s "$BASE-db.dump.gpg")"
  echo "ukuran_dokumen_terenkripsi_byte: $(stat -c %s "$BASE-docs.tar.gpg")"
  echo "enkripsi: gpg simetris AES256 (kunci dari HASHI_BACKUP_PASSPHRASE; bukan bagian cadangan)"
  echo "commit_kode: $(git -C "$(dirname "$0")/.." rev-parse --short HEAD 2>/dev/null || echo tidak-diketahui)"
} > "$BASE.manifest"

if [[ -n "$KEEP" ]]; then
  # hanya set bernama hashi-<8 digit>-<6 digit>.sha256 buatan skrip ini; yang lain tidak disentuh
  mapfile -t SETS < <(cd "$DIR" && ls -1 | grep -E '^hashi-[0-9]{8}-[0-9]{6}\.sha256$' | sed 's/\.sha256$//' | sort)
  if (( ${#SETS[@]} > KEEP )); then
    for old in "${SETS[@]:0:${#SETS[@]}-KEEP}"; do
      [[ "$old" =~ ^hashi-[0-9]{8}-[0-9]{6}$ ]] || continue
      echo "→ retensi: menghapus set lama $old"
      rm -f "${DIR:?}/${old:?}-db.dump.gpg" "${DIR:?}/${old:?}-docs.tar.gpg" "${DIR:?}/${old:?}.sha256" "${DIR:?}/${old:?}.manifest"
    done
  fi
fi

echo "✓ cadangan selesai: $BASE-{db.dump.gpg,docs.tar.gpg,sha256,manifest}"
echo "  database $DB_ENTRIES entri, dokumen $DOC_FILES berkas, total $(du -ch "$BASE"-*.gpg | tail -1 | cut -f1)"
