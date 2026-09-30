#!/bin/sh
# Membuat role aplikasi `hashi_app` (tanpa BYPASSRLS).
# Dijalankan otomatis oleh image postgres HANYA saat volume database masih kosong.
# Kalau nanti password diganti, jalankan manual:
#   docker compose exec db psql -U hashi_owner -d hashi -c "ALTER ROLE hashi_app PASSWORD '...'"
set -e

psql -v ON_ERROR_STOP=1 -v app_pw="$APP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
CREATE ROLE hashi_app LOGIN NOBYPASSRLS PASSWORD :'app_pw';
EOSQL
