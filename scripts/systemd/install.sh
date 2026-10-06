#!/usr/bin/env bash
# Memasang / mencopot jadwal cadangan Hashi sebagai systemd USER timer. Hanya menyentuh dua unit milik Hashi
# (hashi-backup.service dan hashi-backup.timer) dan berkas kuncinya; layanan/jadwal lain tidak disentuh.
#   scripts/systemd/install.sh install     # membuat kunci bila belum ada, memasang unit, mengaktifkan timer
#   scripts/systemd/install.sh status
#   scripts/systemd/install.sh uninstall   # menonaktifkan timer dan menghapus kedua unit (kunci dan cadangan TIDAK dihapus)
set -Eeuo pipefail
fail() { echo "✗ $*" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"
CONF_DIR="$HOME/.config/hashi"
ENV_FILE="$CONF_DIR/backup.env"

case "${1:-}" in
  install)
    command -v systemctl >/dev/null && command -v openssl >/dev/null || fail "butuh systemctl dan openssl"
    umask 077
    mkdir -p "$CONF_DIR" && chmod 700 "$CONF_DIR"
    if [[ ! -f "$ENV_FILE" ]]; then
      # kunci acak dibuat langsung ke berkas (tidak dicetak ke terminal)
      { printf 'HASHI_BACKUP_PASSPHRASE=%s\n' "$(openssl rand -hex 24)"; printf 'HASHI_BACKUP_KEEP=14\n'; } > "$ENV_FILE"
      echo "→ kunci baru dibuat di $ENV_FILE (mode 600). SALIN kunci itu ke tempat lain (pengelola kata sandi); tanpa kunci cadangan tidak bisa dibuka."
    else
      echo "→ $ENV_FILE sudah ada; tidak ditimpa"
    fi
    chmod 600 "$ENV_FILE"
    mkdir -p "$UNIT_DIR"
    for u in hashi-backup.service hashi-backup.timer; do sed "s|@REPO@|$REPO|g" "$HERE/$u" > "$UNIT_DIR/$u"; done
    systemctl --user daemon-reload
    systemctl --user enable --now hashi-backup.timer
    systemctl --user list-timers hashi-backup.timer --no-pager
    ;;
  status)
    systemctl --user list-timers hashi-backup.timer --no-pager || true
    systemctl --user status hashi-backup.service --no-pager || true
    ;;
  uninstall)
    systemctl --user disable --now hashi-backup.timer 2>/dev/null || true
    rm -f "$UNIT_DIR/hashi-backup.timer" "$UNIT_DIR/hashi-backup.service"
    systemctl --user daemon-reload
    echo "✓ jadwal dicopot. Kunci ($ENV_FILE) dan cadangan tidak dihapus."
    ;;
  *) fail "pemakaian: install.sh install|status|uninstall" ;;
esac
