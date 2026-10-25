#!/usr/bin/env bash
# Suite e2e completa en lotes, UNO por vez. Espera a que no haya otro `npm test`/Playwright propio.
# Uso: run-all-e2e.sh   (deja el resumen en artifacts/catalog-transformation-20261024/e2e/resumen.txt)
set -u
cd "$(dirname "$0")/../../.."
# Temporal fuera de las unidades casi llenas: se fija por entorno (TABA_CT_TMP); si no, uno del sistema.
export TABA_CT_TMP="${TABA_CT_TMP:-$(mktemp -d)}"
SH="artifacts/catalog-transformation-20261024/tools/e2e-shard.sh"
OUT="artifacts/catalog-transformation-20261024/e2e"
mkdir -p "$OUT"
echo "=== inicio $(date '+%F %T') sobre $(git rev-parse --short HEAD)" | tee -a "$OUT/resumen.txt"
lote() {
  local p="$1" n="$2" k
  for k in $(seq 1 "$n"); do
    bash "$SH" "$p" "$k" "$n" || {
      # Un lote rojo se repite UNA vez completo y se deja registrado: no se oculta ningún intento.
      echo "(repetición de $p $k/$n)" | tee -a "$OUT/resumen.txt"
      bash "$SH" "$p" "$k" "$n"
    }
  done
}
lote chromium 12
lote mobile-webkit 8
lote mobile-webkit-recovery 4
echo "=== fin $(date '+%F %T')" | tee -a "$OUT/resumen.txt"
