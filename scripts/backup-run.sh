#!/usr/bin/env bash
# Pembungkus cadangan terjadwal (T-003): menjalankan scripts/backup.sh, mencatat log berputar, dan menandai kegagalan.
#   - Log:   $HASHI_BACKUP_DIR/backup.log (otomatis diputar ke backup.log.1 bila > 1 MB; hanya 1 berkas lama)
#   - Gagal: $HASHI_BACKUP_DIR/LAST_FAILED berisi waktu + pesan singkat; DIHAPUS saat putaran berhasil
# Kunci (HASHI_BACKUP_PASSPHRASE) datang dari lingkungan (systemd EnvironmentFile ~/.config/hashi/backup.env); tidak pernah dicetak.
# Kode keluar = kode keluar backup.sh (systemd menandai unit gagal bila bukan 0).
set -uo pipefail

DIR="${HASHI_BACKUP_DIR:-$HOME/hashi-backups}"
LOG="$DIR/backup.log"
FAILED="$DIR/LAST_FAILED"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAX_LOG_BYTES=1048576

umask 077
mkdir -p "$DIR" && chmod 700 "$DIR" || { echo "✗ backup-run: tidak bisa membuat $DIR" >&2; exit 1; }

if [[ -f "$LOG" ]] && (( $(stat -c %s "$LOG") > MAX_LOG_BYTES )); then mv -f "$LOG" "$LOG.1"; fi

START="$(date -Iseconds)"
{ echo "=== $START mulai cadangan terjadwal ==="; } >> "$LOG"

OUT="$(mktemp)"; trap 'rm -f "${OUT:?}"' EXIT
"$HERE/backup.sh" >"$OUT" 2>&1
RC=$?
cat "$OUT" >> "$LOG"

if (( RC == 0 )); then
  echo "=== $(date -Iseconds) selesai: BERHASIL ===" >> "$LOG"
  rm -f "${FAILED:?}"
else
  MSG="$(grep -E '^✗' "$OUT" | tail -2 | tr '\n' ' ')"
  [[ -n "$MSG" ]] || MSG="$(tail -2 "$OUT" | tr '\n' ' ')"
  printf 'waktu: %s\nkode_keluar: %s\npesan: %s\nlog: %s\n' "$(date -Iseconds)" "$RC" "${MSG:-tidak ada keluaran}" "$LOG" > "$FAILED"
  echo "=== $(date -Iseconds) selesai: GAGAL (kode $RC) ===" >> "$LOG"
fi
exit "$RC"
