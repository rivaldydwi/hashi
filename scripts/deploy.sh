#!/usr/bin/env bash
# Deploy PRODUKSI Hashi (project compose `hashi`) dengan commit terbaca di /api/health (T-006).
#
#   scripts/deploy.sh [--backup] [--timeout DETIK] [--check]
#
#   --backup        jalankan scripts/backup.sh dulu (kunci dari HASHI_BACKUP_PASSPHRASE atau ~/.config/hashi/backup.env); gagal -> deploy dibatalkan
#   --timeout N     batas tunggu health sampai commit cocok (bawaan 120 detik)
#   --check         hanya memeriksa syarat (branch, kebersihan, pull, sha) dan menampilkan rencana; TIDAK menyentuh container
#
# Log (T-015): keluaran lengkap tiap langkah (cadangan, build Docker, migrasi/start, health) ditulis ke berkas ${HASHI_DEPLOY_LOG_DIR:-${HASHI_BACKUP_DIR:-~/hashi-backups}}/deploy-<waktu>.log
# (mode 600; simpan HASHI_DEPLOY_LOG_KEEP=20 terakhir, hanya berkas deploy-*.log yang dihapus). Terminal hanya ringkasan per langkah. Langkah gagal = 40 baris terakhir log + path berkasnya,
# kode keluar != 0. Log tidak memuat isi .env (skrip tidak mencetaknya); jangan menempelkan log ke tempat publik tanpa memeriksanya.
#
# APP_PORT wajib ada (env atau .env); tidak ada nilai bawaan 3100 karena port itu dipakai aplikasi lain di OptiPlex.
# Syarat (menolak dengan pesan jelas dan kode keluar != 0 bila tidak terpenuhi, SEBELUM menyentuh container): branch `main`, working tree bersih,
# `git pull --ff-only` berhasil. Lalu `GIT_SHA=<sha pendek> docker compose -p hashi up -d --build` (TANPA --remove-orphans), menunggu
# http://127.0.0.1:$APP_PORT/api/health sampai `commit` = sha itu, dan mencetak commit yang berjalan. Hanya produksi: demo (hashi-demo) dan db-dev tidak disentuh.
set -Eeuo pipefail
fail() { echo "✗ deploy: $*" >&2; exit 1; }

ORIG_ARGS="$*"
BACKUP=0; CHECK=0; TIMEOUT=120
while (( $# )); do
  case "$1" in
    --backup) BACKUP=1; shift ;;
    --check) CHECK=1; shift ;;
    --timeout) TIMEOUT="${2:-}"; [[ "$TIMEOUT" =~ ^[1-9][0-9]*$ ]] || fail "--timeout butuh bilangan bulat > 0"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "argumen tidak dikenal: $1 (lihat --help)" ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
for t in git docker curl; do command -v "$t" >/dev/null || fail "perintah '$t' tidak ditemukan"; done
[[ -f compose.yaml ]] || fail "compose.yaml tidak ada di $ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" == "main" ]] || fail "harus di branch main (sekarang: $BRANCH). Tidak ada yang diubah."
[[ -z "$(git status --porcelain)" ]] || fail "working tree tidak bersih (ada perubahan atau berkas baru). Commit/simpan dulu. Tidak ada yang diubah:
$(git status --short | head -8)"

echo "→ git pull --ff-only"
PULL_OUT="$(git pull --ff-only 2>&1)" || fail "git pull --ff-only gagal (tidak ada upstream, atau riwayat lokal menyimpang dari origin/main). Tidak ada container yang disentuh.
$(printf '%s\n' "$PULL_OUT" | tail -n 8 | sed 's/^/  /')"
echo "  $(printf '%s\n' "$PULL_OUT" | grep -v '^[[:space:]]*$' | tail -n 1)"
SHA="$(git rev-parse --short HEAD)"
[[ "$SHA" =~ ^[0-9a-f]{7,12}$ ]] || fail "sha tidak valid: '$SHA'"

