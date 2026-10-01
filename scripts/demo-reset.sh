#!/usr/bin/env bash
# Mengisi ulang data DEMO saja (database hashi_demo + volume docs-data milik hashi-demo). Produksi tidak tersentuh.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/demo-lib.sh"
check_env
dc ps --status running --services | grep -qx app || { echo "✗ Stack demo belum jalan. Pakai scripts/demo-up.sh." >&2; exit 1; }
reseed
print_accounts
