# LA TABA — estado del operador autónomo de backend

Archivo vivo: se reescribe después de cada frente. Sin secretos. Fuente de verdad: código + git + tests + CI + lecturas en vivo
de sólo lectura. Lo que dice una sesión anterior se cita como «declarado» hasta verificarlo.

## Checkpoint inicial — 2026-10-03 08:40 (-03:00)

| Dato | Valor verificado |
|---|---|
| Worktree | `la-taba-ecommerce-hardening` (worktree de la PC de trabajo; repo `bitflowapp/la-taba-pages-preview`, público) |
| Rama | `hardening/taba-ecommerce-production` (apilada sobre `qa/taba-backend-e2e-cert-20260930` = PR #130, abierto) |
| HEAD inicial | `47d9ffe9` local, 1 commit por delante de `origin` (`423cd90d`) — herramienta de preflight de sólo lectura, sin push |
| `origin/main` | `13581889` · `origin/release/taba-controlled-production` `4e215da4` |
| Working tree | 5 archivos modificados (Edge TS de pagos del paquete wp13 + workflow del stack) y 10 rutas sin seguimiento (certificador `scripts/e2e-staging/ecommerce*`, `scripts/order-intake/idempotency-race.mjs`, 5 tests, plan de promoción, umbrales de performance) — todo borrador sin revisar de la sesión anterior |
| CI de la rama | último `Validate release candidate`: run 37062830721 sobre `d41cf29e` **verde**; `Ecommerce certification on an ephemeral Supabase stack`: run 37067129076 sobre `eaa6b5fe` **verde** (190 migraciones sobre un Supabase completo efímero). Sin CI sobre `423cd90d` (sólo docs) ni `47d9ffe9` |
| Tests conocidos | declarados por la sesión anterior: pgTAP canónico 64 archivos / 4106 aserciones, `npm test` 2969 — **no re-verificados todavía**. Verificado ahora: `tests/run-readonly-checks.test.mjs` 5/5 |
| Staging (`ucbtjcurawxjwjdvvcvj`) | accesible en sólo lectura (Management API). Ledger 158 migraciones; el repo tiene 190 → faltan las 32 de esta rama. Ninguna migración remota ajena al repo |
| CONTROLLED PRODUCTION (`tkanbadcglszlcyfjvpv`) | accesible en sólo lectura. Ledger 157 (le falta además `20261001010000` de la línea principal). **Protegida: sólo lectura** |
| Preflight de migraciones | `scripts/release/run-readonly-checks.mjs` corrido ahora contra Staging y CP: 21/21 consultas sin error en ambos. Integridad de dinero en 0 filas en ambos (`double_converted`, `order_on_refunded_payment`, `refund_in_flight`, `cancellation_downgraded`, `approved_payment_without_order`). Salidas: `artifacts/taba-autonomous-20261003/preflight-*-0835.json` |
| Procesos / agentes | Esta sesión de Claude Code. Codex app-server activo: su hilo de frontend (`la-taba-frontend-polish`, PR #131) terminó 02:21; un hilo de 08:26 sólo **programó el apagado de la PC en 5 h → ~13:27** (evento 1074, a pedido del usuario: no se cancela). Sin Postgres/PostgREST/Docker corriendo. La sesión de backend anterior (Claude `04e206e5`) terminó ~02:21 con 5 agentes a medio camino (murieron con ella) |
| Recursos | 16 GB RAM (6,5 GB libres), CPU de 2 núcleos / 4 hilos, 172 GB libres en C: |
| Worktrees | 31 de este repo + 3 en `Documents/Codex`. Con cambios ajenos sin commit (NO se tocan): `la-taba-caja-final` (línea Caja Clara, migración `20261001030000` sin commit), `la-taba-frontend-polish` (85), `la-taba-pages-preview` (checkout principal, 146), `la-taba-premium-motion` (8), `la-taba-commercial-preview` (1), `la-taba-controlled-production` (1) |

### Los cinco frentes — clasificación inicial (con evidencia)

| Frente | Estado | Evidencia |
|---|---|---|
| Idempotencia | `INCOMPLETE` | El arnés `scripts/order-intake/idempotency-race.mjs` existe sin seguimiento y, según su autor, da `GLOBAL_IDEMPOTENCY: FAIL` con 4 defectos reales (orden de bloqueos en la cancelación de pago → 40P01, libreta de direcciones sin serializar, default de dirección con violación de unique cruda, reintento con código de entrega equivocado) + un deadlock rider offer/accept. Los arreglos (4 migraciones `20261002040000-043000` + pgTAP `idempotent_retries_test.sql`) son borradores sin revisar en el mirror `wp/wp18` de la sesión anterior |
| Pagos | `INCOMPLETE` | Lo ya integrado (wp3a/wp3b/WP4, reconciliación, gates) tiene CI verde. El paquete nuevo wp13 (4 migraciones `20261002020000-023000`, 2 pgTAP grandes, Edge TS de cancelación/reembolso/webhook sin commit en el worktree) es borrador sin revisar |
| Autorización | `INCOMPLETE` | Matriz RLS de 838 celdas integrada (`d1cb1ca`, CI verde). El paquete wp19 (AUTHZ-04 cancelación por catálogo de permisos + refusals 42501; 2 migraciones `20261002050000-051000` + 9 copias de tests) es borrador sin revisar |
| Recuperación de entregas y alertas | `INCOMPLETE` | Paquete wp11 (2 migraciones `20261002010000-011000` + 3 pgTAP) borrador sin revisar |
| Certificación del stack | `INCOMPLETE` | El arranque del stack efímero es real y verde (run 37067129076). El certificador `--target stack` y los cambios al workflow están sin commit y nunca corrieron en CI |

### Estado actual de los cinco frentes (09:40)

| Frente | Estado | Evidencia |
|---|---|---|
| Idempotencia | `PASS` (local + CI en curso) | `3007ed39`: 4 migraciones; la carrera queda en el gate. Local, orden del CI: `GLOBAL_IDEMPOTENCY: PASS`, 754 llamadas, 0 deadlocks, 0 esperas agotadas; sin los arreglos FAIL con 7 defectos y 14 deadlocks. Revisión adversarial: aprobada con notas. Abiertos (registro): IDEM-07, IDEM-08 |
| Pagos | `PASS` (local + CI en curso) | `cf0d30fb`: 4 migraciones + Edge `mercadopago-cancel-payment`; pgTAP 210 + 202 + 46 + 90; Deno 52 + 387. Revisión: sin defectos en los caminos de dinero. **Nuevo P1 PAY-PROBE-01** corregido en `5c578793` (sondas del proveedor), con evidencia viva de Staging |
| Autorización | `PASS` en código; aplicación `BLOCKED` (dueño) | `4cee8a74`: AUTHZ-04 cancelar/rechazar por catálogo + C-1 42501; matriz 796; seis scripts de CP/Staging pasan a cancelar como dueño. Aplicarla en un entorno cambia lo que puede hacer un empleado (también en una caja de Caja Clara): OWNER_APPROVAL_REQUIRED |
| Recuperación de entregas y alertas | `PASS` (local + CI en curso) | `4a4afa79` + `34460beb` (la reversión devolvía mal un permiso: hallado por el ensayo de la cadena). pgTAP 162 + 101; pruebas de alertas en verde también con una tarea programada apagada |
| Certificación del stack | `INCOMPLETE` | Las migraciones aplican en un Supabase real efímero en cada push (runs 37122427290 y 37122606379 verdes; 37123390697 en curso). El certificador `--target stack` sigue sin commit: es el próximo frente |

Verificación local completa sobre el HEAD `a7eb622c` (PG17 + shims): 203/203 migraciones; pgTAP 74/74 archivos, 5.865
aserciones, total consistente (base limpia y base «sucia»); carreras admisión/stock/idempotencia PASS; cadena de 45 reversiones
0 fallidas, 0 diferencias contra una línea base de 158 armada en el momento; mínimo privilegio sobre el esquema viejo PASS;
`npm run check` PASS; 885 tests de Node relevantes PASS. CI completo despachado: run 37123390677.

### Riesgos iniciales

1. Nada de los 5 frentes está integrado: un agente nuevo que lea «cinco validaciones exitosas» puede creer que hay más hecho de lo que hay.
2. Staging no tiene ninguna de las 32 migraciones de la rama: el comportamiento endurecido nunca corrió sobre Staging.
3. La línea Caja Clara (otra sesión) agrega su propia migración a Staging; aplicar primero las de esta rama obliga a seguir el contrato de `docs/ecommerce-hardening/staging-coexistence.md`.
4. La PC se apaga ~13:27: todo lo que valga tiene que estar commiteado y pusheado antes.
5. Memoria y CPU acotadas: como máximo 2–3 procesos pesados a la vez, sin gates de fondo de larga vida.

## Bitácora

- 08:40 — checkpoint inicial; preflight de sólo lectura en Staging y CP (21/21, integridad 0). Push `591e06d0` (incluye `47d9ffe9`).
- 08:38–08:50 — verificación local (PG17 + shims, NO es un stack de Supabase) de los cuatro paquetes SQL juntos sobre el repo
  (wp11 + wp13 + wp18 + wp19, 202 migraciones):
  - pgTAP: 72/73 archivos, 5.831 aserciones planificadas. Única falla: `order_cancellation_panel_and_tracking_test.sql` (nuevo de
    wp13) hace cancelar a un empleado, y wp19 (decisión del dueño AUTHZ-04) exige `orders.cancel`, que el empleado no tiene →
    conflicto entre paquetes, se adapta el fixture al integrar.
  - Carreras en el orden del gate: admisión PASS (4), stock PASS (12, 0 deadlocks; con la copia de wp19 del arnés, que cancela
    con un encargado en vez de un empleado), idempotencia **`GLOBAL_IDEMPOTENCY: PASS`** (758 llamadas, 0 deadlocks, 0 esperas
    agotadas).
  - Prueba discriminante: el mismo arnés sobre el repo SIN los paquetes da **`GLOBAL_IDEMPOTENCY: FAIL`, 7 defectos, 14
    deadlocks** (incluye la respuesta del proveedor y el aviso de pago cortados por 40P01 en la cancelación de pagos).
    Evidencia: `artifacts/taba-autonomous-20261003/races/{all,base}-*.txt`.
  - Tests unitarios del certificador y del arnés: 34/35 (la falla es la esperada: el arnés todavía no está cableado al gate).
- 08:42 — 4 revisores adversariales en paralelo (sólo lectura), uno por paquete. Sus informes: scratchpad de la sesión `review/`.
- 08:51 — compuerta de release en sólo lectura contra CP (`la-taba-cp`): **NOT_READY**, 9 bloqueos (catálogo 0/1, horarios,
  modo de entrega, equipo, decisión de cobro, 33 migraciones sin aplicar, 9 Edge Functions de Mercado Pago más viejas que el código,
  guardián de admisión ausente, CI) + gate externo EDGE-03. `artifacts/taba-autonomous-20261003/release-gates-cp-0851.*`.
- 08:52 — conciliación de sólo lectura contra Mercado Pago TEST en Staging (35 días): 31/32 conciliados y **1 CRÍTICO**: pago
  `179851082485` aprobado y acreditado en el proveedor (1800 ARS, 2026-09-25 17:04Z), intent `e5dbaf33…` «expired», sin pedido.
- 08:58 — **NUEVO P1 (PAY-PROBE-01), reproducido con datos vivos de Staging**: el barrido de verdad del proveedor corrió 8 veces
  (17:03–17:32Z) y las 8 respuestas fueron «vacío» (`payment.provider_probe_empty`), pero la misma búsqueda por
  `external_reference` con la credencial del vendedor devuelve el pago (GET de sólo lectura, total=1, aprobado, el dueño del token es
  el cobrador). La preferencia se creó con la generación de conexión `fd242d91…`; la conexión se re-enlazó a las 17:43Z
  (`6963ca5b…`). Después de 8 vacíos el barrido deja de preguntar, y la alerta `CHECKOUT_PROVIDER_UNVERIFIED` excluye
  explícitamente todo checkout con un sondeo vacío → **cobro sin pedido, sin alerta y sin más sondeos: invisible** salvo para la
  conciliación manual. Precondiciones: el aviso del proveedor no se procesó, el comprador no volvió, y la búsqueda vino vacía por
  algo que no es «no hubo pago» (credencial/conexión cambiada). Arreglo previsto (después de integrar wp11, que redefine la misma
  función de alertas): sondeos tardíos dentro de las 48 h y vacíos no concluyentes cuando la generación del vendedor cambió.
- Hallazgo a decidir: wp19 también exige `orders.cancel` para **rechazar**, y su propio encabezado avisa que la caja de **Caja
  Clara** opera con la sesión del cajero (si es empleado, deja de poder cancelar/rechazar) y que el Panel le sigue mostrando
  «Cancelar» a todo el equipo. AUTHZ-04 además nombra `authorize_arca_homologation` y `set_business_open_state`, que wp19 no toca.
- 09:00–09:15 — revisiones adversariales (sólo lectura): wp18 APROBADO con notas; wp11 APROBADO con notas; wp13 BLOCK sólo por
  empaquetado (no borrar `mercadopago_checkout_pro.local.sql`, actor del test, guardas de reversión); wp19 BLOCK sólo por guardas
  de reversión. Todo lo pedido quedó resuelto antes de integrar. Informes: scratchpad de la sesión `review/`.
- 09:20–09:35 — integrados y pusheados: `3007ed39` (wp18), `cf0d30fb` (wp13), `4a4afa79` (wp11), `4cee8a74` (wp19),
  `5c578793` (PAY-PROBE-01), `34460beb` (permiso en una reversión), `a7eb622c` (guarda de host de los arneses: `?host=` pisaba
  la URL local), `c5454a0c` (registro, verificación previa de la segunda tanda, plan de promoción corregido, convivencia).
- 09:28 — verificación previa nueva (`20261002_ecommerce_hardening_preflight.sql`) en Staging y CP: 12/12 sin error. En CP sólo
  hay empleados en comercios de QA (40 cancelaciones de `qa-cleanup.mjs` como empleado, ya cambiadas a dueño). En Staging el
  comercio de la línea Caja Clara canceló 24 pedidos como empleado: 20261002050000 NO se aplica en Staging sin acordarlo.
- Plan de promoción: decía que el cobro real lo abría `MERCADOPAGO_REAL_MONEY_ENABLED`, que no existe en el código; corregido. La
  llave real es el secreto smoke, y en CP no está (leído: sólo nombres de secretos).
- 09:40–10:02 — 5º frente: certificador e-commerce commiteado (`60a7f6ed`) y corriendo contra el Supabase efímero de CI.
  Corrida 1 (37123682507): el diagnóstico del workflow fallaba por un cast (`cd7a9e94`). Corrida 2 (37123838754): el preflight
  paraba porque el gateway del stack local no exige la clave del proyecto → «no probado en este destino» (`511dc88b`).
  **Corrida 3 (37124096351): 455 checks, 448 PASS, 3 FAIL, 4 no probados; las 24 fases corrieron sobre GoTrue, PostgREST,
  pg_cron y Edge reales.** FAIL reales: 55000 de negocio y P0002 de pedido inexistente salen como HTTP 500 (API-01/C-2,
  contrato HTTP abierto). El tercero era la misma diferencia de gateway (ajustado en `34f244a9`, sólo si no se filtró nada).
  Corrida 4 (37124837704) en curso.
- 09:45–10:00 — dos P2 de concurrencia más, reproducidos con las sondas de wp18 y corregidos:
  IDEM-08 (`c997a18c`): la marca de envío dudoso de la preferencia toma el cobro antes que el intento (X1/X2: 40P01 → sin
  deadlock). IDEM-07 (`e7287f53`, permisos corregidos en el commit siguiente): rechazar o retirar una oferta de reparto toma el pedido antes que la oferta (P4/P5:
  40P01 → las 7 sondas sin deadlock). El ensayo de la cadena de reversiones detectó que 062000 le sacaba el EXECUTE a
  service_role (que Staging y CP tienen): corregido; cadena 47/47, 0 diferencias.
- CI real sobre `a7eb622c` (run 37123390677): job de base de datos VERDE (migraciones como no-superusuario, pgTAP, carreras
  incluida la de idempotencia, restauración aislada) y Windows VERDE; el job web seguía corriendo.
- EDGE-03 (interruptor permanente del cobro real, opción A decidida por el dueño): un agente lo implementa en el worktree
  aislado `la-taba-real-money-gate` (rama `feat/taba-real-money-gate`, sin push); se integra sólo después de revisarlo.
  Verificado para su compuerta de release: la Management API devuelve por secreto `{name, value, updated_at}` con `value` =
  SHA-256 del valor, así que se puede saber si vale `enabled` sin ver nunca el secreto.
