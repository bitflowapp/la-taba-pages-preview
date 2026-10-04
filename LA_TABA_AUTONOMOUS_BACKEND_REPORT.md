# LA TABA — Informe del operador autónomo de backend (2026-10-03, consolidado)

Dos sesiones no supervisadas el mismo día sobre la rama `hardening/taba-ecommerce-production`:

- **Sesión 1** (08:22–13:2x -03:00, PC de trabajo): integró los paquetes de idempotencia, pagos, entregas/alertas y
  autorización, PAY-PROBE-01, el interruptor del cobro real (EDGE-03), el contrato HTTP (API-01) y el certificador sobre un
  Supabase efímero. Leyó Staging y CP en sólo lectura. Su lista de commits está al final.
- **Sesión 2** (14:47–22:xx -03:00, Claude Cloud): retomó desde git y CI, reprodujo el gate canónico de base de datos en la nube,
  encontró y corrigió **dos P1 nuevos de pagos** (PAY-PROBE-02 y PAY-PROBE-03), y sometió su propio arreglo a **siete revisiones
  adversariales independientes** (la última, sin nada por encima de P3) que encontraron otro P1 y seis P2 en él y un P2 anterior
  en el mismo código (PAY-PROBE-10), todos corregidos antes de que se aplique en ningún entorno. Además: DIAG-03, DIAG-02
  (backend), el barrido de alertas que salteaba negocios cerrados (DIAG-14), diez archivos
  pgTAP que no corría nadie (TOOL-11) y lo que las suites viejas del núcleo de pedidos probaban (TOOL-04). Abrió el **PR #133 en
  borrador** para que el CI corra en cada push. Sin credenciales de Supabase ni de Mercado Pago en la nube: **no leyó Staging ni CP**.

Producción y CONTROLLED PRODUCTION sólo en lectura; ningún cobro, reembolso ni dinero real; nada aplicado en Staging ni en CP.
Bitácora: `LA_TABA_AUTONOMOUS_STATUS.md`. Registro de hallazgos (lo leen las compuertas):
`docs/ecommerce-hardening/findings-register.json`.

## Para el dueño, en seis puntos

1. **Qué estaba roto y quedó corregido (P1):** un «vacío» del proveedor se tomaba como prueba de que no hubo pago
   (PAY-PROBE-01); pasadas 48 horas un checkout sin verificar se cerraba solo y nadie volvía a preguntar (PAY-PROBE-02); un pago
   con tarjeta en revisión manual de Mercado Pago sobre un checkout vencido no tenía ninguna alerta y después de 48 horas nadie lo
   releía (PAY-PROBE-03); la preferencia re-reservaba stock antes de su compuerta (FO-01); el cobro real lo abría una variable de
   humo (EDGE-03). La primera versión del arreglo de PAY-PROBE-03 tenía su propio P1 (PAY-PROBE-04), corregido antes de aplicarse.
2. **Registro:** 0 P0 abiertos · **0 P1 abiertos** (17 corregidos, 1 riesgo aceptado: el gate de base necesita Docker y en la PC
   lo cubre el CI) · 47 P2 corregidos, 20 abiertos (decisiones de producto, frontend, otra línea, canal externo).
3. **Probado:** pgTAP canónico **6.501** aserciones (era 5.938 al empezar la sesión 2); carreras de admisión, stock e idempotencia
   con **0 deadlocks**; simulacros de reversión y restauración; `npm test` **3.131** (0 fallas); certificador sobre un Supabase
   completo y efímero; las migraciones nuevas, contra un arnés de 33 mutaciones (32 detectadas y una equivalente).
4. **Nada de la rama corrió todavía en un proyecto alojado.** Aplicarla en Staging es tu decisión: AUTHZ-04 le saca a un empleado
   cancelar y rechazar (también en una caja de Caja Clara operada con cuenta de staff).
5. **Compuertas:** READY_FOR_STAGING **YES** · READY_FOR_CONTROLLED_PRODUCTION **BLOCKED** · READY_FOR_REAL_MONEY **NO**.
6. **Lo próximo:** decidir Owner 1 y 2 (abajo) → aplicar en Staging con el procedimiento → certificar ahí → plan de CP.

## Estado

