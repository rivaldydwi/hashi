#!/usr/bin/env bash
# Menghidupkan instance DEMO (project Compose hashi-demo) untuk staf TSK / pihak luar. Tidak menyentuh produksi `hashi`.
# Aman dijalankan ulang: .env.demo tidak ditimpa kalau sudah ada; data demo diisi ulang (--reset).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/demo-lib.sh"

if [ ! -f "$ENV_FILE" ]; then
  echo "▶ Membuat $ENV_FILE dari .env.example dengan secret acak..."
  cp "$ROOT/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  set_env() { sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"; }
  set_env DB_OWNER_PASSWORD "$(openssl rand -hex 24)"
  set_env DB_APP_PASSWORD "$(openssl rand -hex 24)"
  set_env AUTH_SECRET "$(openssl rand -hex 32)"
  set_env APP_BIND 127.0.0.1          # hanya lewat proxy HTTPS / tunnel di mesin ini
  set_env APP_PORT 3111
  set_env SHOW_DEMO_ACCOUNTS false
  set_env SEED_PASSWORD "$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  printf '\n# --- Khusus instance demo ---\nDB_NAME=hashi_demo\n' >> "$ENV_FILE"
fi
check_env

echo "▶ Menjalankan stack $PROJECT (build + migration otomatis)..."
dc up -d --build
echo "▶ Menunggu aplikasi sehat..."
wait_healthy
reseed
print_accounts
