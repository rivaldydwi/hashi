#!/usr/bin/env bash
# Memulihkan cadangan scripts/backup.sh KE db-dev (uji restore; T-002). TIDAK untuk produksi: pemulihan produksi dilakukan manual
# dengan izin Ipal (langkahnya di docs/backup.md).
#
#   HASHI_BACKUP_PASSPHRASE='...' scripts/restore.sh <awalan> [--db NAMA_dev] [--docs-dir FOLDER] [--replace]
#
#   <awalan>      mis. ~/hashi-backups/hashi-20261006-120000 (tanpa akhiran -db.dump.gpg)
#   --db NAMA     database tujuan di container hashi-db-dev-1; WAJIB berakhiran _dev atau _test (bawaan hashi_restore_dev)
#   --docs-dir D  folder tujuan dokumen (harus belum ada/kosong; bawaan ~/hashi-restore-test/<awalan>/docs)
#   --replace     boleh menimpa database tujuan yang sudah ada (hanya yang berakhiran _dev/_test)
set -Eeuo pipefail
fail() { echo "✗ restore: $*" >&2; exit 1; }

PREFIX="${1:-}"; [[ -n "$PREFIX" && "$PREFIX" != --* ]] || fail "pemakaian: restore.sh <awalan> [--db NAMA_dev] [--docs-dir FOLDER] [--replace]"; shift
TARGET_DB="hashi_restore_dev"; DOCS_DIR=""; REPLACE=0
while (( $# )); do
  case "$1" in
    --db) TARGET_DB="${2:-}"; shift 2 ;;
    --docs-dir) DOCS_DIR="${2:-}"; shift 2 ;;
    --replace) REPLACE=1; shift ;;
    *) fail "argumen tidak dikenal: $1" ;;
  esac
done
DEV_CONTAINER="hashi-db-dev-1"
[[ "$TARGET_DB" =~ ^[a-z][a-z0-9_]*_(dev|test)$ ]] || fail "database tujuan harus berakhiran _dev atau _test (sekarang: '$TARGET_DB'); produksi/demo ditolak"
[[ "$TARGET_DB" != "hashi_dev" ]] || fail "hashi_dev dipakai untuk pengembangan; pilih nama lain (bawaan hashi_restore_dev)"
[[ -n "${HASHI_BACKUP_PASSPHRASE:-}" ]] || fail "HASHI_BACKUP_PASSPHRASE belum di-set"
for t in docker gpg sha256sum tar; do command -v "$t" >/dev/null || fail "perintah '$t' tidak ditemukan"; done
[[ "$(docker inspect -f '{{.State.Running}}' "$DEV_CONTAINER" 2>/dev/null || true)" == "true" ]] || fail "container $DEV_CONTAINER tidak berjalan (docker compose -f compose.yaml -f compose.dev.yaml up -d db-dev)"
PREFIX="${PREFIX/#\~/$HOME}"
for f in "$PREFIX-db.dump.gpg" "$PREFIX-docs.tar.gpg" "$PREFIX.sha256"; do [[ -f "$f" ]] || fail "berkas tidak ada: $f"; done
[[ -n "$DOCS_DIR" ]] || DOCS_DIR="$HOME/hashi-restore-test/$(basename "$PREFIX")/docs"
DOCS_DIR="${DOCS_DIR/#\~/$HOME}"
case "$(realpath -m "$DOCS_DIR")" in /var/lib/docker*|/|"$HOME") fail "folder dokumen tujuan tidak aman: $DOCS_DIR" ;; esac
if [[ -e "$DOCS_DIR" ]] && [[ -n "$(ls -A "$DOCS_DIR" 2>/dev/null)" ]]; then fail "folder dokumen tujuan tidak kosong: $DOCS_DIR"; fi

GNUPGHOME="$(mktemp -d)"; export GNUPGHOME
CREATED_DB=0; CREATED_DOCS=0
cleanup() {
  local rc=$?
  rm -rf "${GNUPGHOME:?}"
  if (( rc != 0 )); then
    # kegagalan di tengah jalan: buang apa yang dibuat skrip ini (hanya database dev dan folder yang dibuatnya sendiri)
    if (( CREATED_DB )); then docker exec -i "$DEV_CONTAINER" psql -U hashi_owner -d postgres -c "drop database if exists \"$TARGET_DB\" with (force)" >/dev/null 2>&1 || true; fi
    if (( CREATED_DOCS )); then rm -rf "${DOCS_DIR:?}"; fi
    echo "✗ restore gagal (kode $rc); hasil sebagian dibersihkan." >&2
  fi
}
trap cleanup EXIT
decrypt() { gpg --batch --yes --quiet --no-options --pinentry-mode loopback --passphrase-fd 3 --decrypt "$1" 3<<<"$HASHI_BACKUP_PASSPHRASE"; }
psql_dev() { docker exec -i "$DEV_CONTAINER" psql -U hashi_owner -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

echo "→ memeriksa checksum"
( cd "$(dirname "$PREFIX")" && sha256sum -c --quiet "$(basename "$PREFIX").sha256" ) || fail "checksum tidak cocok: cadangan rusak atau berubah"

# pemeriksaan awal: kunci benar dan isi berupa dump Postgres (bukan setelah database terlanjur dibuat)
HDR="$(decrypt "$PREFIX-db.dump.gpg" 2>/dev/null | head -c 5 || true)"
[[ "$HDR" == "PGDMP" ]] || fail "dump tidak bisa dibuka: passphrase salah atau berkas rusak"

exists="$(psql_dev -c "select 1 from pg_database where datname = '$TARGET_DB'")"
if [[ -n "$exists" ]]; then
  (( REPLACE )) || fail "database $TARGET_DB sudah ada di db-dev (pakai --replace untuk menimpanya)"
  echo "→ menghapus database dev lama $TARGET_DB (--replace)"
  psql_dev -c "drop database \"$TARGET_DB\" with (force)" >/dev/null
fi
echo "→ membuat database $TARGET_DB dan memulihkan dump"
psql_dev -c "create database \"$TARGET_DB\" owner hashi_owner" >/dev/null
CREATED_DB=1
decrypt "$PREFIX-db.dump.gpg" | docker exec -i "$DEV_CONTAINER" pg_restore -U hashi_owner -d "$TARGET_DB" --exit-on-error
echo "→ memulihkan dokumen ke $DOCS_DIR"
[[ -e "$DOCS_DIR" ]] || CREATED_DOCS=1
mkdir -p "$DOCS_DIR"
decrypt "$PREFIX-docs.tar.gpg" | tar -xf - -C "$DOCS_DIR" --no-same-owner
echo "✓ restore selesai: database $TARGET_DB (db-dev), dokumen $DOCS_DIR ($(find "$DOCS_DIR" -type f | wc -l) berkas)"