| | |
|---|---|
| HEAD_INICIAL | `8f0d5958` (inicio de la sesión 2; = `origin`, árbol limpio) · la jornada empezó en `47d9ffe9` (sesión 1) |
| HEAD_FINAL | el último commit de la rama (este informe); último código: `b8b3d440` |
| RAMA | `hardening/taba-ecommerce-production` (apilada sobre `qa/taba-backend-e2e-cert-20260930` = PR #130) |
| COMMITS | sesión 2: 37 (lista abajo) · sesión 1: 62 |
| PUSH | todo pusheado a `origin/hardening/taba-ecommerce-production` |
| PR | **#133 en borrador → `main`** (abierto por la sesión 2 para que el CI corra: el despacho manual de workflows da 403 desde la nube). Apilado sobre #130: **no mergear** sin decidir el orden y Owner 1–2 |
| CI | ver «CI» abajo |

### CI

| HEAD | Validate release candidate | Stack efímero |
|---|---|---|
| `8f0d5958` (inicio) | **verde** (37130800496) | último verde `2bc7218a` (37129059684) |
| `aae0268d` (PAY-PROBE-02/03 + DIAG-03) | base de datos y Windows **verdes**; web cancelado por el push siguiente | PR **verde**; push **rojo** (2 checks de `health`, carrera del certificador corregida en `632df82a`) |
| `6dc0e883` | base de datos **verde**; web y Windows cancelados por el push siguiente | push y PR **verdes** (455 checks, 450 PASS, 0 FAIL) |
| `4187db74` (primera versión de 20261003090000) | **verde completo** (37145732791: web con E2E de navegador, base de datos, Windows) | push y PR **verdes** |
| `9b106cf3` (segunda versión) | **verde completo** (37148525150) | push y PR **verdes** |
| `6fd0b6f4` (tercera versión, TOOL-04, TOOL-11, DIAG-14) | **verde completo** (37150992028: web con E2E, base de datos con 6.441, Windows) | push y PR **verdes** |
| `2edd7cbf` (cuarta versión, DIAG-14 por índice, pruebas del repartidor, del ciclo limpio y del pipeline) | **verde completo** (37154858989: web con E2E, base de datos con 6.488, Windows) | push y PR **verdes** |
| `008cde75` (quinta versión, PAY-PROBE-09) | **verde completo** (37161211210: web con E2E, base de datos con 6.495, Windows) | push y PR **verdes** |
| `45d068b1` (sexta versión, PAY-PROBE-10) | base de datos (6.499) y Windows **verdes**; web cortado por el push siguiente | push y PR **verdes** |
| `bd675d68` (séptima versión, PAY-PROBE-11) | **verde completo** (37164686198: web con E2E, base de datos con 6.500, Windows) | push y PR **verdes** |
| HEAD final | ver los checks del PR #133 | ver los checks del PR #133 |

## QA

| | |
|---|---|
| TESTS | Local en la nube, con Docker y la imagen del gate por digest: **gate canónico completo** (`npm run test:db:isolated`: migraciones como no-superusuario, pgTAP canónico, carreras de impresión, fiscales, admisión, stock e idempotencia, simulacros de reversión, volcado y restauración) catorce veces en la sesión (una falló por la carrera del arnés RACE-01, corregida), la última sobre el árbol final; `npm test`; las verificaciones estáticas de CI (`npm run check`, `migrations:validate`, imágenes del catálogo); simulacros de reversión de 20261003090000 y 20261003092000 (huella del esquema en 12 categorías: revertir deja la anterior exacta, re-aplicar la nueva, revertir dos veces no falla); mediciones con 20.000 checkouts abandonados, 20.000 rechazos guardados y 150.000 asientos sin resultado final de otro negocio; un arnés de 33 mutaciones sobre las guardas de 20261003090000 y 20261003092000. CI: los tres jobs de `Validate release candidate` y el certificador en el stack |
| PASS | pgTAP canónico **6.501/6.501** · `npm test` **3.130/3.131** (1 skip de plataforma) · gate canónico local completo PASS sobre `3a080d44` (6.488), `7d737cf4` (6.495), `f246ee21` (6.499), `16799bf8` (6.500) y `b8b3d440` (6.501) · `GLOBAL_IDEMPOTENCY: PASS` (0 deadlocks, 0 esperas agotadas) · mutaciones **32/33** detectadas (la otra es equivalente) · certificador del stack 0 FAIL |
| FAIL | ninguno abierto. Todas las reproducciones de defectos fallaron ANTES de su arreglo y pasan después (los casos nuevos de 20261003090000: 11 fallan con la primera versión, 4 con la segunda, 3 con la tercera, 3 con la cuarta, 3 con la quinta, 1 con la sexta y 1 con la séptima) |
| FLAKY | **2, los dos con causa reproducida y arreglo**: (1) la fase `health` del certificador afirmaba el latido del planificador antes de la primera corrida de pg_cron en un stack recién levantado (`632df82a`); (2) la carrera de stock del gate (escenario 7): el aviso de pago retiene la fila de la sesión con `for update` y el barrido saltea filas tomadas (`skip locked`); con la máquina cargada los cinco barridos concurrentes la salteaban. Reproducido de forma determinista y corregido en el arnés (un barrido más después de la ronda; la cuenta sigue teniendo que ser exactamente uno) |
| SKIPPED | 1 en `npm test`: la prueba de PowerShell, que sólo corre en Windows (en CI corre en el job de Windows). Ningún skip para conseguir verde |

## Auditoría

| Área | Resultado | Evidencia |
|---|---|---|
| PAGOS | `PASS` hasta el límite posible sin dinero real | Sesión 2: **PAY-PROBE-02** y **PAY-PROBE-03** en `20261003090000`. Pasada la ventana de 48 h, CHECKOUT_PROVIDER_UNVERIFIED la cierra sólo una prueba (sin pago guardado, un vacío concluyente; el resultado final del proveedor; el pedido) o el dueño / un encargado activo con su nota, que vale hasta que el proveedor informe un pago o un estado nuevo; la sonda sigue una vez por día hasta 30 días aunque una persona haya resuelto la alerta; un pago sin resultado final cuenta aunque el cobro tenga guardado un rechazo posterior (PAY-PROBE-07), y detrás de un rechazo guardado la búsqueda diaria sigue 30 días por si aparece un pago aprobado que nunca se asentó (PAY-PROBE-08). La resolución de una persona vale mientras el pago y el estado que la evidencia mostraba sigan iguales. El costo por minuto sigue lo reciente y no la historia, y lo vencido no demora a los checkouts nuevos (PAY-PROBE-09); dentro de las 48 horas un pago guardado se relee cada 2 minutos mientras la reserva siga viva (o en la primera media hora) y después cada 15, no cada minuto, y lo nunca preguntado va primero (PAY-PROBE-10, anterior a la sesión, y PAY-PROBE-11). La migración pasó **siete revisiones adversariales** (PAY-PROBE-04 P1, -05 a -09 y -11 P2, más los P3, y PAY-PROBE-10: todos corregidos; la séptima, sin nada por encima de P3). Recorrido del caso crítico: aprobado + vencido → revisión con alerta sin ventana; vacío persistente → sólo calla uno concluyente y sólo sin pago guardado; reintentos agotados → `dead_letter` con alerta CRITICAL; reconexión del vendedor → vacíos no concluyentes y sonda diaria; aviso fuera de orden o tardío → no retrocede (pgTAP, y el disparador del estado probado de forma directa); cobro duplicado → PAYMENT_NEEDS_REVIEW crítica. Sesión 1: reembolsos, avisos firmados, trabajos muertos, PAY-PROBE-01, EDGE-03, FO-01/FO-02 |
| IDEMPOTENCIA | `PASS` | La carrera global (checkout, preferencia, webhook y su cola, transiciones, cobro manual, entrega, oferta, reembolso, cancelación de pago, perfil y direcciones) en el gate: 0 deadlocks, 0 esperas agotadas, local y en CI. Nuevo en pgTAP: dos barridos seguidos con una sonda en curso dejan un trabajo; el reintento de un repartidor con su clave no toca nada |
| AUTORIZACIÓN | `PASS` en código · aplicación de AUTHZ-04 `OWNER_APPROVAL_REQUIRED` | Barrido de la sesión 2 sobre la rama aplicada: ninguna tabla pública admite escritura directa de clientes salvo columnas de `businesses` (AUTHZ-02) y `products.sort_order`. Matrices pgTAP de 838 (RLS) y 796 (autorización) celdas; ahora también en el gate el aislamiento de back-office (28), de perfiles de cliente (47) y la seguridad del reparto multi-pedido (27), que no corría nadie (TOOL-11); y el punto exacto del cliente sólo para el repartidor que tomó la entrega, por la cola, la función del mapa y la tabla (`2018ea51`, 18; cinco mutaciones de las guardas detectadas). Una prueba de tenant que fallaba resultó ser sólo la mayúscula del mensaje: la negativa 42501 entre comercios está. **Caja Clara:** una caja real con cuenta de staff pierde cancelar/rechazar al aplicar 20261002050000 |
| CONCURRENCIA | `PASS` | Carreras de stock (12 escenarios), admisión, impresión y fiscal en el gate; IDEM-07/IDEM-08. Nuevo: dos repartidores y un pedido por la cola (`stale_revision`, `taken_by_other`) y un pedido ofrecido a uno que toma otro desde la cola (nadie queda con el mismo pedido dos veces). La migración nueva no toma candados nuevos |
| WEBHOOKS | `PASS` | Aviso duplicado ×20 → 1 recibo y 1 trabajo; firmado y sin firma; snapshot viejo no retrocede; aprobado viejo no revive un cobro reembolsado; el contador del centro de operación ve un aviso abandonado (DIAG-02) |
| RECOVERY | `PASS` | Simulacros de reversión en el gate y cadena completa de 50 reversiones (sesión 1); reversiones de 20261003090000 y 20261003092000 exactas y re-ejecutables. Restauración de volcado con evidencia durable (gate) |
| MIGRACIONES | `PASS` local, en CI y en el stack · aplicación `OWNER_APPROVAL_REQUIRED` | 211 migraciones (157 de `main` + 54 de la rama) en el gate como no-superusuario y en un Supabase efímero. Las de la sesión 2 (20261003090000, -091000, -092000) se generaron de las definiciones vivas con reemplazos exactos y guardas `ROLLOUT_BLOCKED`. Verificaciones previas de sólo lectura: tres archivos en `docs/migrations/checks/` (el de 20261003 nunca corrió contra Staging/CP: no hubo credenciales) |
| ALERTAS | `PASS` con pendientes | CHECKOUT_PROVIDER_UNVERIFIED no se cierra por tiempo; el barrido de alertas ya no saltea un negocio cerrado con cobros en movimiento (DIAG-14: «cerrado» es el fin de día del Panel); ORDER_READY_WITHOUT_RIDER y STOCK_RESERVATION_STUCK con prueba; un ciclo limpio (Mercado Pago con retiro y efectivo con envío) no deja ninguna alerta ni con sus horas corridas tres horas atrás, y el Panel ve el pedido de Checkout Pro una vez (`4a0ce219` y `3a080d44`, 18; cinco mutaciones de falso positivo detectadas). Pendientes: **no hay canal fuera de banda** (DIAG-09); el Panel muestra para STOCK_RESERVATION_STUCK «se libera sola, avisá a soporte» aun cuando el stock lo retiene un cobro en revisión (ALERT-STOCK-01, P3, frontend) |
| HEALTH | `PASS` | **DIAG-03 corregido** (`b6a94a96`): la sonda contaba 0 CRITICAL con una abierta y exigía exactamente cuatro tareas; ahora exige el inventario de la base, cuenta por severidad y acepta CP y Staging (`--target`) |
| OBSERVABILIDAD | `PASS` con pendientes | Evidencia de la alerta con el estado del proveedor y el pago a buscar; el pulso de CP cuenta un cobro sin pedido desde su aprobación (`288da41f`); `blocked_outboxes` cuenta los avisos abandonados (`6dc0e883`). Pendientes: DIAG-02 (textos del Panel), DIAG-09, DIAG-10 |
| SEGURIDAD | `PASS` con pendientes | El cobro real en CP falla cerrado (leído por la sesión 1 a las 11:25); el interruptor exige el valor exacto `enabled`; las auxiliares nuevas no las ejecuta ningún rol de cliente ni service_role; las sondas sólo mandan SELECT al endpoint de sólo lectura. AUTHZ-02/AUTHZ-04 (resto) esperan decisión |
| STACK | `PASS` | Certificador contra un Supabase completo y efímero (GoTrue, PostgREST, pg_cron y Edge reales): 0 FAIL en las corridas desde `6dc0e883` |

## Entornos

| | |
|---|---|
| STAGING | Sin cambios de ninguna sesión. Ledger 158 leído a las 11:20 (sesión 1); la rama tiene 53 migraciones más. Pago TEST `179851082485` aprobado sin pedido (no es dinero real): alguien tiene que reembolsarlo o recuperarlo. La sesión 2 no lo pudo releer |
| CONTROLLED_PRODUCTION | Sin cambios. Última lectura (sesión 1, 11:25): compuerta de release NOT_READY, `MONEY_MOVEMENT_POSSIBLE: NO`, ningún comercio con Mercado Pago productivo ni vendedor conectado, ledger 157 |
| PRODUCTION_READ_ONLY | Sesión 1: todas las lecturas por el endpoint de sólo lectura de la Management API o por nombres de secretos. Sesión 2: ninguna lectura (sin credenciales en la nube) |

## Hallazgos

### BUGS_ENCONTRADOS por la sesión 2 (con evidencia)

| Id | Sev. | Qué | Evidencia | Estado |
|---|---|---|---|---|
| PAY-PROBE-02 | **P1** | Pasada la ventana de 48 horas, CHECKOUT_PROVIDER_UNVERIFIED se resolvía sola y el barrido dejaba de preguntar, sin ninguna prueba de que el comprador no pagó | 47 h abierta, 49 h resuelta por el sistema, ninguna sonda | corregido (`d89ad936`, `d6532530`, `dcd541cb`, `6812143a`, `7d737cf4`, `f246ee21`, `16799bf8`, `b8b3d440`) |
| PAY-PROBE-03 | **P1** | Un pago pending / in_process / authorized sobre un checkout vencido: ninguna alerta y, pasadas 48 h, nadie lo releía | Ninguna alerta a 47 ni a 49 h, ninguna sonda a 49 h | corregido (`56a76d24`, `d6532530`, `dcd541cb`, `6812143a`, `7d737cf4`, `f246ee21`, `16799bf8`, `b8b3d440`) |
| PAY-PROBE-04 | **P1** | En la primera versión del arreglo, un vacío concluyente anterior al pago callaba la alerta y la sonda de un pago en revisión | Revisión adversarial: a 49 h, sin alerta de ningún código y sin sonda | corregido `d6532530` (nunca aplicado) |
| PAY-PROBE-05 | P2 | La resolución del dueño no se comparaba con lo posterior, frenaba la relectura y cambiaba lo de adentro de la ventana | Revisión adversarial, escenarios r1 y s1 | corregido `d6532530` (nunca aplicado) |
| PAY-PROBE-06 | P2 | El costo por minuto del barrido y de la alerta crecía con toda la historia | 20.000 checkouts: ~475 y ~400 ms (antes ~20 y ~45) | corregido `d6532530` (nunca aplicado) |
| PAY-PROBE-07 | P2 | Un pago en revisión quedaba tapado cuando el comprador reintentaba en la misma preferencia y el pago guardado, más nuevo, era un rechazo | Segunda revisión: a 49 h, sin alerta y sin sonda | corregido `dcd541cb` (nunca aplicado) |
| PAY-PROBE-08 | P2 | Un pago en revisión que nunca se asentó (sus avisos se perdieron), detrás de un reintento rechazado: pasadas 48 h la sonda dejaba de buscar | Tercera revisión: a 49 h, sin alerta y sin sonda | corregido `6812143a`, `7d737cf4`, `f246ee21` y `16799bf8` (nunca aplicado) |
| PAY-PROBE-09 | P2 | El prefiltro de la cuarta versión hacía que la reconciliación de cada negocio leyera por minuto todos los asientos sin resultado final de la plataforma, y el cupo único del barrido dejaba que una tanda vencida demorara a los checkouts nuevos | Cuarta revisión: 150.000 asientos de otro negocio, 110-185 ms por reconciliación; 200 vencidos, cuatro corridas de espera | corregido `7d737cf4`, `f246ee21` y `16799bf8` (nunca aplicado): 10-20 ms con los asientos repartidos en el año; el checkout nuevo, en la primera corrida |
| PAY-PROBE-10 | P2 | Anterior a la sesión: dentro de las 48 horas, un checkout con un pago guardado (rechazado, pendiente, en revisión) se volvía a preguntar al proveedor cada minuto, y unos 50 así dejaban sin sonda a un checkout nuevo | Quinta revisión: 60 rechazados recientes, el checkout de hace 3 minutos sin sonda en ninguna corrida | corregido `f246ee21` y `16799bf8` (nunca aplicado): lo nunca preguntado, primero; un pago guardado, cada 2 y después cada 15 minutos |
| PAY-PROBE-11 | P2 | La sexta versión releía un pago guardado sin resolver sólo con el cupo de los vacíos (8 y luego 2/6/24 h), contado sobre todos los trabajos del checkout: un aviso de aprobación perdido se veía hasta 18-24 h después, o nunca dentro de la ventana | Sexta revisión: aprobado a las 6 h, leído a las 24 h; con 11 trabajos previos, a las 48 h | corregido `16799bf8` y `b8b3d440` (nunca aplicado): intervalo fijo desde la última sonda, sin cupo; a lo sumo 15 minutos, y cada 2 mientras la reserva siga viva |
| DIAG-14 | P2 | El barrido de alertas salteaba un negocio cerrado sin alertas abiertas, y «cerrado» es el fin de día del Panel | Segunda revisión: checkout sin verificar de un negocio cerrado, ninguna alerta, nunca pasados 30 días | corregido `c5166237` y `3573140a` (20261003092000) |
| TOOL-11 | P2 | Doce archivos pgTAP no corrían en ningún gate ni workflow (aislamiento de clientes y back-office, seguridad del reparto) | 7 pasaban tal cual; 3 con fixtures viejos | corregido `e3626e89` (+347 aserciones) |
| TOOL-04 | P2 | Las suites SQL del núcleo de pedidos estaban huérfanas | No reviven (API v1 retirada); mapa de cobertura | cerrado `5f9a326b` (41 aserciones portadas) y, después, `6fd0b6f4`, `2018ea51`, `4a0ce219` y `3a080d44` (reembolso tras un rearmado sin stock, punto exacto del repartidor, ciclo limpio sin alertas, el pedido de Checkout Pro en el pipeline del Panel) |
| DIAG-03 | P2 | La sonda de salud no veía alertas CRITICAL y exigía exactamente cuatro tareas | 1 CRITICAL abierta → la consulta vieja contaba 0 | corregido `b6a94a96` |
| DIAG-02 (backend) | P2 | `blocked_outboxes` no contaba un aviso de Mercado Pago abandonado | pgTAP: 0 antes, 1 y 2 después | corregido `6dc0e883`; queda el texto del Panel |
| CERT-02 | P3 | La fase `health` del certificador afirmaba el latido antes de la primera corrida de pg_cron | Run 37143748544 | corregido `632df82a` |
| PULSE-01 | P3 | El pulso de CP contaba un cobro sin pedido desde su última relectura | Prueba nueva que falla con el código anterior | corregido `288da41f` |
| RACE-01 | P3 | La carrera de stock del gate podía fallar sin defecto del producto | Gate local: 0 ≠ 1; mecanismo reproducido | corregido en el arnés `a181a429` |
| (revisión) | P3 | Segunda pasada: resolución vs. último refresco de la evidencia, U3, dos guardas sin prueba. Tercera: un pago sin resolver asentado después de 30 días, costo del paso caro con muchos rechazados, costo de la selección de negocios cerrados, la carrera de la hora del asiento, tres mutaciones vivas. Cuarta: la CPU del ritmo diario con muchos rechazos guardados (dentro de PAY-PROBE-09); el contracargo tardío de un negocio cerrado y dormido queda documentado en DIAG-14. Quinta: la cota de 30 días con un negocio cerrado y dormido (documentada en PAY-PROBE-09). Sexta: el costo del conteo de la sexta versión con historias largas (dentro de PAY-PROBE-11). Séptima: la fase de 2 minutos fija en 30 minutos frente a sesiones de hasta 60 | Segunda a séptima revisión | corregidos `dcd541cb`, `6812143a`, `3573140a`, `7d737cf4`, `f246ee21`, `16799bf8` y `b8b3d440` |
| ALERT-STOCK-01 | P3 | STOCK_RESERVATION_STUCK de un cobro en revisión: el barrido nunca la cierra y el Panel dice «se libera sola, avisá a soporte»; la receta correcta (rearmar o devolver desde el Panel) sólo está en la lista de servicio | Reproducido; caracterizado en `order_core_gaps_test.sql` | **abierto**: el Panel no muestra el texto de la base; hace falta mapear por estado (frontend) |
| RIDER-01 | P3 | Con `rider_presence_required`, un repartidor «no disponible» igual puede tomar un pedido de la cola abierta (sólo las ofertas exigen presencia) | Leído en el código y en el ensayo de la cola | **abierto**: decisión de producto (Owner 11) |

### BUGS_CORREGIDOS (la jornada completa)

- Sesión 2: PAY-PROBE-02 a -11, DIAG-14, TOOL-11, TOOL-04, DIAG-03, DIAG-02 (backend), CERT-02, PULSE-01, RACE-01 y los P3 de la
  segunda y la tercera revisión (tabla de arriba).
- Sesión 1 (detalle en su bitácora): idempotencia (7 defectos de la carrera), IDEM-07, IDEM-08, reembolsos y avisos firmados,
  PAY-PROBE-01, TRACK-01, RB-01, RB-02, FO-01, FO-02, EDGE-03, contrato HTTP (API-01 + C-2), TOOL-05, AUTHZ-04 (parcial).
- Registro: **P1 17 corregidos, 0 abiertos**, 1 riesgo aceptado (TOOL-01); P2 47 corregidos, 20 abiertos.

### PENDIENTES

| Id | Sev. | Qué | Por qué no se hizo |
|---|---|---|---|
| DIAG-09 | P2 | Ninguna alerta crítica sale del Panel: no hay correo, WhatsApp ni push | Hace falta elegir el canal y darle una credencial: decisión del dueño (Owner 6) |
| DIAG-10 | P2 | El vigilante externo del planificador mira el sitio de la producción vieja | Retargetearlo a CP es operativo (Owner 7) |
| AUTHZ-04 (resto), AUTHZ-02 | P2 | `set_business_open_state`, `authorize_arca_homologation`; escritura directa de columnas de `businesses` | Decisión de producto |
| PAY-06 (resto) | P2 | Nadie relee en el proveedor un cobro ya completado (tampoco otro pago pendiente del mismo checkout, como un ticket en efectivo que quedó pendiente después de que la tarjeta armó el pedido); un `cancellation_reconcile` muerto no tiene salida propia | Decisión del dueño (ventana, frecuencia, límites del proveedor) |
| PAY-PROBE-08 (seguimiento) | P3 | Que el worker asiente también los otros pagos que ve la búsqueda por referencia: haría visible (con alerta) un pago en revisión que nunca se asentó; hoy sólo se encuentra cuando se aprueba | Cambio en la función Edge del worker y su despliegue; el riesgo de dinero ya lo cubre la búsqueda diaria |
| DIAG-02 (resto), ALERT-STOCK-01 | P2/P3 | Textos del Panel: códigos nuevos con texto genérico; STOCK_RESERVATION_STUCK sin distinguir un cobro en revisión | Frontend: tocar un archivo precacheado obliga a subir la identidad del service worker (línea de frontend). El backend ya da el estado (`list_stock_reservation_alerts`) |
| EDGE-06, EDGE-15 | P2/P3 | Preferencia dudosa sin re-envío; cancelación `requested` sin trabajo si fallan tres escrituras seguidas | Decisión / residual documentado |
| Pruebas no portadas | P3 | Del mapa de TOOL-04 quedan sin pgTAP las métricas del centro de operación (lo demás ya entró: `6fd0b6f4`, `2018ea51`, `4a0ce219`, `3a080d44`) | Prioridad menor que lo portado; quedan listados |
| Contrato HTTP (resto) | P3 | 40 entradas de otras líneas y las dos SQL de OAuth siguen contestando 500 a un 55000/P0002 | Son de otras líneas |
| Resto del registro | P2 | 20 P2 abiertos | Ver el registro |

### RIESGOS_RESIDUALES

1. **Nada de la rama corrió sobre un proyecto alojado** (Staging 158, CP 157; la rama 211). La evidencia es el gate (local y CI),
   un Supabase efímero en CI y PG17 local.
2. **La sesión 2 no leyó ningún entorno.** Lo último en vivo es de las 11:25. Antes de aplicar, repetir las tres verificaciones previas.
3. Mercado Pago real nunca se ejercitó (regla); los pagos se probaron con un proveedor simulado, Mercado Pago TEST en lectura y el stack.
4. Una alerta crítica a la noche no la ve nadie hasta que alguien abra el Panel o corra el pulso (DIAG-09). Con 20261003092000 al
   menos se calcula aunque el negocio esté cerrado, si tuvo checkouts en los últimos 30 días o una alerta abierta (un aviso tardío
   sobre un cobro más viejo de un negocio cerrado y sin movimiento se calcula al reabrir; un cobro aprobado sin pedido lo cuenta igual el pulso de CP).
5. Al aplicar 20261003090000, los checkouts de las 48 horas previas quedan vigilados sin límite de tiempo: en Staging, donde el
   vendedor TEST se reconecta seguido, pueden aparecer alertas CRITICAL que necesitan una nota del dueño o un encargado pasadas
   las 48 horas. Es la conducta buscada; la verificación previa U1/U2 dice cuántas antes de aplicar.
6. La migración de pagos de la sesión 2 cambió ocho veces antes de aplicarse; la versión final tiene corregidos y probados los
   hallazgos de siete revisiones adversariales (120 aserciones, 33 mutaciones), y la séptima pasada, sobre la versión anterior, no encontró nada por encima de P3 (su P3 quedó corregido en la octava versión, con su prueba y su mutación).
7. Costo de la búsqueda diaria detrás de un rechazo guardado (PAY-PROBE-08/09): el barrido cuenta el ritmo diario por índices y le
   da a lo que pasó la ventana un cupo propio de 10 por corrida (14.400 búsquedas por día; más que eso estira el ritmo, no descarta
   nada); con 20.000 rechazados vencidos juntos, 79-91 ms por corrida. La reconciliación sigue el volumen de asientos sin resultado
   final del último mes de toda la plataforma: despreciable con el volumen esperado de CP; con 150.000 dentro del mes, ~61-88 ms
   por negocio.
8. Pasados 30 días, un checkout sin pago se sigue sólo por su alerta: uno que nunca tuvo alerta en sus primeros 30 días (por un
   corte del planificador de 30 días) no se resucita; lo muestra la conciliación (`scripts/payments/reconcile-payments.mjs`). Y
   el primer asiento de un pago sin resolver más de 30 días después de su checkout, leído con el negocio cerrado y sin
   checkouts, no abre alerta si el negocio reabre más de 30 días después (P3 documentado en PAY-PROBE-09).
9. AUTHZ-04 cambia lo que puede hacer un empleado en el Panel y en una caja de Caja Clara operada con cuenta de staff.

## OWNER_APPROVAL_REQUIRED

Cada ítem con el paso exacto. **Ninguno se ejecutó.**

1. **Aplicar la rama en Staging** (211 migraciones + las 9 Edge Functions de Mercado Pago).
   - Por qué: es la única forma de certificar el build en un proyecto alojado. Riesgo: AUTHZ-04 cambia lo que hacen las corridas de
     la línea Caja Clara (su comercio `la-taba-staging` canceló 24 pedidos como empleado) y `abandoned_order_minutes=120` de ese
     comercio empieza a cumplirse (`docs/ecommerce-hardening/staging-coexistence.md`); 20261003090000 puede abrir alertas críticas
     de checkouts recientes sin verificar; 20261003092000 hace que un negocio cerrado con cobros recientes se evalúe (puede mostrar
     alertas que antes esperaban a la apertura).
   - Pasos: (a) acordar con la línea Caja Clara (punto 2); (b) respaldo: `npx supabase@2.101.0 db dump --linked` con datos, en un
     lugar privado; (c) verificaciones previas, guardando la salida:
     `node scripts/release/run-readonly-checks.mjs --target staging --file docs/migrations/checks/20261001_ecommerce_hardening_preflight.sql`
     y lo mismo con `20261002_ecommerce_hardening_preflight.sql` y `20261003_unverified_checkout_preflight.sql`; (d) en una carpeta
     aislada con `supabase/config.toml` y `supabase/migrations/` del commit: `npx supabase@2.101.0 link --project-ref ucbtjcurawxjwjdvvcvj`
     → `db push --linked --dry-run` → `db push --linked --include-all`; (e) desplegar las 9 funciones `mercadopago-*`; (f)
     `node scripts/e2e-staging/ecommerce-certification.mjs --target staging --confirm STAGING_MUTATION_OK` (tenant propio de QA);
     (g) repetir las verificaciones previas y `node scripts/production-health-check.mjs --target staging`.
2. **Confirmar AUTHZ-04 tal como quedó**: el empleado pierde cancelar y rechazar en el acto (también en una caja de Caja Clara con
   cuenta de staff), el Panel y la caja siguen mostrando los botones, y el catálogo da permisos por rol para toda la plataforma.
   Si se quiere que el empleado cancele: una fila `('staff','orders.cancel')` en `identity_role_permissions` (vale para todos los
   comercios). Alternativa: que la caja entre con cuenta de encargado.
3. **Promoción a CONTROLLED PRODUCTION**: `docs/ecommerce-hardening/controlled-production-promotion-plan.md` (escrito, no
   ejecutado; incluye las guardas y la marca de agua de 20261003090000). No antes del punto 1 y del CI verde sobre el mismo commit.
4. **Dinero real** (nada de esto se hizo): (a) desplegar en CP las 9 funciones de esta rama (leen el interruptor nuevo; la variable
   vieja de humo tiene que seguir ausente); (b) certificar Mercado Pago en producción; (c) conectar el vendedor real; (d) decisión
   de apertura con Mercado Pago; (e) un canal fuera de banda para alertas críticas (punto 6); (f) recién entonces, con autorización
   escrita: `npx supabase@2.101.0 secrets set MERCADOPAGO_REAL_MONEY_ENABLED=enabled --project-ref tkanbadcglszlcyfjvpv` (apagar:
   `secrets unset MERCADOPAGO_REAL_MONEY_ENABLED`; los reembolsos siguen funcionando) y verificar con
   `node scripts/release/ecommerce-release-gates.mjs --target controlled-production --business-id <uuid>` (`REAL_MONEY_GATE`).
5. **PR #133**: decidir el orden de merge (#130 primero) y cuándo sale de borrador.
6. **Canal fuera de banda (DIAG-09)**: elegir canal y credencial. Propuesta mínima, sin código nuevo de producto: un workflow
   programado que corra `node scripts/production-health-check.mjs --target controlled-production` y falle (GitHub manda el
   correo) con una alerta CRITICAL abierta; necesita un token de la Management API como secreto del repositorio (es una
   credencial de cuenta: preferible una cuenta de servicio dedicada).
7. **Vigilante externo a CP (DIAG-10)**: cargar en el repositorio la variable `SUPABASE_URL` y el secreto `SUPABASE_ANON_KEY` de CP
   (la sonda ya los prefiere a lo publicado), o decidir que siga mirando la producción vieja.
8. **PAY-06**: política para volver a leer cobros completados (ventana y frecuencia).
9. **Staging**: reembolsar en el panel TEST de Mercado Pago (o recuperar) el pago `179851082485`.
10. **Comercio real de CP**: catálogo, horarios, modo de entrega, equipo, vendedor de Mercado Pago y decisión de cobro (los cinco
    bloqueos de negocio de la compuerta de release).
11. **RIDER-01**: con `rider_presence_required` encendido, ¿un repartidor marcado «no disponible» puede tomar pedidos de la cola
    abierta? Hoy sí (sólo las ofertas exigen presencia). Si no: que `claim_delivery_order` exija la misma presencia que
    `accept_rider_order_offer` (cambio chico, con prueba; puede afectar APKs viejas que usan la cola sin presencia).

## Compuertas

Significado usado: **YES** = técnicamente listo con evidencia reproducible; lo único que falta es la acción autorizada misma.
**BLOCKED** = no puede avanzar hasta una decisión o un insumo de otro (dueño, comercio, proveedor). **NO** = falta trabajo técnico.

**READY_FOR_STAGING: `YES`**

- Gate canónico PASS en local y en CI, certificador sin FAIL en un Supabase efímero, 0 P0/P1 abiertos, reversión de cada migración
  nueva ensayada, la migración de pagos revisada siete veces de forma adversarial; CI del HEAD final en el PR #133.
- Aplicarla es `OWNER_APPROVAL_REQUIRED` (Owner 1 y 2): cambia permisos de empleados y convive con la línea Caja Clara.

**READY_FOR_CONTROLLED_PRODUCTION: `BLOCKED`**

- Bloquea: certificar ESTE build en Staging (Owner 1), y los insumos del comercio real (Owner 10). Con eso, el plan de promoción.

**READY_FOR_REAL_MONEY: `NO`**

- Falta trabajo técnico, no sólo autorización: la rama nunca corrió en un proyecto alojado; Mercado Pago productivo nunca se
  certificó; no hay canal fuera de banda para una alerta crítica (DIAG-09); nadie relee un cobro completado (PAY-06). Además faltan
  el vendedor real y la decisión de apertura. Hoy CP falla cerrado (`MONEY_MOVEMENT_POSSIBLE: NO`, leído por la sesión 1).

## Commits de la sesión 2

- `d89ad936` fix(payments): un checkout que nadie verificó no se cierra por tiempo (PAY-PROBE-02)
- `b6a94a96` fix(health): la sonda de salud ve las alertas CRITICAL y exige las tareas del inventario (DIAG-03)
- `8c7a98f3` docs(register): PAY-PROBE-02 corregido en d89ad936 y DIAG-03 en b6a94a96
- `56a76d24` fix(payments): un pago que el proveedor no resolvió tampoco se cierra por tiempo (PAY-PROBE-03)
- `aae0268d` docs(register): PAY-PROBE-03 corregido en 56a76d24
- `632df82a` fix(cert): en un stack recién levantado, la fase de salud espera el primer latido del planificador
- `e17fe311` docs(migrations): verificación previa de 20261003090000 y su lugar en el plan de promoción
- `3986674e` feat(tooling): una base local armada como la arma el gate, que queda viva para reproducir
- `288da41f` fix(ops-pulse): un cobro sin pedido se cuenta desde su aprobación, no desde su última relectura
- `dd5f57af` docs(report): informe consolidado de la jornada y el estado de la sesión en la nube
- `a850417f` docs(staging): qué deja 20261003090000 en Staging al aplicarse y cómo medirlo antes
- `6dc0e883` fix(ops): el centro de operación cuenta los avisos de Mercado Pago que la cola abandonó (DIAG-02)
- `a181a429` fix(race): la carrera de stock no depende de que un barrido concurrente encuentre libre la fila de la sesión (RACE-01)
- `4187db74` docs(report): DIAG-02, el CI de 6dc0e883 y la carrera de stock (RACE-01) con su causa
- `d6532530` fix(payments): un vacío anterior al pago no calla un cobro sin resultado, y la resolución vale hasta que el proveedor diga algo nuevo (PAY-PROBE-04/05/06)
- `9b106cf3` docs(register): PAY-PROBE-04, -05 y -06 (defectos de la primera versión de 20261003090000, corregidos en d6532530) y la bitácora
- `e3626e89` test(gate): diez archivos pgTAP que existían y no corría ningún gate entran al canónico (TOOL-11)
- `dcd541cb` fix(payments): un pago en revisión no queda tapado por un reintento rechazado, y lo asentado después del último refresco cuenta como nuevo (PAY-PROBE-07)
- `c5166237` fix(alerts): el barrido de alertas no saltea un negocio cerrado con cobros en movimiento (DIAG-14)
- `5f9a326b` test(order-core): lo que las suites viejas del núcleo de pedidos probaban y nada probaba hoy (TOOL-04)
- `1685b3e1` docs(report): tercera revisión de la migración de pagos, el barrido de negocios cerrados, TOOL-04 y TOOL-11, y el informe consolidado
- `6fd0b6f4` test(payments): rechazado un rearmado por falta de stock, devolver el dinero sigue ofrecido en el Panel
- `6812143a` fix(payments): una búsqueda por día detrás de un rechazo guardado, y la resolución compara el pago que la evidencia mostraba (PAY-PROBE-08)
- `3573140a` perf(alerts): el barrido elige los negocios cerrados por el índice de la fecha de creación del cobro (DIAG-14)
- `dfedfcc1` docs(report): cuarta revisión de la migración de pagos (PAY-PROBE-08) y del barrido de negocios cerrados, registro y bitácora
- `2018ea51` test(rider): el repartidor ve el punto exacto del cliente sólo después de tomar la entrega
- `4a0ce219` test(alerts): un ciclo limpio no deja ninguna alerta abierta, ni cuando pasaron horas
- `3a080d44` test(panel): el pedido de Checkout Pro aparece una vez en el pipeline del Panel y su checkout deja de figurar
- `2edd7cbf` docs(report): las tres pruebas de regresión del mapa de TOOL-04 en el registro, la bitácora y el informe
- `7d737cf4` perf(payments): la reconciliación lee lo reciente y no toda la historia, y lo vencido no demora a los checkouts nuevos (PAY-PROBE-09)
- `008cde75` docs(report): cuarta revisión adversarial y quinta versión de la migración de pagos (PAY-PROBE-09)
- `f246ee21` fix(payments): dentro de las 48 horas un pago guardado no se repregunta cada minuto y lo nunca preguntado va primero (PAY-PROBE-10)
- `45d068b1` docs(report): quinta revisión adversarial y sexta versión de la migración de pagos (PAY-PROBE-10)
- `16799bf8` fix(payments): un pago guardado sin resolver se relee cada 15 minutos desde la última sonda, sin cupo que se gaste (PAY-PROBE-11)
- `bd675d68` docs(report): sexta revisión adversarial y séptima versión de la migración de pagos (PAY-PROBE-11)
- `b8b3d440` fix(payments): la relectura de 2 minutos dura mientras la reserva del checkout siga viva
- (este informe, el registro y el archivo de estado)

## Commits de la sesión 1

- `591e06d0` docs(status): checkpoint inicial del operador autónomo y preflight de sólo lectura en Staging y CP
- `f2cafbd3` docs(evidence): la carrera de idempotencia falla sin los paquetes pendientes y pasa con ellos
- `b161ad39` docs(evidence): CP no está lista y un cobro aprobado quedó invisible en Staging
- `b7cd898b` docs(status): el archivo de estado no lleva rutas de disco locales
- `3007ed39` fix(idempotency): el mismo comando dos veces a la vez no traba ni duplica nada
- `cf0d30fb` fix(payments): reembolsos, avisos firmados y trabajos muertos con prueba ejecutada
- `4a4afa79` fix(delivery): una entrega en curso tiene salida, y las alertas cubren lo que faltaba
- `8d4a275a` chore(rollback): las reversiones de entregas y alertas toman su candado una sola vez
- `4cee8a74` fix(auth): cancelar o rechazar un pedido sigue el catálogo de permisos (AUTHZ-04), y las negativas de permiso son 403
- `5c578793` fix(payments): un «vacío» del proveedor no prueba que el comprador no pagó (PAY-PROBE-01)
- `34460beb` fix(rollback): revertir el cierre de entrega sin código devuelve el EXECUTE de service_role
- `a7eb622c` fix(tooling): los arneses de carrera sólo corren contra una base local de verdad
- `c5454a0c` docs(hardening): registro, verificación previa de la segunda tanda y plan de promoción a CP
- `61e8b464` docs(status): los cinco frentes después de integrar los cuatro paquetes y PAY-PROBE-01
- `60a7f6ed` feat(cert): el certificador e-commerce corre contra un Supabase completo y efímero en CI
- `cd7a9e94` fix(ci): el diagnóstico de privilegios por defecto del stack castea el tipo de objeto
- `511dc88b` fix(cert): en el stack efímero, que el gateway no exija la clave del proyecto queda como no probado
- `c997a18c` fix(payments): la marca de envío dudoso de la preferencia toma el cobro antes que el intento (IDEM-08)
- `422f0800` docs(hardening): IDEM-08 corregido en c997a18c
- `e7287f53` fix(riders): rechazar o retirar una oferta de reparto toma el pedido antes que la oferta (IDEM-07)
- `ac64a30a` docs(hardening): IDEM-07 corregido en e7287f53
- `59a8e5ca` fix(riders): 20261002062000 no le saca el EXECUTE a service_role
- `34f244a9` fix(cert): en el stack, la puerta sin clave de la fase de privacidad queda como no probada si no se filtró nada
- `7711adad` docs(status): certificador en el stack (448/455), IDEM-07 e IDEM-08, CI de base de datos verde
- `f02e55b2` fix(checkout): la pantalla del pago no se rompe después de recuperar el seguimiento (TRACK-01)
- `0e75dbe8` docs(hardening): TRACK-01 corregido en f02e55b2
- `2b1eb571` docs(cp): la cadena de reversiones sobre 0e75dbe8 y la única diferencia de forma conocida
- `011717fa` docs(report): borrador del informe del operador autónomo (se completa al cierre)
- `a11fc45f` docs(status): CI completo verde sobre a7eb622c y certificador 448/455 en el stack
- `4ba385b7` docs(evidence): el certificador e-commerce contra el Supabase efímero, corrida 37125278937
- `cd34baf1` docs(status): dos paquetes en worktrees aislados (interruptor del cobro real y contrato HTTP)
- `6e7af1d4` fix(payments): el cobro real en producción lo abre un interruptor explícito y permanente (EDGE-03)
- `297130a7` feat(release): compuerta REAL_MONEY_GATE y MONEY_MOVEMENT_POSSIBLE calculado, nunca adivinado
- `cb7f60f2` fix(mercadopago): la verificación de configuración nombra el interruptor y la variable vieja de humo es un error
- `d4e5fa13` docs(payments): los runbooks hablan de un solo interruptor de dinero real y de cómo apagarlo en un paso
- `24b040c2` docs(payments): EDGE-03 corregido; el plan de promoción y las acciones pendientes hablan del interruptor real
- `1104bf81` docs(status): interruptor del cobro real integrado (EDGE-03)
- `889903da` docs(report): EDGE-03 integrado y los dos huecos fail-open que encontró
- `dc8f0771` docs(report): cuatro de los cinco scripts piloto cancelan con un encargado (AUTHZ-04 no los afecta)
- `7f9cc793` docs(report): el stack efímero (448/455, estable en 4 corridas) y el rendimiento medido
- `08db0dc1` docs(report): resultado (CP BLOCKED, dinero real NO) y números actualizados
- `4798c0ac` docs(status): bloque «para retomar» al principio del archivo de estado
- `e7dd4294` docs(status): sin la ruta de disco que se coló en 4798c0ac
- `1470b3ff` fix(ci): el verificador A1-A4 simula el cobro real autorizado también con el interruptor de EDGE-03
- `ec818d12` feat(api): la frontera de la API contesta 409 a una negativa de negocio y 404 a un «no existe»
- `728a92bc` test(api): el contrato HTTP de la frontera, en pgTAP y en el certificador
- `019f2cef` docs(api): la política del contrato HTTP y la prueba por PostgREST antes y después
- `0afe8a70` fix(api): una negativa a un cliente lleva el SQLSTATE de lo que significa, no P0001
- `11093b0a` docs(api): notas del contrato HTTP para integrar y retomar
- `a1e760a5` docs(api): las dos entradas SQL que llegan a 55000/P0002, en el contrato legible por máquina
- `a9e72b2a` test(api): la conversión de la frontera vista como la ve PostgREST, contra una base local
- `d79992cf` docs(api): qué agujeros de la selección del lead cerró el generador
- `ed86e3cb` test(certifier): con API-01 cerrado, el check del precio exige 409 y no el 500 del defecto
- `63119fd8` docs(register): API-01 corregido por 20261002090000 y 20261002091000
- `2bc7218a` docs(promotion): la guarda ROLLOUT_BLOCKED del contrato HTTP y la cadena de 50 reversiones
- `8d17f241` docs(evidence): el stack con el contrato HTTP (450/455, 0 FAIL) y CP releída a las 11:25
- `8253bc43` docs(report): contrato HTTP integrado, stack sin FAIL y segunda pasada
- `75aa9643` docs(report): la ruta real del script piloto y por qué su rol sigue sin confirmar
- `94479254` fix(tests): la prueba de la guardia de Supabase trabaja sobre copias y no reescribe ci.yml (TOOL-05)
- `59fa86b8` docs(register): TOOL-05 corregido en 94479254
- `430431fe` docs(report): cierre por límite de uso; CI final en curso y DIAG-03 confirmado en vivo
- `8f0d5958` fix(tests): la guarda del interruptor acepta la evidencia de sólo lectura en artifacts/
