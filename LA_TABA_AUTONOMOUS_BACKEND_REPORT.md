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
| WORKTREE | `la-taba-ecommerce-hardening` (otro worktree propio: `la-taba-real-money-gate`, rama `feat/taba-real-money-gate`, ver EDGE-03) |
| COMMITS | _ver lista al final_ |
| PUSH | todo pusheado a `origin/hardening/taba-ecommerce-production` |
| PR | ninguno nuevo (la rama sigue apilada sobre #130, que está abierto; abrir el PR es decisión del dueño) |
| CI | _se completa al cierre_ |

## QA

| | |
|---|---|
| TESTS_EJECUTADOS | pgTAP canónico (74 archivos, 5.865 aserciones) en base limpia y en base «sucia»; carreras de admisión, stock e idempotencia en el orden del gate; cadena de 45 reversiones contra línea base de 158; mínimo privilegio sobre el esquema viejo; pruebas de alertas con una tarea programada apagada; Deno de pagos (52 + 387); 885 tests de Node del área (migraciones, runner, scripts de CP/Staging, gates, certificador); `npm run check`; preflight de sólo lectura en Staging y CP (21 + 12 consultas); compuerta de release en sólo lectura contra CP; conciliación de sólo lectura contra Mercado Pago TEST en Staging; stack efímero de Supabase en CI (203 migraciones) |
| PASS | todo lo anterior, salvo lo que dice FAIL |
| FAIL | _se completa al cierre (certificador en el stack)_ |
| SKIPPED | la suite completa `npm test` y el E2E de navegador corren en CI (no local, 25 min en esta máquina) |
| FLAKY | ninguno observado. Nota: el gate DIRTY de los agentes anteriores había muerto con 55P03 por carga de la máquina; hoy, con la máquina libre, las tres carreras corrieron con 0 esperas agotadas |

## Auditoría

| Área | Resultado | Evidencia |
|---|---|---|
| IDEMPOTENCIA | `PASS` | `3007ed39`. La carrera de idempotencia (758 llamadas concurrentes) pasó de FAIL (7 defectos, 14 deadlocks, incluida la respuesta del proveedor cortada por 40P01 en la cancelación de pagos) a PASS con 0 deadlocks; queda en el gate de CI |
| PAGOS | `PASS` hasta el límite posible sin dinero real | `cf0d30fb` (reembolsos: lo que ofrece el Panel = lo que acepta el servidor; devolución del proveedor libera stock una vez; un aviso firmado = un recibo; reanimar trabajos de lectura) y `5c578793` (**P1 nuevo PAY-PROBE-01**). Revisión adversarial: sin doble cobro/reembolso ni reembolso por encima de lo cobrado. EDGE-03 (interruptor permanente del cobro real) sigue abierto: ver Owner |
| AUTORIZACIÓN | `PASS` en código · aplicación `BLOCKED` (dueño) | `4cee8a74`: cancelar/rechazar por catálogo (AUTHZ-04) + negativas 42501 (C-1); matriz de 796 celdas. Aplicarla cambia lo que puede hacer un empleado (también en una caja de Caja Clara) |
| PEDIDOS | `PASS` | stock: 12 escenarios de carrera sin sobreventa ni stock negativo; cancelaciones concurrentes devuelven stock una vez; pgTAP de invariantes (377) |
| WEBHOOKS | `PASS` | aviso duplicado x20 → 1 recibo, 1 trabajo; firmado y sin firma → 1; entrega firmada repetida con otro cuerpo → 1 recibo (`20261002022000`) |
| RECOVERY | `PASS` local | ensayo de fallas (sesión anterior, 22/22) + entrega en curso con salida (`4a4afa79`) + cadena de reversiones 45/45 con 0 diferencias (tras corregir una reversión que perdía un permiso, `34460beb`) |
| ALERTAS | `PASS` | `4a4afa79`: tareas faltantes/apagadas, cola trabada sin intent, reembolsos y cobros para revisar; y `5c578793`: el checkout sin verificar ya no queda mudo |
| MIGRACIONES | `PASS` local y en stack real · aplicación `OWNER_APPROVAL_REQUIRED` | 203/203 en PG17 y en Supabase efímero (CI); verificación previa de sólo lectura en Staging y CP; ninguna de las 45 migraciones de la rama está aplicada en Staging (158) ni en CP (157) |
| OBSERVABILIDAD | `PASS` con pendientes | traza de pedido sin datos personales, salud por componente, alertas nuevas; DIAG-02 parcial (contador del Panel) |
| SEGURIDAD | `PASS` con pendientes | guarda de host de los arneses (`?host=` pisaba la URL local, `a7eb622c`); el cobro real en CP falla cerrado (el secreto smoke no está); AUTHZ-04 parcial (`set_business_open_state`, `authorize_arca_homologation`) |
| STACK | _se completa al cierre_ | migraciones en Supabase real: verde (runs 37122427290, 37122606379, 37123390697) |

## Entornos

| | |
|---|---|
| STAGING | sin cambios hechos por esta sesión (sólo lecturas). Ledger 158; le faltan las 45 migraciones de la rama. Hallazgo de datos: el pago TEST `179851082485` está aprobado en Mercado Pago y su intent «expired» sin pedido (no es dinero real) |
| CONTROLLED_PRODUCTION | sin cambios (sólo lecturas). Compuerta de release: NOT_READY (9 bloqueos: insumos del comercio, migraciones, Edge Functions viejas, guardián ausente, CI) + EDGE-03. El cobro real falla cerrado: `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` no está |
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
| DOC-01 | P1 (doc) | El plan de promoción decía que el cobro real lo abría `MERCADOPAGO_REAL_MONEY_ENABLED` (no existe en el código) y llamaba «error de configuración» al secreto que hoy es la única llave | lectura del código y de los nombres de secretos de CP | corregido `c5454a0c` |
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
- Más PAY-PROBE-01, IDEM-07, IDEM-08, TRACK-01, RB-01, RB-02, TOOL-08 (tabla de arriba).
- Registro: **P1 13 corregidos, 0 abiertos**, 1 gate externo (EDGE-03), 1 riesgo aceptado (TOOL-01: sin Docker local, lo
  cubre el CI); P2 34 corregidos, 24 abiertos (`docs/ecommerce-hardening/findings-register.json`).

### BUGS_PENDIENTES

| Id | Sev. | Qué | Por qué no se hizo hoy |
|---|---|---|---|
| EDGE-03 | P1 (gate externo) | Interruptor permanente del cobro real (opción A, decidida por el dueño) | _se completa al cierre (paquete wp20)_ |
| API-01 / C-2 | P2 | Una negativa de negocio (55000) o un «no existe» (P0002) salen como **HTTP 500**; el Panel los trata como reintentables. **Confirmado en el stack real** (los 2 FAIL del certificador) | decisión del dueño ya tomada (cerrar el contrato en el servidor); el arreglo regenera ~100 funciones de entrada: merece una sesión propia con revisión |
| AUTHZ-04 (resto) | P2 | `set_business_open_state` (el empleado abre y pausa) y `authorize_arca_homologation` (el encargado autoriza) no siguen el catálogo | decisión del dueño |
| PAY-06 (resto) | P2 | Nada vuelve a leer en el proveedor los cobros completados; un `cancellation_reconcile` muerto no tiene salida propia | decisión del dueño (ventana, frecuencia, límites del proveedor) |
| DIAG-02 (resto) | P2 | El contador de colas trabadas del Panel ignora los trabajos de webhook; los códigos nuevos de alerta se muestran con texto genérico | frontend |
| EDGE-15 | P3 | Si también falla `mark_payment_cancellation_ambiguous` (tres fallas seguidas de la base), la cancelación queda «requested» sin trabajo | residual documentado |
| SCRIPTS | P3 | 5 scripts piloto de Staging todavía cancelan con una credencial QA de rol no verificado (`deploy/run-commercial-pilot-e2e.mjs`, `e2e-staging/{cancel-rider-soak-qa,rider-canonical-qa,run-pilot-full-ui-signed,stock-concurrency-pilot}.mjs`) | ver su rol antes de aplicar 20261002050000 en Staging |
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
     `orders.cancel` al empleado; (b) backup: `node .tmp-scratch/stg-backup.mjs` (o el respaldo del plan); (c) verificación
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
4. **Dinero real**: interruptor EDGE-03 (ver BUGS_PENDIENTES), certificación de Mercado Pago en producción, vendedor real
   conectado y decisión de apertura con Mercado Pago. Hoy CP falla cerrado (el secreto smoke no está).
5. **Abrir el PR** de `hardening/taba-ecommerce-production` (apilado sobre #130) y decidir el orden de merge.
6. **Contrato HTTP (API-01/C-2)**: autorizar una sesión dedicada para cerrarlo en el servidor (el mecanismo está probado
   sobre PostgREST 14.5; regenera ~100 funciones).
7. **PAY-06**: política para volver a leer cobros completados (ventana y frecuencia).
8. **Staging**: reembolsar en el panel TEST de Mercado Pago (o recuperar) el pago `179851082485`.
9. **Comercio real de CP**: catálogo, horarios, modo de entrega, equipo, vendedor de Mercado Pago y decisión de cobro (los 5
   bloqueos de negocio de la compuerta de release).

## Resultado

_se completa al cierre_
