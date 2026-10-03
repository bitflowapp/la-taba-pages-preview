# Recertificación sintética: `1118e73` → `8028dcc`

## Identidad

| | Certificación anterior | Recertificación |
|---|---|---|
| HEAD certificado | `1118e73` | **`8028dcc`** |
| Worktree | `D:\1212\la-taba-business-synthetic-certification` | `D:\1212\la-taba-business-synthetic-recertification` |
| Rama | `test/taba2-business-synthetic-certification` | `test/taba2-business-synthetic-recertification-8028dcc` |
| Fuente | `feature/taba2-business-operations-final` @ `1118e73` | igual @ `8028dcc`, sin modificar |

`1118e73` es ancestro de `8028dcc`, y `8028dcc` está presente en la fuente. Verificado antes de
crear el worktree.

La matriz anterior no se reutilizó: los 82 invariantes se volvieron a ejecutar contra el nuevo
HEAD.

## Los dos defectos cosméticos: cerrados

| Defecto | Antes (`1118e73`) | Ahora (`8028dcc`) |
|---|---|---|
| Títulos partidos al medio | "Impresora s", "Factura ción" | Enteros en 320, 360, 390, 412 y 432 px |
| Botones de confirmación | "Salió el papel de impresora a4" | "Salió el papel de la térmica" / "Salió el papel de la A4" |

La verificación no es visual a ojo: el spec recorre el nodo de texto de cada título palabra por
palabra y falla si una sola palabra ocupa más de un rectángulo de línea. Para probar que el
guard sirve, se revirtió el arreglo de CSS en local y el spec **falló** a 320 px reportando tres
palabras partidas; con el arreglo puesto pasa en los cinco anchos.

## Escenarios sintéticos

Idénticos en cantidad y resultado. Ningún escenario cambió de comportamiento.

| # | Escenario | `1118e73` | `8028dcc` |
|---|---|---|---|
| 1 | Apertura | 8/8 | 8/8 |
| 2 | Pedido normal | 7/7 | 7/7 |
| 3 | Pagos | 11/11 | 11/11 |
| 4 | Scanner y alta | 15/15 | 15/15 |
| 5 | Packing e impresión | 11/11 | 11/11 |
| 6 | Fiscal | 9/9 | 9/9 |
| 7 | Rider | 6/6 | 6/6 |
| 8 | Cierre diario | 10/10 | 10/10 |
| P | Permisos | 5/5 | 5/5 |
| | **Total** | **82/82** | **82/82** |

## Diferencias en cantidad de pruebas

| Suite | `1118e73` | `8028dcc` | Diferencia |
|---|---|---|---|
| `npm test` | 910 | 914 | +4 |
| Regresión visual responsive | — | 5 | +5 (nueva) |
| Chromium completo (specs) | 152 | 157 | +5 |

El `+4` de `npm test` viene del arreglo: 3 pruebas nuevas en `business-panel-styles.test.mjs`
(que fijan el override de corte de palabra) y 1 en `business-device-check.test.mjs` (que exige
que los dispositivos con papel declaren su nombre corto en los datos). El `+5` de Chromium es
el spec responsive nuevo, uno por ancho.

## Gate de PostgreSQL: cambió de NOT_RUN a FALLA

Es la diferencia importante de esta ronda. Ver `hallazgo-postgresql.md`.

En `1118e73` el gate quedó `NOT_RUN` porque Docker estaba apagado y el disco no daba. Esta vez
Docker levantó, el stack local arrancó con el contenedor que el runner espera, y el gate corrió
por primera vez: **falla**, por una restricción que entró en `d1ddec6` y que ningún gate
anterior podía ver.

No lo introdujo `8028dcc`. Lo que hizo esta ronda fue poder mirarlo.
