#!/usr/bin/env bash
# Mendekripsi satu berkas cadangan (.gpg) ke stdout; dipakai runbook pemulihan (docs/backup.md §4b).
#   HASHI_BACKUP_PASSPHRASE='...' scripts/decrypt.sh hashi-20261006-020000-db.dump.gpg | docker exec -i hashi-db-1 pg_restore ...
# Hasil didekripsi hanya ke stdout (tidak pernah ke disk). Kunci lewat lingkungan, bukan argumen.
set -Eeuo pipefail
[[ $# -eq 1 && -f "$1" ]] || { echo "✗ decrypt: pemakaian: decrypt.sh <berkas.gpg>" >&2; exit 1; }
[[ -n "${HASHI_BACKUP_PASSPHRASE:-}" ]] || { echo "✗ decrypt: HASHI_BACKUP_PASSPHRASE belum di-set" >&2; exit 1; }
GNUPGHOME="$(mktemp -d)"; export GNUPGHOME; trap 'rm -rf "${GNUPGHOME:?}"' EXIT
gpg --batch --yes --quiet --no-options --pinentry-mode loopback --passphrase-fd 3 --decrypt "$1" 3<<<"$HASHI_BACKUP_PASSPHRASE"
