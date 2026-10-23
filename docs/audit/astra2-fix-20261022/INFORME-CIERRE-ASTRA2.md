# La Taba — cierre de los tres hallazgos de la segunda auditoría de Astra

**Veredicto: NO-GO para habilitar cobros reales.** Los tres defectos están corregidos, con fallos reproducidos *antes* de corregir y pruebas que los siguen cubriendo. Eso **no** alcanza para cobrar: sigue faltando el pago auténtico de Mercado Pago (firma del webhook, vendedor de prueba, tarjetas), la custodia externa del respaldo y una auditoría independiente sobre este commit. «Las pruebas pasan» no es el criterio de salida.

- Repositorio: `bitflowapp/la-taba-pages-preview` · Rama: `fix/astra2-ledger-worker-preview-20261022` (parte de `c99b1068`, la punta de `fix/forensic-f01-f14-20261022`; no se reescribió historia ni se tocó la rama de Astra, Claude o Codex).
- QA: `ixewllzzuzpqrkxzmfzx` (único proyecto tocado). Producción: no se tocó ni se desplegó nada. Cuenta de Walter: no se vinculó. Ningún cobro, reembolso ni gasto real. Costo: USD 0.

## 0. Una aclaración que importa

`outputs/INFORME-ASTRA.md` y `outputs/EVIDENCIA-ASTRA.zip` **no estaban en esta PC** (se buscaron en el repositorio, en las carpetas de trabajo locales de La Taba, Descargas, Escritorio y Documentos; una búsqueda recursiva de toda la carpeta de trabajo no terminó a tiempo). No inventé su contenido: los tres hallazgos se tomaron del encargo («conciliación financiera incompleta», «worker que excede el tiempo», «preview desactualizado») y cada uno se **reprodujo desde el código** antes de tocarlo. Si el texto exacto de Astra nombra otro mecanismo, hay que cotejarlo con las secciones 1–3: lo cubierto está enumerado, y lo que no, figura en «Riesgos residuales».

## 1. Hallazgo 1 — la conciliación podía omitir cambios tardíos

### Causas (cada una con una prueba que falla en el código auditado)

| # | Causa | Cómo se vio | Prueba roja → verde |
|---|---|---|---|
| 1 | El libro mayor del proveedor se leía por **fecha de creación** en una ventana de ~2 h. Un reembolso, un contracargo o la aprobación de un pago offline (ticket) días después **nunca volvía a verse**. | Reembolso en el panel de Mercado Pago a los 3 días: `refunded = 0`. | A1, A2 |
| 2 | Paginaba por **posición** (`offset`): el proveedor lo limita (10 000) y un pago ya leído que cambia mientras se pagina **desplaza** a los demás (se salta uno). | Ventana de 300 filas con tope de 150: el pago de nuestro vendedor detrás de ellas jamás se alcanza. | A4, A5 |
| 3 | Un pago `pending` se releía **en cada pasada del planificador** (cada minuto) sin *backoff*, y uno ya cerrado no se releía nunca; un checkout con sólo pagos rechazados se releía **para siempre** (la evidencia de cierre sólo contaba respuestas vacías). | `enqueue_checkout_provider_probes()` devolvía 1 en cada llamada, siete veces seguidas. | A7, A8 |
| 4 | Un pedido aprobado y completado **no se volvía a verificar** (y el hallazgo «sin verificación en 24 h» era una bomba de tiempo). | Pedido aprobado hace 3 días: no se programaba ninguna verificación. | A9 |
| 5 | El buzón de huérfanos conservaba la severidad del **primer** avistamiento: pendiente (baja) → aprobado seguía **baja** y sin bloqueo. | `record_orphan_provider_payment` pendiente y luego aprobado: `low`. | A3, A2 |
| 6 | Las fechas de la ventana iban con microsegundos de PostgreSQL; la documentación pide ISO-8601 con milisegundos. | Simulador estricto: HTTP 400, ventana en falla permanente. | A6 |

### Qué cambia (migración `20261022130000`, aditiva, más el worker)

