#!/usr/bin/env bash
# Mematikan instance DEMO. Data demo tetap tersimpan di volume (hidupkan lagi dengan demo-up.sh).
# Tambah --purge untuk MENGHAPUS volume demo (hashi-demo_*) sekalian; volume produksi tidak ikut.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/demo-lib.sh"
check_env
if [ "${1:-}" = "--purge" ]; then dc down -v; else dc down; fi
