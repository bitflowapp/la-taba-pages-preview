#!/usr/bin/env bash
# Corre UN fragmento de la suite e2e y deja su log y una línea de resumen.
# Uso: e2e-shard.sh <proyecto> <k> <n>
# Un fragmento por invocación: el navegador y los servidores se reciclan entre lotes,
# así la memoria no se acumula como en una corrida única de ~600 pruebas.
set -u
cd "$(dirname "$0")/../../.."
P="$1"; K="$2"; N="$3"
OUT="artifacts/catalog-transformation-20261024/e2e"
mkdir -p "$OUT"
LOG="$OUT/$P-$K-de-$N.log"
# El temporal se fija por entorno; si no, uno del sistema. Nunca una ruta de una máquina concreta.
export TMP="${TABA_CT_TMP:-$(mktemp -d)}" TEMP="$TMP" TMPDIR="$TMP"
# Puertos propios para no chocar con otra sesión que corre e2e en los de fábrica.
export TABA_E2E_HTTP_PORT="${TABA_E2E_HTTP_PORT:-8265}" TABA_E2E_RELAY_PORT="${TABA_E2E_RELAY_PORT:-18765}"
LIBRE=$(powershell -NoProfile -c "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)" | tr -d '\r')
timeout "${TABA_SHARD_TIMEOUT:-1500}" npx playwright test --project="$P" --shard="$K/$N" > "$LOG" 2>&1
CODE=$?
RES=$(grep -E "^\s+[0-9]+ (passed|failed|flaky|skipped|did not run)" "$LOG" | tr -s ' ' | tr '\n' ' ')
echo "$P $K/$N exit=$CODE ramMB=$LIBRE :: $RES" | tee -a "$OUT/resumen.txt"
grep "✘" "$LOG" | head -20
# Un restaurado de capturas versionadas que la e2e sobrescribe no debe colarse en un commit.
git checkout -- artifacts/taba2-gondola-neuquen 2>/dev/null || true
exit $CODE
