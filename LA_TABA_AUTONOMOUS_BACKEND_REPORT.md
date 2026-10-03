# LA TABA — Informe del operador autónomo de backend (2026-10-03)

Sesión no supervisada, 08:22–13:2x (-03:00), en el worktree `la-taba-ecommerce-hardening`, rama
`hardening/taba-ecommerce-production` (apilada sobre el PR #130). Producción (CONTROLLED PRODUCTION) sólo en lectura;
ningún cobro, reembolso ni dinero real; nada aplicado en Staging ni en CP. Bitácora detallada: `LA_TABA_AUTONOMOUS_STATUS.md`.
Evidencia: `artifacts/taba-autonomous-20261003/`.

## Estado

| | |
|---|---|
| HEAD_INICIAL | `47d9ffe9` (local, sin push) · `origin` `423cd90d` |
| HEAD_FINAL | _se completa al cierre_ |
| RAMA | `hardening/taba-ecommerce-production` |
| WORKTREE | `la-taba-ecommerce-hardening`. Propios además: `la-taba-real-money-gate` (EDGE-03, ya integrado: se puede borrar) y `la-taba-http-contract` (API-01/C-2, en curso, sin integrar) |
| COMMITS | _ver lista al final_ |
| PUSH | todo pusheado a `origin/hardening/taba-ecommerce-production` |
| PR | ninguno nuevo (la rama sigue apilada sobre #130, que está abierto; abrir el PR es decisión del dueño) |
| CI | _se completa al cierre_ |

## QA

| | |
|---|---|
| TESTS_EJECUTADOS | Local (PG17 + shims): pgTAP canónico **77 archivos / 5.896 aserciones** en base limpia y en base «sucia»; carreras de admisión, stock e idempotencia en el orden del gate; cadena de **48 reversiones** contra una línea base de 158 armada en el momento; mínimo privilegio sobre el esquema viejo; pruebas de alertas con una tarea programada apagada; sondas de deadlock con llegada fijada (repro-4, repro-5). Node: 881 tests del área + `test:payments` 228 + compuertas/interruptor 150; Deno 52 + 452; `npm run check`. Sólo lectura: preflight en Staging y CP (21 + 12 consultas), compuerta de release contra CP, conciliación contra Mercado Pago TEST en Staging. CI real: `Validate release candidate` completo y certificador e-commerce en un Supabase efímero (206 migraciones) |
| PASS | todo lo anterior, salvo lo que dice FAIL |
| FAIL | 2 checks del certificador en el stack: `inventory:LAST_UNIT_LOSER_GETS_A_CLEAN_REFUSAL` y `cancellation:ORDER_NOT_FOUND_IS_ANSWERED_AS_A_CLIENT_ERROR` (HTTP 500 en 55000/P0002 = API-01/C-2, defecto abierto) |
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
| RECOVERY | `PASS` local | ensayo de fallas (sesión anterior, 22/22) + entrega en curso con salida (`4a4afa79`) + cadena de reversiones 48/48 con 0 diferencias (tras corregir dos permisos, `34460beb` y `59a8e5ca`) + ACK perdido 11/11 en el stack |
| ALERTAS | `PASS` | `4a4afa79`: tareas faltantes/apagadas, cola trabada sin intent, reembolsos y cobros para revisar; y `5c578793`: el checkout sin verificar ya no queda mudo |
| MIGRACIONES | `PASS` local y en stack real · aplicación `OWNER_APPROVAL_REQUIRED` | 206/206 en PG17, en el job de base de datos del CI (como no-superusuario) y en el Supabase efímero; verificación previa de sólo lectura en Staging y CP (dos archivos); ninguna de las 48 migraciones de la rama está aplicada en Staging (158) ni en CP (157) |
| OBSERVABILIDAD | `PASS` con pendientes | traza de pedido sin datos personales, salud por componente, alertas nuevas; DIAG-02 parcial (contador del Panel) |
| SEGURIDAD | `PASS` con pendientes | guarda de host de los arneses (`?host=` pisaba la URL local, `a7eb622c`); el cobro real en CP falla cerrado (no tiene el secreto viejo ni el interruptor nuevo); el interruptor nuevo exige el valor exacto `enabled`; AUTHZ-04 parcial (`set_business_open_state`, `authorize_arca_homologation`) |
| STACK | `PASS` salvo el contrato HTTP | Certificador e-commerce contra un Supabase completo y efímero en CI (GoTrue, PostgREST, pg_cron y Edge reales; 206 migraciones): **455 checks, 448 PASS, 2 FAIL, 5 no probados**, estable en 4 corridas (37124096351, 37124837704, 37125278937, 37127204266 — la última ya con el interruptor del cobro real). Los 2 FAIL = API-01/C-2. Pagos 12/12, ACK perdido 11/11, idempotencia 27/27, RLS 19/19, AUTHZ-04 en vivo (empleado → 42501). No probados (motivo escrito): gateway local sin clave ×2, sin Cloudflare delante, firma de webhook (las funciones de pago se niegan antes por no ser un despliegue alojado), umbrales de rendimiento sin versionar. Evidencia: `artifacts/taba-autonomous-20261003/stack-certification-run-37125278937/` |

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
| STAGING | sin cambios hechos por esta sesión (sólo lecturas). Ledger 158; le faltan las 48 migraciones de la rama. Hallazgo de datos: el pago TEST `179851082485` está aprobado en Mercado Pago y su intent «expired» sin pedido (no es dinero real) |
| CONTROLLED_PRODUCTION | sin cambios (sólo lecturas). Compuerta de release (08:51): NOT_READY (9 bloqueos: insumos del comercio, migraciones, Edge Functions viejas, guardián ausente, CI). El cobro real falla cerrado: no está `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` (llave de las funciones desplegadas hoy) ni `MERCADOPAGO_REAL_MONEY_ENABLED` (llave de las de esta rama) |
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
- Entregas: salida para una entrega en curso con código perdido o repartidor dado de baja (OSM-04); alertas de tareas, colas,
  reembolsos y cobros (DIAG-05, parte de DIAG-02) — `4a4afa79`.
- Autorización: cancelar/rechazar por catálogo (AUTHZ-04, parcial) y negativas 42501 (C-1) — `4cee8a74`.
- Más PAY-PROBE-01, IDEM-07, IDEM-08, TRACK-01, RB-01, RB-02, TOOL-08, FO-01, FO-02 (tabla de arriba).
- **EDGE-03 (P1): interruptor permanente del cobro real** (opción A del dueño): `6e7af1d4`, `297130a7`, `cb7f60f2`, `d4e5fa13` — sólo `MERCADOPAGO_REAL_MONEY_ENABLED=enabled` exacto abre, junto con la revisión aprobada y el vendedor conectado; la compuerta de release `REAL_MONEY_GATE` lo verifica por huella SHA-256 sin ver el valor. Implementado por un agente en un worktree aislado y revisado por mí antes de integrar. **No desplegado.**
- Registro: **P1 14 corregidos, 0 abiertos, 0 gates externos**, 1 riesgo aceptado (TOOL-01: sin Docker local, lo cubre el
  CI); P2 34 corregidos, 24 abiertos (`docs/ecommerce-hardening/findings-register.json`).

### BUGS_PENDIENTES

| Id | Sev. | Qué | Por qué no se hizo hoy |
|---|---|---|---|
| API-01 / C-2 | P2 | Una negativa de negocio (55000) o un «no existe» (P0002) salen como **HTTP 500**; el Panel los trata como reintentables. **Confirmado en el stack real** (los 2 FAIL del certificador) | decisión del dueño ya tomada (cerrar el contrato en el servidor); el arreglo regenera ~100 funciones de entrada: un agente lo está implementando en el worktree aislado `la-taba-http-contract` (rama `feat/taba-http-contract`, sin push; notas en `docs/ecommerce-hardening/http-contract-NOTES.md` de ese worktree) para que la próxima sesión lo verifique e integre |
| AUTHZ-04 (resto) | P2 | `set_business_open_state` (el empleado abre y pausa) y `authorize_arca_homologation` (el encargado autoriza) no siguen el catálogo | decisión del dueño |
| PAY-06 (resto) | P2 | Nada vuelve a leer en el proveedor los cobros completados; un `cancellation_reconcile` muerto no tiene salida propia | decisión del dueño (ventana, frecuencia, límites del proveedor) |
| DIAG-02 (resto) | P2 | El contador de colas trabadas del Panel ignora los trabajos de webhook; los códigos nuevos de alerta se muestran con texto genérico | frontend |
| EDGE-15 | P3 | Si también falla `mark_payment_cancellation_ambiguous` (tres fallas seguidas de la base), la cancelación queda «requested» sin trabajo | residual documentado |
| SCRIPTS | P3 | `deploy/run-commercial-pilot-e2e.mjs` cancela con la credencial `PILOT BUSINESS QA` (otro entorno; su rol no se pudo confirmar en sólo lectura). Los otros 4 scripts piloto de Staging usan `STAGING BUSINESS QA 20260920`, que es **encargado** de `la-taba-staging` (leído): AUTHZ-04 no los afecta | ver su rol antes de aplicar 20261002050000 donde ese script corra |
| Resto | P2 | 24 P2 abiertos del registro (decisiones de producto, canal externo, frontend, otra línea) | ver el registro |

### RIESGOS_RESIDUALES

1. **Nada de la rama corrió todavía sobre Staging ni CP** (ledgers 158 y 157; la rama tiene 206): la evidencia es PG17 local,
   el CI real (DB) y un Supabase efímero en CI — no un proyecto alojado.
2. El contrato HTTP (API-01/C-2) hace que clientes reintenten negativas finales (HTTP 500).
3. Mercado Pago real nunca se ejercitó (sin dinero real por regla); la integración de pagos está probada contra un proveedor
   simulado, Mercado Pago TEST en lectura y el stack efímero (las funciones de pago se niegan solas sin credenciales).
4. En Staging hay un cobro TEST aprobado sin pedido (`179851082485`, 1800 ARS de prueba): alguien tiene que reembolsarlo o
   recuperarlo.
5. AUTHZ-04, al aplicarse, cambia lo que puede hacer un empleado en el Panel y en una caja de Caja Clara.
6. El worktree principal y otros 6 worktrees tienen cambios sin commit de otras sesiones: no se tocaron.

## Owner

`OWNER_APPROVAL_REQUIRED` — cada ítem con el paso exacto. Ninguno se ejecutó.

1. **Aplicar la rama en Staging** (206 migraciones + las 9 Edge Functions de Mercado Pago).
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
6. **Contrato HTTP (API-01/C-2)**: que una sesión verifique e integre el paquete en curso del worktree `la-taba-http-contract`
   (el mecanismo está probado sobre PostgREST 14.5; regenera ~100 funciones de entrada).
7. **PAY-06**: política para volver a leer cobros completados (ventana y frecuencia).
8. **Staging**: reembolsar en el panel TEST de Mercado Pago (o recuperar) el pago `179851082485`.
9. **Comercio real de CP**: catálogo, horarios, modo de entrega, equipo, vendedor de Mercado Pago y decisión de cobro (los 5
   bloqueos de negocio de la compuerta de release).

## Resultado

**READY_FOR_CONTROLLED_PRODUCTION: `BLOCKED`**

- Lo que hay: CI completo verde (runs 37123390677 y 37125497727; el final se completa abajo), pgTAP canónico 77 archivos /
  5.896 aserciones, carreras sin deadlocks, cadena de 48 reversiones sin diferencias, certificador 448/455 en un Supabase real
  efímero, **0 P0 y 0 P1 abiertos**, migraciones verificadas en sólo lectura contra Staging y CP.
- Lo que bloquea: la regla «no hay PASS sin el build desplegado» exige certificar ESTE build en Staging, y aplicarlo en Staging
  es una decisión del dueño (Owner 1 y 2: convivencia con la línea Caja Clara por AUTHZ-04). Además queda abierto el contrato
  HTTP (API-01/C-2, P2: negativas finales como HTTP 500). Con el punto 1 de Owner hecho y la certificación de Staging verde
  sobre el mismo commit, el siguiente paso sería el plan de promoción (sin dinero real).

**READY_FOR_REAL_MONEY: `NO`**

- El interruptor del cobro real existe en el código (EDGE-03) pero no está desplegado; Mercado Pago real nunca se ejercitó
  (regla de la sesión); no hay vendedor real conectado ni decisión de apertura con Mercado Pago; el comercio real de CP no tiene
  catálogo público, horarios, modo de entrega ni equipo; la rama nunca corrió sobre un proyecto alojado; el contrato HTTP sigue
  abierto. Hoy CP falla cerrado.

**Próximo paso recomendado (en orden):** (1) Marco decide Owner 1–2 (aplicar en Staging y AUTHZ-04); (2) una sesión verifica e
integra `feat/taba-http-contract` (contrato HTTP) y vuelve a correr el certificador en el stack hasta 455/455 sin FAIL;
(3) aplicar en Staging con el procedimiento de Owner 1 y certificar; (4) promoción a CP según el plan; (5) recién después,
Owner 4 (dinero real).
