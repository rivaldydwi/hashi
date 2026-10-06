#!/usr/bin/env bash
# Deploy PRODUKSI Hashi (project compose `hashi`) dengan commit terbaca di /api/health (T-006).
#
#   scripts/deploy.sh [--backup] [--timeout DETIK] [--check]
#
#   --backup        jalankan scripts/backup.sh dulu (kunci dari HASHI_BACKUP_PASSPHRASE atau ~/.config/hashi/backup.env); gagal -> deploy dibatalkan
#   --timeout N     batas tunggu health sampai commit cocok (bawaan 120 detik)
#   --check         hanya memeriksa syarat (branch, kebersihan, pull, sha) dan menampilkan rencana; TIDAK menyentuh container
#
# APP_PORT wajib ada (env atau .env); tidak ada nilai bawaan 3100 karena port itu dipakai aplikasi lain di OptiPlex.
# Syarat (menolak dengan pesan jelas dan kode keluar != 0 bila tidak terpenuhi, SEBELUM menyentuh container): branch `main`, working tree bersih,
# `git pull --ff-only` berhasil. Lalu `GIT_SHA=<sha pendek> docker compose -p hashi up -d --build` (TANPA --remove-orphans), menunggu
# http://127.0.0.1:$APP_PORT/api/health sampai `commit` = sha itu, dan mencetak commit yang berjalan. Hanya produksi: demo (hashi-demo) dan db-dev tidak disentuh.
set -Eeuo pipefail
fail() { echo "✗ deploy: $*" >&2; exit 1; }

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
git pull --ff-only || fail "git pull --ff-only gagal (lihat pesan git di atas: tidak ada upstream, atau riwayat lokal menyimpang dari origin/main). Tidak ada container yang disentuh."
SHA="$(git rev-parse --short HEAD)"
[[ "$SHA" =~ ^[0-9a-f]{7,12}$ ]] || fail "sha tidak valid: '$SHA'"

PORT="${APP_PORT:-}"
if [[ -z "$PORT" && -f .env ]]; then PORT="$(grep -E '^APP_PORT=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]"'"'"'' || true)"; fi
# Tanpa APP_PORT JANGAN menebak 3100: di OptiPlex port itu dipakai aplikasi lain, jadi health check akan menilai aplikasi yang salah.
[[ -n "$PORT" ]] || fail "APP_PORT tidak ditemukan (env atau .env). Isi APP_PORT=3110 di .env atau jalankan: APP_PORT=3110 scripts/deploy.sh. Tidak ada yang diubah."
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "APP_PORT tidak valid: '$PORT'"
HEALTH="http://127.0.0.1:$PORT/api/health"
health_commit() { curl -fsS --max-time 4 "$HEALTH" 2>/dev/null | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p'; }

echo "→ commit yang akan di-deploy: $SHA (main)"
echo "→ commit yang berjalan sekarang: $(health_commit || true) (health: $HEALTH)"
if (( CHECK )); then
  echo "✓ --check: syarat terpenuhi. Akan dijalankan: $( ((BACKUP)) && echo "scripts/backup.sh lalu " )GIT_SHA=$SHA docker compose -p hashi up -d --build, lalu menunggu health sampai commit=$SHA (maks ${TIMEOUT}s). Tidak ada container yang disentuh."
  exit 0
fi

if (( BACKUP )); then
  echo "→ cadangan dulu (scripts/backup.sh)"
  if [[ -z "${HASHI_BACKUP_PASSPHRASE:-}" && -f "$HOME/.config/hashi/backup.env" ]]; then set -a; . "$HOME/.config/hashi/backup.env"; set +a; fi
  "$ROOT/scripts/backup.sh" || fail "cadangan gagal; deploy dibatalkan (container tidak disentuh)"
fi

echo "→ docker compose -p hashi up -d --build (GIT_SHA=$SHA)"
GIT_SHA="$SHA" docker compose -p hashi up -d --build

echo "→ menunggu /api/health memuat commit $SHA (maks ${TIMEOUT}s)"
DEADLINE=$(( SECONDS + TIMEOUT )); GOT=""
while (( SECONDS < DEADLINE )); do
  GOT="$(health_commit || true)"
  [[ "$GOT" == "$SHA" ]] && break
  sleep 3
done
if [[ "$GOT" != "$SHA" ]]; then
  docker compose -p hashi ps 2>&1 | sed 's/^/  /' >&2 || true
  fail "health tidak menunjukkan commit $SHA dalam ${TIMEOUT}s (terakhir: '${GOT:-tidak ada respons}'). Periksa: docker compose -p hashi logs --tail=50 app"
fi
LABEL="$(docker image inspect hashi-app --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || true)"
echo "✓ deploy selesai. Commit berjalan: $GOT (label image: ${LABEL:-?}); health: $(curl -fsS --max-time 4 "$HEALTH")"
