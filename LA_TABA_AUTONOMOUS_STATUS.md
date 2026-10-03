# LA TABA — estado del operador autónomo de backend

Archivo vivo: se reescribe después de cada frente. Sin secretos. Fuente de verdad: código + git + tests + CI + lecturas en vivo
de sólo lectura. Lo que dice una sesión anterior se cita como «declarado» hasta verificarlo.

## Checkpoint inicial — 2026-10-03 08:40 (-03:00)

| Dato | Valor verificado |
|---|---|
| Worktree | `C:\Users\DELL\Desktop\la-taba\la-taba-ecommerce-hardening` (repo `bitflowapp/la-taba-pages-preview`, público) |
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
