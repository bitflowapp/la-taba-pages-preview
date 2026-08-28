# Evidencia — la bandeja operativa del Panel

Todo lo de esta carpeta se generó contra un servidor **simulado**: los guiones
interceptan las llamadas del cliente y contestan con datos inventados. No hay una
sola llamada a Supabase, Mercado Pago ni ARCA, y ninguna captura contiene datos
reales.

## Qué hay

| Archivo | Qué es |
| --- | --- |
| `REPORTE-antes.{md,json}` | 144 combinaciones (12 anchos × 12 pantallas) medidas **antes** |
| `REPORTE-despues.{md,json}` | las mismas 144 medidas **después** |
| `BENCH-antes.json` · `BENCH-despues.json` | el cronómetro con 300 pedidos a 390×844 |
| `capturas/*.png` | diez capturas |

## Por qué diez capturas y no 288

El guion fotografía las 144 combinaciones de cada corrida —288 archivos, 13 MB—
porque la medición las necesita. Lo que sirve para revisar un cambio es mucho
menos, así que al repositorio viajan sólo las que muestran algo:

* `orders` a **320×568, 390×844 y 430×932**, antes y después: los tres anchos
  que pidió la misión.
* `orders` a **1440×900**, antes y después: el escritorio, que también cambió.
* `operation-center` a **390×844**, antes y después: una pantalla que este
  trabajo **no** tocó, como control.

Los dos `REPORTE-*.json` conservan la medición completa de las 144
combinaciones, con el nombre del archivo que le correspondía a cada una. Para
volver a generarlas todas:

```bash
node scripts/business-panel-responsive.mjs --label despues \
  --out artifacts/taba2-panel-operativo-movil/capturas
```

El informe que interpreta estos números está en `PANEL-BANDEJA-OPERATIVA.md`, en
la raíz del repositorio.
