# LA TABA — Informe del operador autónomo de backend (2026-10-03)

Sesión no supervisada, 08:22–13:2x (-03:00), en el worktree `la-taba-ecommerce-hardening`, rama
`hardening/taba-ecommerce-production` (apilada sobre el PR #130). Producción (CONTROLLED PRODUCTION) sólo en lectura;
ningún cobro, reembolso ni dinero real; nada aplicado en Staging ni en CP. Bitácora detallada: `LA_TABA_AUTONOMOUS_STATUS.md`.
Evidencia: `artifacts/taba-autonomous-20261003/`.

## Estado

| | |
|---|---|
| HEAD_INICIAL | `47d9ffe9` (local, sin push) · `origin` `423cd90d` |
| HEAD_FINAL | `59fa86b8` (último commit de código y de CI) + el commit de cierre de este informe |
| RAMA | `hardening/taba-ecommerce-production` |
| WORKTREE | `la-taba-ecommerce-hardening`. Propios además, los dos ya integrados (se pueden borrar): `la-taba-real-money-gate` (EDGE-03) y `la-taba-http-contract` (API-01/C-2) |
| COMMITS | 60 (lista al final; `47d9ffe9` lo dejó la sesión anterior sin push y lo pusheó esta) |
| PUSH | todo pusheado a `origin/hardening/taba-ecommerce-production` |
| PR | ninguno nuevo (la rama sigue apilada sobre #130, que está abierto; abrir el PR es decisión del dueño) |
| CI | Completos verdes: 37123390677 (`a7eb622c`) y 37125497727 (`011717fa`). Stack: 37129059684 (`2bc7218a`) verde, 450/455, 0 FAIL. Run 37129892043 sobre `59fa86b8`: base de datos y Windows en verde, **job web en FAIL por mi evidencia** (`release-gates-cp-1125.*` nombra el interruptor dentro de `artifacts/`, fuera de los lugares que permitía `tests/mercadopago-real-money-switch.test.mjs`, que ahora acepta la evidencia de sólo lectura). **CI re-despachado sobre el commit que lo corrige: verificar su resultado** (la corrida de `1470b3ff` tenía base de datos y Windows en verde; su job web lo canceló el despacho final) |

## QA

| | |
|---|---|
| TESTS_EJECUTADOS | Local (PG17 + shims, 208 migraciones): pgTAP canónico **78 archivos / 5.938 aserciones** en base limpia y en base «sucia»; carreras de admisión, stock e idempotencia en el orden del gate; cadena de **50 reversiones** contra una línea base de 158 armada en el momento; mínimo privilegio sobre el esquema viejo; conversión de la frontera de la API como la ve PostgREST (`scripts/db/check-api-boundary.mjs`, 11/11); pruebas de alertas con una tarea programada apagada; sondas de deadlock con llegada fijada (repro-4, repro-5). Node: 985 tests del área (migraciones, runner, certificador, registro, contrato HTTP, interruptor) + `test:payments` 228 + compuertas/interruptor 150; Deno 52 + 452; `npm run check`. Sólo lectura: preflight en Staging y CP (21 + 12 consultas), compuerta de release contra CP, conciliación contra Mercado Pago TEST en Staging. CI real: `Validate release candidate` completo y certificador e-commerce en un Supabase efímero |
| PASS | todo lo anterior, salvo lo que dice FAIL |
| FAIL | ninguno en el estado final. Las corridas del stack anteriores al contrato HTTP tenían 2 FAIL reales (`inventory:LAST_UNIT_LOSER_GETS_A_CLEAN_REFUSAL` y `cancellation:ORDER_NOT_FOUND_IS_ANSWERED_AS_A_CLIENT_ERROR`, HTTP 500 en 55000/P0002 = API-01/C-2); con `2bc7218a` los dos pasan (409 y 404 con el mismo cuerpo) |
| SKIPPED | la suite completa `npm test` y el E2E de navegador corren en CI (no local, 25 min en esta máquina) |
| FLAKY | ninguno observado. Nota: el gate DIRTY de los agentes anteriores había muerto con 55P03 por carga de la máquina; hoy, con la máquina libre, las tres carreras corrieron con 0 esperas agotadas |

## Auditoría

| Área | Resultado | Evidencia |
|---|---|---|
| IDEMPOTENCIA | `PASS` | `3007ed39`. La carrera de idempotencia (758 llamadas concurrentes) pasó de FAIL (7 defectos, 14 deadlocks, incluida la respuesta del proveedor cortada por 40P01 en la cancelación de pagos) a PASS con 0 deadlocks; queda en el gate de CI |
| PAGOS | `PASS` hasta el límite posible sin dinero real | `cf0d30fb` (reembolsos: lo que ofrece el Panel = lo que acepta el servidor; devolución del proveedor libera stock una vez; un aviso firmado = un recibo; reanimar trabajos de lectura) y `5c578793` (**P1 nuevo PAY-PROBE-01**). Revisión adversarial: sin doble cobro/reembolso ni reembolso por encima de lo cobrado. **EDGE-03 integrado** (interruptor permanente del cobro real, `6e7af1d4`…`d4e5fa13`; no desplegado). En el stack real: pagos 12/12 y ACK perdido 11/11 |
| AUTORIZACIÓN | `PASS` en código · aplicación `BLOCKED` (dueño) | `4cee8a74`: cancelar/rechazar por catálogo (AUTHZ-04) + negativas 42501 (C-1); matriz de 796 celdas. Aplicarla cambia lo que puede hacer un empleado (también en una caja de Caja Clara) |
| PEDIDOS | `PASS` | stock: 12 escenarios de carrera sin sobreventa ni stock negativo; cancelaciones concurrentes devuelven stock una vez; pgTAP de invariantes (377) |
| WEBHOOKS | `PASS` | aviso duplicado x20 → 1 recibo, 1 trabajo; firmado y sin firma → 1; entrega firmada repetida con otro cuerpo → 1 recibo (`20261002022000`) |
| RECOVERY | `PASS` local | ensayo de fallas (sesión anterior, 22/22) + entrega en curso con salida (`4a4afa79`) + cadena de reversiones 50/50 con 0 diferencias (tras corregir dos permisos, `34460beb` y `59a8e5ca`) + ACK perdido 11/11 en el stack |
| ALERTAS | `PASS` | `4a4afa79`: tareas faltantes/apagadas, cola trabada sin intent, reembolsos y cobros para revisar; y `5c578793`: el checkout sin verificar ya no queda mudo |
| MIGRACIONES | `PASS` local y en stack real · aplicación `OWNER_APPROVAL_REQUIRED` | 208/208 en PG17, en el job de base de datos del CI (como no-superusuario) y en el Supabase efímero; verificación previa de sólo lectura en Staging y CP (dos archivos); ninguna de las 50 migraciones de la rama está aplicada en Staging (158) ni en CP (157). Las dos del contrato HTTP se niegan (`ROLLOUT_BLOCKED`) si una función que envuelven cambió fuera de la rama |
| OBSERVABILIDAD | `PASS` con pendientes | traza de pedido sin datos personales, salud por componente, alertas nuevas; DIAG-02 parcial (contador del Panel) |
| SEGURIDAD | `PASS` con pendientes | guarda de host de los arneses (`?host=` pisaba la URL local, `a7eb622c`); el cobro real en CP falla cerrado (no tiene el secreto viejo ni el interruptor nuevo); el interruptor nuevo exige el valor exacto `enabled`; AUTHZ-04 parcial (`set_business_open_state`, `authorize_arca_homologation`) |
| STACK | `PASS` | Certificador e-commerce contra un Supabase completo y efímero en CI (GoTrue, PostgREST, pg_cron y Edge reales). **Corrida final 37129059684 sobre `2bc7218a` (208 migraciones): 455 checks, 450 PASS, 0 FAIL, 5 no probados.** Antes del contrato HTTP: 448 PASS y 2 FAIL (API-01/C-2), estable en 4 corridas (37124096351, 37124837704, 37125278937, 37127204266). Pagos 12/12, ACK perdido 11/11, idempotencia 27/27, RLS 19/19, AUTHZ-04 en vivo (empleado → 42501), negativa 55000 → 409 y «no existe» → 404 por PostgREST real. Las 208 migraciones aplicaron sin que la guarda `ROLLOUT_BLOCKED` frenara nada. No probados (motivo escrito): gateway local sin clave ×2, sin Cloudflare delante, firma de webhook (las funciones de pago se niegan antes por no ser un despliegue alojado), umbrales de rendimiento sin versionar. Evidencia: `artifacts/taba-autonomous-20261003/stack-certification-run-37129059684/` (y la de 37125278937) |

### Rendimiento medido en el stack efímero (informativo, runner de CI de 2 vCPU con todo el stack)

1.680 pedidos, **0 errores**, conservación de stock exacta después de cada escalón. p95 en ms:

| Operación | base | c10 | c30 | c100 |
|---|---:|---:|---:|---:|
| catalog_read | 14.7 | 22.2 | 67.2 | 153.7 |
| order_creation_cash | 39 | 134 | 175.3 | 604.1 |
| order_query (historial del cliente) | 13.6 | 106 | 425 | 1677.2 |
| tracking_query | 2.7 | 10.6 | 19.3 | 59.9 |
| panel_query (bandeja del Panel) | 10.5 | 124.6 | 654.7 | 2897.8 |
| checkout_creation | 15 | 125.3 | 156.3 | 770.9 |
| payment_intent | 5.9 | 17.2 | 98.4 | 465.7 |
| stock_commit_paid | 11.1 | 52.7 | 98.2 | 382.2 |

La bandeja del Panel y el historial del cliente son los que más se degradan con concurrencia. Los umbrales no se versionaron:
entre corridas la propuesta varía hasta ~60 % (con un caso que llega al timeout de 8 s a c100), y una compuerta así sería inestable.

## Entornos

| | |
|---|---|
| STAGING | sin cambios hechos por esta sesión (sólo lecturas). Ledger 158; le faltan las 50 migraciones de la rama. Hallazgo de datos: el pago TEST `179851082485` está aprobado en Mercado Pago y su intent «expired» sin pedido (no es dinero real) |
| CONTROLLED_PRODUCTION | sin cambios (sólo lecturas). Compuerta de release (08:51): NOT_READY (9 bloqueos: insumos del comercio, migraciones, Edge Functions viejas, guardián ausente, CI). Repetida a las 11:25 con la compuerta nueva del dinero real: NOT_READY, **`MONEY_MOVEMENT_POSSIBLE: NO`** (`REAL_MONEY_SWITCH_ABSENT`, `NO_BUSINESS_CAN_CHARGE_IN_PRODUCTION`; ningún comercio con Mercado Pago productivo ni vendedor conectado), P0/P1 en PASS, le faltan 51 migraciones (las 50 de la rama + `20261001010000`). El cobro real falla cerrado: no está `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` (llave de las funciones desplegadas hoy) ni `MERCADOPAGO_REAL_MONEY_ENABLED` (llave de las de esta rama). Verificación previa repetida a las 11:20 en los dos entornos: sin cambios desde las 09:28 (integridad de dinero, colas y tareas en 0; ledgers 158 y 157). Evidencia: `release-gates-cp-1125.*`, `preflight2-*-1120.json` |
| PRODUCTION_READ_ONLY | todas las lecturas por el endpoint de sólo lectura de la Management API (rol `supabase_read_only_user`, transacción de sólo lectura) o por listados de nombres de secretos |

## Hallazgos

### BUGS_ENCONTRADOS (por esta sesión, con evidencia)

| Id | Sev. | Qué | Evidencia | Estado |
|---|---|---|---|---|
| PAY-PROBE-01 | **P1** | Un «vacío» de la búsqueda en Mercado Pago se tomaba como prueba de que el comprador no pagó: tras 8 vacíos en 30 min el barrido dejaba de preguntar y la alerta `CHECKOUT_PROVIDER_UNVERIFIED` callaba → cobro sin pedido, sin alerta, invisible | **Datos vivos de Staging** (sólo lectura): pago TEST `179851082485` aprobado y acreditado; 8 sondas vacías 17:03–17:32Z; la misma búsqueda hoy lo devuelve; la conexión del vendedor se re-enlazó 17:43Z | corregido `5c578793` (34 aserciones; reversión ensayada) |
| IDEM-08 | P2 | La marca de «envío dudoso» de la preferencia tomaba intento → cobro: 40P01 contra volver a pedir/asentar la preferencia (en un caso Postgres cortaba la marca después de que la preferencia existía en el proveedor) | sondas con llegada fijada X1/X2: 40P01 → sin deadlock | corregido `c997a18c` |
| IDEM-07 | P2 | Rechazar/retirar una oferta de reparto tomaba oferta → pedido: 40P01 contra ofrecer el pedido a otro repartidor | sondas P4/P5: 40P01 → las 7 sondas sin deadlock | corregido `e7287f53` + `59a8e5ca` |
| TRACK-01 | P2 | Tras recuperar el seguimiento de un pedido de Mercado Pago con entrega, la pantalla de estado del pago fallaba entera (39000) | reproducido en el flujo real; sin el arreglo la prueba termina en «Wrong key or corrupt data» | corregido `f02e55b2` (hallado por el agente de wp11, confirmado por su revisor) |
| RB-01 | P2 | La reversión de 20261002010000 no devolvía el EXECUTE que `service_role` tiene sobre un disparador | ensayo de la cadena completa de reversiones (1 diferencia); Staging/CP tienen `{postgres, service_role}` | corregido `34460beb` |
| RB-02 | P2 | Mi propia primera versión de 20261002062000 le habría sacado a `service_role` el EXECUTE que tiene en Staging/CP | ensayo de la cadena (2 diferencias) — **antes de llegar a ningún entorno** | corregido `59a8e5ca` |
| TOOL-08 | P3 | Los arneses de carrera (que escriben fixtures) aceptaban `?host=` en la URL, que pisa el host «local» del cliente de pg | la versión anterior seguía intentando conectar a 203.0.113.7 a los 12 s | corregido `a7eb622c` (+12 pruebas) |
| DOC-01 | P1 (doc) | El plan de promoción decía que el cobro real lo abría `MERCADOPAGO_REAL_MONEY_ENABLED` (que en ese momento no existía en el código) y llamaba «error de configuración» al secreto que era la única llave | lectura del código y de los nombres de secretos de CP | corregido `c5454a0c` |
| FO-01 | P1 | Con la compuerta de creación cerrada, `mercadopago-create-preference` con `new_attempt` re-reservaba el stock de una sesión vencida **antes** de evaluar la compuerta | hallado al implementar EDGE-03 (agente, revisado por mí) | corregido `6e7af1d4` (la compuerta va primero; 409 sin reservar) |
| FO-02 | P2 | La compuerta comercial `mp:gate:produccion-sin-cobro` pasaba ante cualquier problema de configuración aunque el cobro fuera posible | ídem | corregido `cb7f60f2` (exige dinero real probado cerrado) |
| CI-01 | P3 | El diagnóstico del workflow del stack fallaba por un cast (`text || "char"`) | run 37123682507 | corregido `cd7a9e94` |
| CERT-01 | P3 | El certificador trataba como FAIL que el gateway del stack local no exija la clave (diferencia de plataforma) | runs 37123838754 y 37124096351 | `511dc88b`, `34f244a9`: «no probado en este destino», y sólo si no se filtró ningún dato |
| HYG-01 | P3 | Mi archivo de estado llevaba una ruta de disco local (la compuerta de higiene lo frenó antes del CI) | `npm run check` | corregido `b7cd898b` |

Además, al integrar los cuatro paquetes las revisiones adversariales encontraron y se corrigieron antes de commitear: reversiones
sin guarda contra redefiniciones (wp13, wp19, wp11), un test de wp13 incompatible con AUTHZ-04, el borrado de un fixture que
habría roto `npm test`, y un candado duplicado.

### BUGS_CORREGIDOS (integrados hoy; la mayoría encontrados por la sesión anterior y verificados acá)

- Idempotencia: IDEM-01..06 + archivo de dirección (7 defectos de la carrera) — `3007ed39`.
- Pagos: lo que ofrece el Panel = lo que acepta el servidor (can_refund); devolución del proveedor libera stock una vez; un aviso
  firmado = un recibo; reanimar trabajos de lectura muertos; cancelación que el proveedor contestó ya no queda «requested» —
  `cf0d30fb`.
- **Contrato HTTP (API-01 + C-2, P2)**: `ec818d12`…`d79992cf` + `ed86e3cb`. La frontera de la API contesta **409** a una
  negativa de negocio (55000) y **404** a un «no existe» (P0002), con el mismo cuerpo; antes las dos salían como HTTP 500 y el
  Panel las reintentaba. `20261002090000` envuelve 109 funciones de entrada (sólo convierte cuando la llamada entra por la API y
  es el marco más externo; adentro de la base nada cambia); `20261002091000` les da su SQLSTATE a 46 negativas que salían como
  P0001. Quedan en 500, por dueño, 40 entradas de otras líneas (Caja/POS, fiscal, agente de impresión, cobros heredados) y las
  dos entradas SQL de OAuth. Política: `docs/ecommerce-hardening/http-contract.md`. Implementado por un agente en un worktree
  aislado; verificado por mí antes de integrar (78/78 y 5.938, cadena de 50 reversiones, permisos y metadatos sin cambios,
  conversión 11/11, costo +0,64 ms p50 en la puerta del pedido) y por el certificador en el stack real.
- Entregas: salida para una entrega en curso con código perdido o repartidor dado de baja (OSM-04); alertas de tareas, colas,
  reembolsos y cobros (DIAG-05, parte de DIAG-02) — `4a4afa79`.
- Autorización: cancelar/rechazar por catálogo (AUTHZ-04, parcial) y negativas 42501 (C-1) — `4cee8a74`.
- Más PAY-PROBE-01, IDEM-07, IDEM-08, TRACK-01, RB-01, RB-02, TOOL-08, FO-01, FO-02 (tabla de arriba).
- TOOL-05 (P2, segunda pasada): `npm test` reescribía `.github/workflows/ci.yml` y `supabase/config.toml` en el lugar (con
  restauración en un `finally`: una corrida cortada dejaba el árbol modificado). La guardia acepta `--config`/`--workflow` y la
  prueba usa copias; la regresión compara contenido y fecha de modificación — `94479254`.
- **EDGE-03 (P1): interruptor permanente del cobro real** (opción A del dueño): `6e7af1d4`, `297130a7`, `cb7f60f2`, `d4e5fa13` — sólo `MERCADOPAGO_REAL_MONEY_ENABLED=enabled` exacto abre, junto con la revisión aprobada y el vendedor conectado; la compuerta de release `REAL_MONEY_GATE` lo verifica por huella SHA-256 sin ver el valor. Implementado por un agente en un worktree aislado y revisado por mí antes de integrar. **No desplegado.**
- Registro: **P1 14 corregidos, 0 abiertos, 0 gates externos**, 1 riesgo aceptado (TOOL-01: sin Docker local, lo cubre el
  CI); P2 36 corregidos, 22 abiertos (`docs/ecommerce-hardening/findings-register.json`).

### BUGS_PENDIENTES

| Id | Sev. | Qué | Por qué no se hizo hoy |
|---|---|---|---|
| AUTHZ-04 (resto) | P2 | `set_business_open_state` (el empleado abre y pausa) y `authorize_arca_homologation` (el encargado autoriza) no siguen el catálogo | decisión del dueño |
| PAY-06 (resto) | P2 | Nada vuelve a leer en el proveedor los cobros completados; un `cancellation_reconcile` muerto no tiene salida propia | decisión del dueño (ventana, frecuencia, límites del proveedor) |
| DIAG-02 (resto) | P2 | El contador de colas trabadas del Panel ignora los trabajos de webhook; los códigos nuevos de alerta se muestran con texto genérico | frontend |
| EDGE-15 | P3 | Si también falla `mark_payment_cancellation_ambiguous` (tres fallas seguidas de la base), la cancelación queda «requested» sin trabajo | residual documentado |
| SCRIPTS | P3 | `scripts/deploy/run-commercial-pilot-e2e.mjs` cancela con la credencial `PILOT BUSINESS QA` en un proyecto piloto aislado (el script rechaza Staging, Producción y DEMO). La credencial no guarda un e-mail como usuario, así que su rol no se pudo confirmar sin leer el secreto (no se leyó). Los otros 4 scripts piloto de Staging usan `STAGING BUSINESS QA 20260920`, que es **encargado** de `la-taba-staging` (leído): AUTHZ-04 no los afecta | ver su rol antes de aplicar 20261002050000 donde ese script corra |
| Contrato HTTP (resto) | P3 | Las 40 entradas excluidas por dueño y las dos entradas SQL de OAuth (`mp_consume_oauth`, `mp_claim_refresh`) siguen contestando 500 a un 55000/P0002 | son de otras líneas; lista en `docs/ecommerce-hardening/http-contract.json` |
| Resto | P2 | 22 P2 abiertos del registro (decisiones de producto, canal externo, frontend, otra línea) | ver el registro |

### RIESGOS_RESIDUALES

1. **Nada de la rama corrió todavía sobre Staging ni CP** (ledgers 158 y 157; la rama tiene 208): la evidencia es PG17 local,
   el CI real (DB) y un Supabase efímero en CI — no un proyecto alojado.
2. El contrato HTTP redefine 109 funciones de entrada al aplicarse: si en Staging o CP alguna fue cambiada fuera de la rama, la
   migración se niega (`ROLLOUT_BLOCKED`) y la aplicación se para ahí hasta regenerarla. Es la conducta buscada (no pisa trabajo
   ajeno), pero puede frenar una promoción.
3. Mercado Pago real nunca se ejercitó (sin dinero real por regla); la integración de pagos está probada contra un proveedor
   simulado, Mercado Pago TEST en lectura y el stack efímero (las funciones de pago se niegan solas sin credenciales).
4. En Staging hay un cobro TEST aprobado sin pedido (`179851082485`, 1800 ARS de prueba): alguien tiene que reembolsarlo o
   recuperarlo.
5. AUTHZ-04, al aplicarse, cambia lo que puede hacer un empleado en el Panel y en una caja de Caja Clara.
6. El worktree principal y otros 6 worktrees tienen cambios sin commit de otras sesiones: no se tocaron.

## Owner

`OWNER_APPROVAL_REQUIRED` — cada ítem con el paso exacto. Ninguno se ejecutó.

1. **Aplicar la rama en Staging** (208 migraciones + las 9 Edge Functions de Mercado Pago).
   - Motivo: es la única forma de certificar el build en un proyecto alojado; riesgo: AUTHZ-04 cambia lo que hacen las corridas
     de la línea Caja Clara (su comercio `la-taba-staging` canceló 24 pedidos como empleado) y `abandoned_order_minutes=120` de
     ese comercio empieza a cumplirse (`docs/ecommerce-hardening/staging-coexistence.md`).
   - Pasos: (a) acordar con la línea Caja Clara que sus cancelaciones pasen a dueño/encargado o que el catálogo le dé
     `orders.cancel` al empleado; (b) backup y ensayo de restauración: `node .tmp-scratch/stg-backup.mjs` y `node .tmp-scratch/stg-restore-drill.mjs` (herramientas locales, no versionadas, de la sesión anterior, en el worktree); (c) verificación
     previa: `node scripts/release/run-readonly-checks.mjs --target staging --file docs/migrations/checks/20261001_ecommerce_hardening_preflight.sql`
     y lo mismo con `20261002_…`; (d) en una carpeta aislada con `supabase/config.toml` y `supabase/migrations/` del commit:
     `npx supabase@2.101.0 link --project-ref ucbtjcurawxjwjdvvcvj` → `db push --linked --dry-run` → `db push --linked --include-all`;
     (e) desplegar las 9 funciones `mercadopago-*`; (f) `node scripts/e2e-staging/ecommerce-certification.mjs --target staging --confirm STAGING_MUTATION_OK`
     (tenant propio de QA); (g) repetir la verificación previa y guardar las dos salidas.
2. **Confirmar AUTHZ-04 tal como quedó**: el empleado pierde cancelar y rechazar en el acto (también en una caja de Caja Clara),
   el Panel y la caja siguen mostrando los botones, y el catálogo da permisos por rol y para toda la plataforma. Si se quiere que el
   empleado cancele: una fila `('staff','orders.cancel')` en `identity_role_permissions` (vale para todos los comercios).
3. **Promoción a CONTROLLED PRODUCTION**: plan en `docs/ecommerce-hardening/controlled-production-promotion-plan.md` (escrito,
   no ejecutado). No antes del punto 1 y del CI verde sobre el mismo commit.
4. **Dinero real** (nada de esto se hizo): (a) desplegar en CP las 9 funciones `mercadopago-*` de esta rama (leen el interruptor
   nuevo; la variable vieja de humo tiene que seguir ausente); (b) certificar Mercado Pago en producción; (c) conectar el
   vendedor real; (d) decisión de apertura que incluya Mercado Pago; (e) recién entonces, con autorización escrita:
   `npx supabase@2.101.0 secrets set MERCADOPAGO_REAL_MONEY_ENABLED=enabled --project-ref tkanbadcglszlcyfjvpv` (apagar:
   `secrets unset MERCADOPAGO_REAL_MONEY_ENABLED`; los reembolsos siguen funcionando). Verificar con
   `node scripts/release/ecommerce-release-gates.mjs --target controlled-production --business-id <uuid>` (`REAL_MONEY_GATE`).
   Hoy CP falla cerrado: no tiene ni el interruptor ni el secreto viejo.
5. **Abrir el PR** de `hardening/taba-ecommerce-production` (apilado sobre #130) y decidir el orden de merge.
6. **PAY-06**: política para volver a leer cobros completados (ventana y frecuencia).
7. **Staging**: reembolsar en el panel TEST de Mercado Pago (o recuperar) el pago `179851082485`.
8. **Comercio real de CP**: catálogo, horarios, modo de entrega, equipo, vendedor de Mercado Pago y decisión de cobro (los 5
   bloqueos de negocio de la compuerta de release).

## Resultado

**READY_FOR_CONTROLLED_PRODUCTION: `BLOCKED`**

- Lo que hay: CI completo verde (runs 37123390677 y 37125497727; el final, abajo), pgTAP canónico 78 archivos / 5.938
  aserciones, carreras sin deadlocks, cadena de 50 reversiones sin diferencias, **certificador 450/455 con 0 FAIL en un Supabase
  real efímero** (los 5 restantes, no probables en ese destino y con su motivo), **0 P0 y 0 P1 abiertos**, el contrato HTTP
  cerrado (API-01/C-2), migraciones verificadas en sólo lectura contra Staging y CP.
- Lo que bloquea: la regla «no hay PASS sin el build desplegado» exige certificar ESTE build en Staging, y aplicarlo en Staging
  es una decisión del dueño (Owner 1 y 2: convivencia con la línea Caja Clara por AUTHZ-04). Con el punto 1 de Owner hecho y la
  certificación de Staging verde sobre el mismo commit, el siguiente paso es el plan de promoción (sin dinero real).

**READY_FOR_REAL_MONEY: `NO`**

- El interruptor del cobro real existe en el código (EDGE-03) pero no está desplegado; Mercado Pago real nunca se ejercitó
  (regla de la sesión); no hay vendedor real conectado ni decisión de apertura con Mercado Pago; el comercio real de CP no tiene
  catálogo público, horarios, modo de entrega ni equipo; la rama nunca corrió sobre un proyecto alojado. Hoy CP falla cerrado
  (`MONEY_MOVEMENT_POSSIBLE: NO`, leído a las 11:25).

**Próximo paso recomendado (en orden):** (1) Marco decide Owner 1–2 (aplicar en Staging y AUTHZ-04); (2) aplicar en Staging con
el procedimiento de Owner 1 y certificar (`--target staging`); (3) promoción a CP según el plan; (4) recién después, Owner 4
(dinero real).

## Commits

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
