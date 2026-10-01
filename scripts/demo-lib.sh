#!/usr/bin/env bash
# Fungsi bersama demo-up.sh / demo-reset.sh / demo-down.sh. Di-source, bukan dijalankan langsung.
#
# Instance demo = project Compose SENDIRI (-p hashi-demo) + file env SENDIRI (.env.demo). Semua perintah docker compose
# untuk demo WAJIB lewat dc() di bawah supaya selalu membawa -p dan --env-file; tanpa itu yang tersentuh bisa produksi.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.demo"
PROJECT="hashi-demo"

dc() {
  docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f "$ROOT/compose.yaml" "$@"
}

# Baca satu nilai dari .env.demo
env_get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

# Pastikan .env.demo tidak mungkin mengenai produksi (database, port, bind)
check_env() {
  [ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE belum ada. Jalankan scripts/demo-up.sh dulu." >&2; exit 1; }
  local db port show pw
  db="$(env_get DB_NAME)"; port="$(env_get APP_PORT)"; show="$(env_get SHOW_DEMO_ACCOUNTS)"; pw="$(env_get SEED_PASSWORD)"
  [[ "$db" == *_demo ]] || { echo "✗ DB_NAME di .env.demo harus berakhiran _demo (sekarang: '$db')." >&2; exit 1; }
  [ "$port" != "3100" ] && [ "$port" != "3110" ] || { echo "✗ APP_PORT demo tidak boleh 3100/3110 (dipakai produksi / aplikasi lain)." >&2; exit 1; }
  [ "$show" = "false" ] || { echo "✗ SHOW_DEMO_ACCOUNTS di .env.demo harus false." >&2; exit 1; }
  [ -n "$pw" ] && [ "$pw" != "hashi-demo-2026" ] || { echo "✗ SEED_PASSWORD di .env.demo harus acak, bukan kosong / hashi-demo-2026." >&2; exit 1; }
}

# Cetak daftar akun demo (email dari scripts/seed.ts, supaya tidak melenceng) beserta kata sandinya
print_accounts() {
  local pw port
  pw="$(env_get SEED_PASSWORD)"; port="$(env_get APP_PORT)"
  echo
  echo "Akun demo (kata sandi sama untuk semuanya):"
  grep -oE '[a-z0-9.]+@hashi\.test' "$ROOT/scripts/seed.ts" | awk '!seen[$0]++' | while read -r email; do
    case "$email" in
      tsk.admin@*) role="Admin TSK (bahasa Jepang)  <- untuk staf TSK" ;;
      tsk.staff@*) role="Staf TSK                   <- untuk staf TSK" ;;
      lpk1.admin@*) role="Admin LPK Bandung" ;;
      lpk1.sensei@*) role="Sensei LPK Bandung" ;;
      lpk2.admin@*) role="Admin LPK Surabaya" ;;
      lpk3.admin@*) role="Admin LPK Medan (bukan mitra)" ;;
      admin@*) role="Super admin (jangan diberikan ke pihak luar)" ;;
      *) role="" ;;
    esac
    printf '  %-28s %s\n' "$email" "$role"
  done
  echo "  Kata sandi: $pw"
  echo
  echo "Aplikasi demo: http://127.0.0.1:${port} (arahkan proxy HTTPS / tunnel ke alamat ini)"
  echo "Data HANYA dummy. Isi ulang kapan saja: scripts/demo-reset.sh"
}

wait_healthy() {
  local port; port="$(env_get APP_PORT)"
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1 && return 0
    sleep 2
  done
  echo "✗ Aplikasi demo tidak sehat setelah 2 menit. Lihat: docker compose -p $PROJECT --env-file .env.demo logs app" >&2
  return 1
}

# Isi ulang data demo (HANYA database hashi_demo): hapus semua data + berkas dokumen demo, lalu seed
reseed() {
  echo "▶ Mengosongkan berkas dokumen demo (volume docs-data milik $PROJECT)..."
  dc exec -T app sh -c 'rm -rf /app/docs-data/* /app/docs-data/.[!.]* 2>/dev/null || true'
  echo "▶ Mengisi ulang data demo (seed --reset)..."
  dc run --rm migrate npm run db:seed -- --reset
}