- **El libro mayor se lee por `date_last_updated`** (`range`, `sort`) con un **cursor por clave** (marca de tiempo; la posición sólo se usa dentro de **un** mismo instante) en lugar de una posición: nunca pide más allá de un `offset` chico, sobrevive a pagos que cambian durante la lectura y se puede reanudar en cualquier punto. Si el proveedor devuelve filas fuera de orden o una página vacía antes de su propio total, **falla ruidosamente** en vez de cerrar la ventana.
- **Cada pago del proveedor lleva su propio calendario** (`payment_provider_payments.next_check_at`, `watch_state`; lo deriva un *trigger* de `first_seen_at` / `last_seen_at`, así que cualquier observación —webhook, libro mayor, sonda— lo avanza): `pending` se relee con *backoff* (1 min → 6 h) **hasta un estado terminal observado**; `approved` se verifica en una **escalera** (15 min, 1 h, 6 h, 24 h, 3 d, 7 d, 14 d, 30 d) para encontrar un reembolso o contracargo hecho después aunque no llegue webhook; `rejected/cancelled/expired/refunded/charged_back` quedan *settled*. El planificador (`enqueue_checkout_provider_probes`, que ya corría cada minuto) encola la lectura **de ese pago**.
- Cierre con evidencia: un checkout sin pedido se cierra sólo tras vencer la preferencia, 24 h de gracia y **tres lecturas** posteriores (vacías **o** con sólo pagos ya definitivos y sin dinero). Un contador o una edad solos nunca cierran nada. La lectura sólo cuenta **después** de haber persistido los pagos.
- **Aprobación tardía / escalamiento:** una discrepancia vuelve a abrirse o **sube de severidad** si el mismo hecho reaparece con más gravedad (nunca baja, nunca levanta un bloqueo que una persona no resolvió); un huérfano aprobado después de pendiente pasa a `critical` y bloquea. La misma versión del proveedor vista otra vez (la ventana se solapa a propósito) **no** reabre lo que una persona ya resolvió ni infla contadores.
- **Un pago que falla siempre no congela la ventana:** tras 5 corridas consecutivas fallando por motivos **propios del pago** (no por caída, límite de tasa, token vencido ni falta de tiempo del proveedor) queda como hallazgo **crítico** `ledger_item_unprocessable` para una persona y se sigue con el resto. Nada se salta en silencio.
- **Conserva identidad, vendedor, moneda, importe y referencia:** cada pago en `payment_provider_payments`; cada huérfano con `seller_id`, `provider_payment_id`, `environment`, importe, moneda, referencia externa, fechas y último estado (prueba C9).
- `run_financial_integrity_checks` juzga «sin verificar» contra la **escalera propia** del pago (no contra un plazo plano de 24 h) y abre `pending_payment_unchecked` si un pago pendiente lleva una hora sin releerse. Sólo para vendedores **conectados**: sin conexión toda lectura fallaría y se reencolaría eternamente (defecto hallado en la revisión independiente, sección 5).
- Una ventana abierta con el lector anterior se cierra y se **relee una vez** los últimos 7 días por fecha de actualización (idempotente): así se ponen al día los cambios tardíos que el lector anterior no podía ver.

## 2. Hallazgo 2 — el worker podía exceder el tiempo disponible

### Límites reales (documentación de Supabase, leída el 22/10/2026)

Reloj de pared por invocación: **150 s en Free, 400 s en planes pagos**; espera máxima sin respuesta 150 s; **2 s de CPU por solicitud** (la espera de E/S no cuenta); 256 MB; 30 solicitudes anidadas por traza en 60 s. El worker ahora planifica con un **presupuesto** que termina 40 s antes del corte (110 s en Free; `PAYMENT_WORKER_WALL_CLOCK_MS` lo adapta al plan; mínimo 90 s).

### Causas (con prueba roja en el código auditado)

| # | Causa | Cómo se vio | Prueba |
|---|---|---|---|
| 1 | El cursor sólo avanzaba al **completar la página** de 50 pagos; con un proveedor lento la plataforma mataba al worker a mitad de página y la siguiente corrida **repetía lo mismo para siempre**. | 8 de 8 invocaciones muertas por la plataforma; cursor sin moverse. | B1 |
| 2 | Un trabajo que **mata a su worker cada vez** se reclamaba **primero** en cada corrida (el trabajo vencido seguía al frente) y, con un trabajo por invocación (despliegue de recuperación), **dejaba sin procesar a todos los demás**. | 6 de 6 invocaciones muertas; el trabajo sano de atrás nunca se procesó. | B2 |
| 3 | Se reclamaban hasta 20 trabajos de una vez con *lease* de 90 s: los últimos vencían **sin haber empezado** y quedaban `claimed` consumiendo intentos. | 4 trabajos reclamados que nunca corrieron. | B3 |
| 4 | El tiempo de una llamada al proveedor nunca se acotaba al tiempo **restante**. | (análisis; cubierto por B1/B6) | B6 |