PORT="${APP_PORT:-}"
if [[ -z "$PORT" && -f .env ]]; then PORT="$(grep -E '^APP_PORT=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]"'"'"'' || true)"; fi
# Tanpa APP_PORT JANGAN menebak 3100: di OptiPlex port itu dipakai aplikasi lain, jadi health check akan menilai aplikasi yang salah.
[[ -n "$PORT" ]] || fail "APP_PORT tidak ditemukan (env atau .env). Isi APP_PORT=3110 di .env atau jalankan: APP_PORT=3110 scripts/deploy.sh. Tidak ada yang diubah."
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "APP_PORT tidak valid: '$PORT'"
# Kunci enkripsi nomor/foto kartu (T-020) WAJIB ada: compose menolak jalan tanpanya. Diperiksa di sini supaya gagal SEBELUM container disentuh (nilai tidak dicetak).
KEY_OK=0
[[ -n "${CARD_DATA_KEY:-}" ]] && KEY_OK=1
[[ "$KEY_OK" == 1 || ! -f .env ]] || { grep -Eq '^CARD_DATA_KEY=.+' .env && KEY_OK=1; }
[[ "$KEY_OK" == 1 ]] || fail "CARD_DATA_KEY belum ada di .env. Buat dengan scripts/ensure-card-key.sh (nilai tidak dicetak), lalu SALIN kuncinya ke tempat aman di luar server (BUTUH IPAL, lihat docs/backup.md). Tidak ada yang diubah."
HEALTH="http://127.0.0.1:$PORT/api/health"
health_commit() { curl -fsS --max-time 4 "$HEALTH" 2>/dev/null | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p'; }

echo "→ commit yang akan di-deploy: $SHA (main)"
echo "→ commit yang berjalan sekarang: $(health_commit || true) (health: $HEALTH)"
if (( CHECK )); then
  echo "✓ --check: syarat terpenuhi. Akan dijalankan: $( ((BACKUP)) && echo "scripts/backup.sh lalu " )GIT_SHA=$SHA docker compose -p hashi up -d --build, lalu menunggu health sampai commit=$SHA (maks ${TIMEOUT}s). Tidak ada container yang disentuh."
  exit 0
fi

# ---- Log deploy (T-015): keluaran panjang ke berkas, terminal hanya ringkasan
LOG_DIR="${HASHI_DEPLOY_LOG_DIR:-${HASHI_BACKUP_DIR:-$HOME/hashi-backups}}"
LOG_KEEP="${HASHI_DEPLOY_LOG_KEEP:-20}"
[[ "$LOG_KEEP" =~ ^[1-9][0-9]*$ ]] || fail "HASHI_DEPLOY_LOG_KEEP harus bilangan bulat > 0 (sekarang: '$LOG_KEEP')"
mkdir -p "$LOG_DIR" || fail "tidak bisa membuat folder log $LOG_DIR. Tidak ada yang diubah."
LOG="$LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
( umask 077; : > "$LOG" ) || fail "tidak bisa menulis log $LOG. Tidak ada yang diubah."
{
  echo "# deploy Hashi $(date -Is)"
  echo "# commit $SHA, argumen: ${ORIG_ARGS:-(tidak ada)}, timeout ${TIMEOUT}s, cadangan: $BACKUP"
  echo "# git pull --ff-only:"
  printf '%s\n' "$PULL_OUT"
} >> "$LOG"
# Hapus log lama: hanya berkas deploy-<tanggal>-<jam>.log di folder itu, simpan $LOG_KEEP terbaru
prune_logs() {
  local f n=0
  while IFS= read -r f; do
    n=$((n + 1))
    (( n > LOG_KEEP )) && rm -f -- "$f"
  done < <(ls -1t "$LOG_DIR"/deploy-[0-9]*-[0-9]*.log 2>/dev/null)
  return 0
}
prune_logs

# Gagal: 40 baris terakhir log + path berkas, lalu keluar dengan kode != 0
die_log() {
  local label="$1" rc="${2:-1}"
  (( rc == 0 )) && rc=1
  echo "✗ deploy: langkah '$label' GAGAL (kode $rc). 40 baris terakhir log:" >&2
  tail -n 40 "$LOG" | sed 's/^/  | /' >&2
  echo "  log lengkap: $LOG" >&2
  exit "$rc"
}

# step "<label>" <tampil-N-baris-terakhir> perintah... : keluaran penuh ke log, terminal hanya label + (opsional) N baris terakhir keluarannya
step() {
  local label="$1" show="$2" out rc=0
  shift 2
  echo "→ $label"
  { echo; echo "### $label ($(date -Is))"; } >> "$LOG"
  out="$(mktemp)"
  "$@" >"$out" 2>&1 || rc=$?
  cat "$out" >> "$LOG"
  if (( rc != 0 )); then
    echo "### GAGAL kode $rc" >> "$LOG"
    rm -f "$out"
    return "$rc"
  fi
  echo "### selesai" >> "$LOG"
  (( show > 0 )) && grep -v '^[[:space:]]*$' "$out" | tail -n "$show" | sed 's/^/  /'
  rm -f "$out"
  return 0
}

if (( BACKUP )); then
  # berkas rahasia milik pengguna, tidak diikuti shellcheck:
  # shellcheck source=/dev/null
  if [[ -z "${HASHI_BACKUP_PASSPHRASE:-}" && -f "$HOME/.config/hashi/backup.env" ]]; then set -a; . "$HOME/.config/hashi/backup.env"; set +a; fi
  BK_RC=0
  step "cadangan dulu (scripts/backup.sh)" 2 "$ROOT/scripts/backup.sh" || BK_RC=$?
  if (( BK_RC != 0 )); then
    echo "  (cadangan gagal; deploy dibatalkan, container tidak disentuh)" >&2
    die_log "cadangan" "$BK_RC"
  fi
fi

step "build image (docker compose -p hashi build, GIT_SHA=$SHA)" 0 env GIT_SHA="$SHA" docker compose -p hashi build || die_log "build image" $?
echo "  build selesai"

# up -d: menjalankan migrate (menerapkan migration baru, harus selesai sukses) lalu app/worker. Gagal migrasi = up -d gagal; log migrate ikut dilampirkan.
UP_RC=0
step "migrasi + mulai layanan (docker compose -p hashi up -d)" 0 env GIT_SHA="$SHA" docker compose -p hashi up -d || UP_RC=$?
if (( UP_RC != 0 )); then
  { echo; echo "### log service migrate (30 baris)"; docker compose -p hashi logs --no-log-prefix --tail=30 migrate 2>&1 || true; } >> "$LOG"
  die_log "migrasi + mulai layanan" "$UP_RC"
fi
{ echo; echo "### log service migrate (5 baris)"; docker compose -p hashi logs --no-log-prefix --tail=5 migrate 2>&1 || true; } >> "$LOG"
MIG_LAST="$(docker compose -p hashi logs --no-log-prefix --tail=3 migrate 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n 1 || true)"
echo "  migrasi selesai${MIG_LAST:+: $MIG_LAST}"

echo "→ menunggu /api/health memuat commit $SHA (maks ${TIMEOUT}s)"
{ echo; echo "### health ($(date -Is))"; } >> "$LOG"
DEADLINE=$(( SECONDS + TIMEOUT )); GOT=""
while (( SECONDS < DEADLINE )); do
  GOT="$(health_commit || true)"
  [[ "$GOT" == "$SHA" ]] && break
  sleep 3
done
if [[ "$GOT" != "$SHA" ]]; then
  { echo "terakhir: '${GOT:-tidak ada respons}' (diharapkan $SHA)"; docker compose -p hashi ps 2>&1 || true; docker compose -p hashi logs --tail=50 app 2>&1 || true; } >> "$LOG"
  echo "  health tidak menunjukkan commit $SHA dalam ${TIMEOUT}s (terakhir: '${GOT:-tidak ada respons}')" >&2
  die_log "health" 1
fi
echo "### health ok: $GOT" >> "$LOG"
LABEL="$(docker image inspect hashi-app --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
echo "✓ deploy selesai. Commit berjalan: $GOT (label image: ${LABEL:-?}); health: $(curl -fsS --max-time 4 "$HEALTH")"
echo "  log: $LOG"
