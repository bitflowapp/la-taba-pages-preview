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

## Nota de la integración 90+91 — qué miden exactamente los `BENCH-*.json`

Los dos `BENCH-*.json` de esta carpeta se midieron con un molde de pedidos
sintéticos cuyo UUID tenía **35 caracteres** en vez de 36: el último grupo salía
de once dígitos. El adaptador descarta un `backendId` que no es un UUID, así que
esos 300 pedidos entraron a la bandeja **sin la identidad** con la que el
coordinador compara revisiones.

Qué significa para estos números, con precisión:

* `msHastaLaBandeja`, `nodosDelWorkspace`, `bytesDeMarcado` y `tarjetasEnElDom`
  **siguen valiendo**: son el costo de dibujar 300 tarjetas, y dibujarlas no
  depende de la identidad.
* `repintadosSinNovedades: 0` y `msPorRepintado` valen **para el escenario que
  midieron**, que es una bandeja quieta. No se pueden leer como «un cambio de
  pedido cuesta esto»: con la identidad rota, un cambio no llegaba a la bandeja.

**Estos archivos no se tocaron.** Son lo que se midió, y reescribirlos sería
inventar una medición que nadie hizo. El molde se arregló —vive una sola vez, en
`scripts/lib/business-panel-fixtures.mjs`, con una prueba que lo mira
(`tests/business-panel-bench-fixture.test.mjs`)— y las mediciones de la
integración, con el molde sano y el mismo arnés para 50, 100, 300 y 500 pedidos,
están en `artifacts/taba2-panel-integracion-90-91/`.

El informe que interpreta estos números está en `PANEL-BANDEJA-OPERATIVA.md`, en
la raíz del repositorio.