### Qué cambia

- **Procesamiento por lotes con *checkpoints* persistentes y reanudable:** un trabajo por vez mientras haya tiempo; el cursor del libro mayor se persiste **cada 5 pagos y al final de cada página** (y libera el *lease* al quedarse sin tiempo, para reanudar enseguida). Se puede cortar en cualquier instante sin perder ni duplicar.
- **Presupuesto de tiempo** (`worker-deadline.ts`): nadie empieza algo que no puede terminar; toda llamada al proveedor se acota a lo que queda (si la corta el presupuesto, es «sin tiempo», no una falla). Un trabajo no usa más del 60 % del presupuesto para que el libro mayor y los demás trabajos tengan su turno.
- ***Leases*, *latidos*, *backoff*:** *lease* de 60 s con **latido** entre pasos (`extend_payment_outbox_lease`); un trabajo cuyo dueño murió **no vuelve al frente**: se pasa a `retry_wait` con *backoff* exponencial y se cuenta una interrupción (a los 8 intentos, `dead_letter` y alerta); uno que sólo fue reclamado y nunca corrió recupera su intento. Si el worker se queda sin tiempo **libera** el trabajo (`release_payment_outbox_job`): el intento se devuelve mientras es raro y se gasta cuando se repite (≥ 3 interrupciones).
- **No se duplican operaciones al recuperar un trabajo:** todo efecto financiero es idempotente en la base (verificado cortando el proceso en **cada** punto, B4/B5), un pago ya guardado en el mismo estado sólo se marca «visto» (`provider_payment_unchanged`) —salvo que su pedido siga pendiente: eso siempre se lee completo— y un dueño que perdió el *lease* no puede completar ni fallar el trabajo.

## 3. Hallazgo 3 — preview desactualizado

**Código exacto desplegado (antes):** `https://recovery-20261020.taba2-staging.pages.dev` servía el build **`1d40194f`, runtime `la-taba-runtime-v156-worker-cache-isolation`**: los 375 archivos servidos coinciden **byte a byte** (SHA-256) con ese build (`scripts/recovery/verify-preview-deployment.mjs`). La rama estaba en el runtime **v158** (`df8747ca`), así que al preview le faltaban `business-panel-render.js`, `business-payments-console.js` (la consola que muestra primero el dinero sin resolver) y el `sw.js` nuevo.

**Estado: todavía NO actualizado.** Lo hecho (todo de solo lectura o local):

- Reproducción: el preview vivo es exactamente `1d40194f` / v156 (arriba).
- Artefacto de la rama preparado y validado, **sin publicar**: carpeta local `la-taba-qa-candidate-0d18925c`, fuera del repositorio (376 archivos). Difiere del vivo en exactamente cuatro archivos: `js/business/business-panel-render.js`, `js/business/business-payments-console.js`, `sw.js` (v158) y `version.json`. `scan-production-artifacts` limpio; envío directo en *dry-run* contra `taba2-staging`, rama `recovery-20261020` (la rama de producción `staging` se rechaza por diseño).
- Este ciclo **no cambia el cliente** (los cambios son de base de datos y Edge Functions); por eso el nombre de caché PWA sigue siendo `la-taba-runtime-v158-financial-integrity` y `npm run check` (incluye precache e identidad de release) pasa.
- Herramientas nuevas: `scripts/recovery/verify-preview-deployment.mjs` (compara byte a byte lo servido contra el artefacto, `version.json`, `CACHE_NAME` de `sw.js` y cabeceras de revalidación; **ejecutado** contra el build vivo: 10/10 controles) y `scripts/recovery/verify-preview-panel.mjs` (login del propietario QA en un Chromium real y comparación de los estados de pago que muestra el panel contra lo que responde el servidor; **escrito pero NO ejecutado todavía**).

