#!/usr/bin/env bash
# Corre UN fragmento de la suite e2e y deja su log y una línea de resumen.
# Uso: e2e-shard.sh <proyecto> <k> <n>
# Un fragmento por invocación: navegador y servidores se reciclan entre lotes,
# así la memoria no se acumula como en la corrida única de 597 pruebas.
set -u
cd "$(dirname "$0")/../../.."
P="$1"; K="$2"; N="$3"
OUT="artifacts/ux-premium-20261024/e2e"
LOG="$OUT/$P-$K-de-$N.log"
export TMP='D:\work\tmp-taba-ux' TEMP='D:\work\tmp-taba-ux' TMPDIR='D:\work\tmp-taba-ux'
LIBRE=$(powershell -NoProfile -c "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)" | tr -d '\r')
npx playwright test --project="$P" --shard="$K/$N" > "$LOG" 2>&1
CODE=$?
RES=$(grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped|did not run)" "$LOG" | tr -s ' ' | tr '\n' ' ')
echo "$P $K/$N exit=$CODE ramMB=$LIBRE :: $RES" | tee -a "$OUT/resumen.txt"
grep "✘" "$LOG" | head -20
