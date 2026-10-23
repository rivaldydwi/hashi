#!/usr/bin/env bash
# Uji seed demo di beberapa tanggal (T-037): untuk setiap tanggal jalankan `db:seed -- --reset` + `verify:seed` dengan SEED_TODAY, ringkas lulus/gagal,
# lalu SELALU akhiri dengan reseed tanggal asli. HANYA database dev/test (db-guard menolak yang lain): seed --reset menghapus semua data.
#
#   scripts/verify-seed-dates.sh                      # tanggal bawaan: awal/akhir tiap kuartal 12 bulan terakhir + hari ini
#   scripts/verify-seed-dates.sh 2026-10-01 2026-10-23
#
# Tanggal masa depan tidak bisa (database menolaknya); untuk itu ada tes unit `demo-interviews` dan `demo-dates`.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a
[ -f .env ] && . ./.env
set +a

npx tsx -e 'import("./scripts/db-guard.ts").then((m) => m.assertTestDatabase("scripts/verify-seed-dates.sh"))' || exit 1

if [ "$#" -gt 0 ]; then
  dates=("$@")
else
  mapfile -t dates < <(npx tsx -e 'import("./src/db/seed-date.ts").then(async (m) => { const t = await import("./src/db/time.ts"); for (const d of m.defaultSeedCheckDates(t.todayInTskTz())) console.log(d); })')
fi

log_dir="$(mktemp -d)"
failed=0
printf '%-12s %-6s %-8s %s\n' "tanggal" "seed" "verify" "pemeriksaan gagal"
for d in "${dates[@]}"; do
  SEED_TODAY="$d" npm run -s db:seed -- --reset >"$log_dir/seed-$d.log" 2>&1
  seed=$?
  if [ "$seed" -eq 0 ]; then
    SEED_TODAY="$d" npm run -s verify:seed >"$log_dir/verify-$d.log" 2>&1
    verify=$?
    fails=$(grep -c '✗' "$log_dir/verify-$d.log" || true)
  else
    verify="-"
    fails="seed gagal: $(grep -m1 -E 'Error|✗' "$log_dir/seed-$d.log" | cut -c1-90)"
  fi
  printf '%-12s %-6s %-8s %s\n' "$d" "$seed" "$verify" "$fails"
  if [ "$seed" -ne 0 ] || [ "$verify" != "0" ]; then
    failed=1
    grep '✗' "$log_dir/verify-$d.log" 2>/dev/null | cut -c1-140 | sed 's/^/             /'
  fi
done

# kembalikan db dev ke tanggal asli (tes lain bergantung isi seed hari ini)
if npm run -s db:seed -- --reset >"$log_dir/seed-asli.log" 2>&1; then
  echo "db dev di-reseed ke tanggal asli."
else
  echo "PERINGATAN: reseed tanggal asli gagal, lihat $log_dir/seed-asli.log"
  failed=1
fi
echo "log: $log_dir"
exit "$failed"