No se publicó porque la verificación final del código no terminó (sección 4): el sistema detuvo la suite por falta de memoria y no corresponde desplegar un preview con una verificación a medias. Pendiente, en este orden: suite completa → migración y funciones en QA (con el respaldo cifrado previo ya tomado: `pre-astra2-20261022`, guardado fuera del repositorio) → `prepare-preview` + `pages-direct-deploy --publish` (sólo la rama preview) → `verify-preview-deployment.mjs --wait-ms 180000` → `verify-preview-panel.mjs` → prueba de actualización del service worker con un cliente que ya tenga v156.

Hecho de seguridad que sigue abierto: el preview **no tiene puerta de acceso** (responde 200 sin credencial; sólo `noindex`). Muestra datos sintéticos de QA. No lo cambié porque no se pidió y dejaría fuera a quien lo revise sin la credencial; hay que decidirlo (`--access-gate` ya existe).

## 4. Los 14 hallazgos anteriores no reaparecieron

**Esto NO está cerrado.** La confirmación completa exige correr los 99 casos de la ronda anterior sobre el código final, y esa corrida **no terminó**: el sistema detuvo el proceso por poca memoria (4,2 GB libres de 16 GB, con Chrome y otras sesiones abiertas) y no se relanzó. Lo que sí hay, separado por lo que cubre:

| Verificación | Código | Resultado |
|---|---|---|
| Los 99 casos de la ronda anterior (F01–F14: dinero, stock, identidad, reembolsos, conciliación, 26 escenarios, concurrencia, worker, respaldo) + 14 nuevos | **intermedio** (antes de la revisión independiente) | **110 de 113**. Las 3 fallas eran pruebas que fijaban justo el comportamiento que este ciclo cambia a propósito (reclamar de inmediato un trabajo vencido; contador de avistamientos del huérfano; «sin verificar en 24 h»); se actualizaron con el contrato nuevo y **no se volvieron a correr** en la suite completa. |
| Reconciliación A1–A12 y contratos SQL C1–C15 | **final** | 27/27 (A10, C10, C11 tras corregir la prueba, no el código) |
| Tiempo del worker B1, B2, B3, B6 | **final** | 4/4 |
| Corte del proceso en **cada** punto, camino de trabajos (B4) y del libro mayor (B5) | **anterior a las correcciones de la revisión** | B4 verde; B5 verde salvo un punto que destapó que la plantilla estaba desactualizada (con la migración final ese punto recupera el pedido). **No se repitió la matriz completa sobre el código final.** |
| Pruebas puras del barrido y del presupuesto de tiempo | **final** | 16/16 |
| `npm run check` (sintaxis, config, precache, higiene, identidad, codificación, secretos) | **final** | verde |
| Suite JS completa (`npm test`) | — | **no terminó**: la detuve para no competir con las correcciones y no se relanzó. |

Nota honesta sobre el rojo: B4/B5 (cortes en cada punto) **también pasan en el código auditado**: antes del cambio el sistema ya era *seguro* ante un corte (todo es idempotente); lo que fallaba era la **continuidad** (B1–B3: livelock, trabajo envenenado que dejaba sin procesar a los demás, trabajos reclamados que nunca corrían). B4/B5 quedan como red de seguridad contra regresiones, no como evidencia del defecto.

## 5. Revisión independiente del código

Un revisor sin acceso a mis conclusiones leyó el commit completo (solo lectura). Encontró **siete defectos reales**, todos corregidos y cubiertos antes del cierre:

| Sev. | Defecto | Corrección | Prueba |
|---|---|---|---|
| Alta | Se encolaban lecturas para vendedores **desconectados**: fallaban, iban a `dead_letter` y se reencolaban cada hora, para siempre (alerta crítica permanente y hallazgos acumulados). | `provider_seller_connected` como condición del calendario, de las sondas y de los hallazgos; desconectar cierra lo que ya no se puede verificar. | C13 |
| Alta | Un pago que falla siempre congelaba la ventana del vendedor (ningún reembolso ni contracargo posterior se leía). | Contador por pago; al 5.º fallo propio queda como hallazgo crítico y se sigue. | A10, A11, C14 |
| Media | Una página **vacía** cerraba la ventana aunque el proveedor reportara más filas. | Se trata como inconsistencia (falla, no cierra). | unitaria |
| Media | La sonda se registraba como «vista» **antes** de persistir: tras 3 intentos fallidos dejaba de sondear sin haber guardado nada. | Se registra después de persistir y finalizar. | A12 |
| Media | El cursor suponía un orden estable dentro de un mismo instante (Mercado Pago no documenta clave secundaria). | El cursor es el último instante con posición 0; la posición sólo se usa mientras la página es un único grupo. | unitaria |
| Media | Un *timeout* causado por el recorte del presupuesto contaba como falla del proveedor. | Se traduce a «sin tiempo»: el trabajo se libera con su intento. | B6 |
| Baja | Con un reloj de pared pequeño la cola de trabajos se moría de hambre. | Mínimo de 90 s. | unitaria |

Además: un huérfano registrado con la versión anterior (sin fecha de actualización) no se reabre al ver el mismo estado (C15).

## 6. Riesgos residuales (lo que NO se probó o no se puede garantizar)

1. **Verificación incompleta (arriba).** Falta la suite completa sobre el código final, la matriz de cortes (B4/B5) y la suite JS. Hasta entonces el código no está certificado.
2. **No se aplicó nada en QA ni en el preview.** La migración `20261022130000` y las siete Edge Functions afectadas siguen sin desplegarse; el respaldo cifrado previo de QA ya está tomado. **Orden obligatorio:** migración primero, funciones después (un worker nuevo contra la base vieja fallaría en su primera llamada a `extend_payment_outbox_lease` y gastaría intentos).
3. **Nada se probó contra Mercado Pago real.** `range=date_last_updated`, `sort=date_last_updated`, `limit` ≤ 50 y `offset` ≤ 10 000 están en la documentación oficial, pero QA no tiene vendedor conectado: la paginación, el formato de fecha y el orden reales siguen sin verificar. Todo el proveedor es simulado.
4. **Grupos de ≥ 50 pagos con exactamente el mismo milisegundo de última actualización**, combinados con un proveedor que cambie el orden de los empates entre pedidos, pueden dejar filas sin leer dentro de esa ventana; la ventana siguiente las relee mientras ese instante esté dentro del solape de 120 min (no en un *backfill* largo). La API no documenta clave secundaria de orden.
5. **Un pago que falla siempre** se salta recién tras 5 corridas (~30 min) y requiere que una persona lo revise: es un hallazgo crítico, no una corrección automática.
6. **CPU de la plataforma (2 s por solicitud)** no se midió en Edge Functions reales; el trabajo del worker es casi todo espera de E/S y los *checkpoints* limitan el daño, pero no hay medición.
7. **El presupuesto asume plan Free (150 s).** En un plan pago hay que fijar `PAYMENT_WORKER_WALL_CLOCK_MS`.
8. **La escalera de verificación termina a los 30 días** (8 lecturas por pago aprobado); un contracargo posterior depende del libro mayor por fecha de actualización y del webhook.
9. **Las Edge Functions no se tipificaron con Deno** (no está instalado aquí); sólo se ejecutaron en un sandbox Node y, después, QA.
10. **`scripts/release-v5/compatibility.json` no se regeneró:** cualquier salida a producción exige re-baseline (la migración cambia la huella del esquema).
11. **Preview público** (sin puerta de acceso) con datos sintéticos de QA.
12. Siguen pendientes, sin cambios respecto de la ronda anterior: pago auténtico de Mercado Pago (firma del webhook, consentimiento del vendedor de prueba `3594962708`, tarjetas), custodia externa cifrada del respaldo con RPO/RTO acordados, y auditoría independiente sobre el commit final.
13. El texto exacto de la segunda auditoría de Astra **no estaba disponible** (sección 0).

## 7. Cómo reproducir

```powershell
$env:TABA_PG_BIN = "<carpeta con psql/pg_ctl de PostgreSQL 15+>"
# clúster local descartable en 127.0.0.1:55440 (ver scripts/local-db/README.md)
node scripts/local-db/clone.mjs taba_local_fix2 --from taba_local_work --apply-newer-than 20261022120000_worker_dispatch_ledger_and_pipeline_health.sql
$env:TABA_LOCAL_DB = "taba_local_fix2"; node --test --test-concurrency=1 tests/db/*.test.mjs                      # verde
$env:TABA_LOCAL_DB = "taba_local_work"; $env:TABA_FUNCTIONS_DIR = "<supabase/functions de c99b1068>"
node --test --test-concurrency=1 tests/db/astra2-*.test.mjs                                                          # rojo (código auditado)
node --test tests/ledger-sweep.test.mjs tests/worker-deadline.test.mjs                                               # unitarias puras
```
