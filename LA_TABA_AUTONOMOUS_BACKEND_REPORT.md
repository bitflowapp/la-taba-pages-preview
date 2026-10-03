# LA TABA — Informe del operador autónomo de backend (2026-10-03, consolidado)

Dos sesiones no supervisadas el mismo día sobre la rama `hardening/taba-ecommerce-production`:

- **Sesión 1** (08:22–13:2x -03:00, PC de trabajo): integró los paquetes de idempotencia, pagos, entregas/alertas y
  autorización, PAY-PROBE-01, el interruptor del cobro real (EDGE-03), el contrato HTTP (API-01) y el certificador sobre un
  Supabase efímero. Leyó Staging y CP en sólo lectura. Su lista de commits está al final.
- **Sesión 2** (14:47–15:4x -03:00, Claude Cloud): retomó desde git y CI, reprodujo el gate canónico de base de datos en la nube,
  encontró y corrigió **dos P1 nuevos de pagos** (PAY-PROBE-02 y PAY-PROBE-03), cerró DIAG-03, arregló una carrera del
  certificador y abrió el **PR #133 en borrador** para que el CI corra en cada push. Sin credenciales de Supabase ni de Mercado
  Pago en la nube: **no leyó Staging ni CP**.

Producción y CONTROLLED PRODUCTION sólo en lectura; ningún cobro, reembolso ni dinero real; nada aplicado en Staging ni en CP.
Bitácora: `LA_TABA_AUTONOMOUS_STATUS.md`. Registro de hallazgos (lo leen las compuertas):
`docs/ecommerce-hardening/findings-register.json`.

## Para el dueño, en ocho líneas

1. **Qué estaba roto y quedó corregido (P1):** un «vacío» del proveedor se tomaba como prueba de que no hubo pago
   (PAY-PROBE-01); pasadas 48 horas un checkout sin verificar se cerraba solo y nadie volvía a preguntar (PAY-PROBE-02); un pago
   con tarjeta en revisión manual de Mercado Pago sobre un checkout vencido no tenía ninguna alerta y después de 48 horas nadie lo
   releía (PAY-PROBE-03); la preferencia re-reservaba stock antes de su compuerta (FO-01); el cobro real lo abría una variable de
   humo (EDGE-03). Más 37 P2 corregidos (idempotencia, deadlocks, reembolsos, contrato HTTP, salud, reversiones).
2. **Registro:** 0 P0 abiertos · **0 P1 abiertos** (16 corregidos, 1 riesgo aceptado: el gate de base necesita Docker y en la PC lo
   cubre el CI) · 21 P2 abiertos (decisiones de producto, frontend, otra línea, canal externo).
3. **Probado:** pgTAP canónico **5.993** aserciones; carreras de admisión, stock e idempotencia con **0 deadlocks**; simulacros de
   reversión y de restauración; `npm test` **3.126** (0 fallas); certificador e-commerce sobre un Supabase completo y efímero.
4. **Nada de la rama corrió todavía en un proyecto alojado.** Aplicarla en Staging es tu decisión: AUTHZ-04 le saca a un empleado
   cancelar y rechazar (también en una caja de Caja Clara operada con cuenta de staff).
5. **Compuertas:** READY_FOR_STAGING **YES** · READY_FOR_CONTROLLED_PRODUCTION **BLOCKED** · READY_FOR_REAL_MONEY **NO**.
6. **Lo próximo:** decidir Owner 1 y 2 (abajo) → aplicar en Staging con el procedimiento → certificar ahí → plan de CP.

## Estado

| | |
|---|---|
| HEAD_INICIAL | `8f0d5958` (inicio de la sesión 2; = `origin`, árbol limpio) · la jornada empezó en `47d9ffe9` (sesión 1) |
| HEAD_FINAL | el último commit de la rama (este informe); último commit de código: `288da41f` |
| RAMA | `hardening/taba-ecommerce-production` (apilada sobre `qa/taba-backend-e2e-cert-20260930` = PR #130) |
| COMMITS | sesión 2: 10 + este informe y el archivo de estado (lista abajo) · sesión 1: 60 |
| PUSH | todo pusheado a `origin/hardening/taba-ecommerce-production` |
| PR | **#133 en borrador → `main`** (abierto por la sesión 2 para que el CI corra: el despacho manual de workflows da 403 desde la nube). Apilado sobre #130: **no mergear** sin decidir el orden y Owner 1–2 |
| CI | ver «CI» abajo |

### CI

| HEAD | Validate release candidate | Stack efímero |
|---|---|---|
| `8f0d5958` (inicio) | **verde** (37130800496) | último verde `2bc7218a` (37129059684) |
| `aae0268d` (PAY-PROBE-02/03 + DIAG-03) | base de datos **verde**, Windows **verde**, web: ver el PR (37143751284) | PR **verde** (37143751294, 0 FAIL); push **rojo** (37143748544): 2 checks de la fase `health`, carrera del certificador corregida en `632df82a` |
| HEAD final | ver los checks del PR #133 | ver los checks del PR #133 |

## QA

| | |
|---|---|
| TESTS | Local en la nube, con Docker y la imagen del gate por digest: **gate canónico completo** (`npm run test:db:isolated`) sobre `8f0d5958` y sobre `aae0268d`, los dos **PASS** (migraciones como no-superusuario, pgTAP canónico, carreras de impresión, fiscales, admisión, stock e idempotencia, simulacros de reversión, volcado y restauración); `npm test` sobre `aae0268d`; pruebas de la sonda de salud, del certificador, de la herramienta de base local, de las verificaciones previas y del pulso de CP; simulacros de reversión de 20261003090000 (huella del esquema en 12 categorías); la sonda de salud y las verificaciones previas corridas con un rol igual a `supabase_read_only_user` contra la rama aplicada. CI: los tres jobs de `Validate release candidate` y el certificador en el stack |
| PASS | pgTAP canónico **5.993/5.993** (5.938 + 55 nuevas) · `npm test` **3.125/3.126** · gate canónico local PASS ×2 · `GLOBAL_IDEMPOTENCY: PASS` (751 llamadas, 0 deadlocks, 0 esperas agotadas) · certificador en el stack: 0 FAIL en la corrida del PR |
| FAIL | ninguno abierto. Durante la sesión: el stack en 37143748544 (2 checks de `health`, carrera del certificador, corregida); las tres reproducciones de los defectos nuevos fallaron ANTES de su arreglo, como corresponde |
| FLAKY | **1, con causa y arreglo**: la fase `health` del certificador afirmaba el latido del planificador antes de la primera corrida de pg_cron (frontera del minuto) en un stack recién levantado (`632df82a`) |
| SKIPPED | 1 en `npm test`: la prueba de PowerShell, que sólo corre en Windows (en CI corre en el job de Windows). Ningún skip para conseguir verde |

## Auditoría

| Área | Resultado | Evidencia |
|---|---|---|
| PAGOS | `PASS` hasta el límite posible sin dinero real | Sesión 2: **PAY-PROBE-02** (la alerta de checkout sin verificar se cerraba sola a las 48 h y el barrido dejaba de preguntar; ahora la cierra sólo una prueba o el dueño / un encargado con nota, y el barrido pregunta una vez por día hasta 30 días) y **PAY-PROBE-03** (un pago pending / in_process / authorized sobre un checkout vencido entra en la misma regla), los dos en `20261003090000` con 55 aserciones y simulacro de reversión. Recorrido contra la lista del caso crítico: aprobado + vencido → revisión con alerta sin ventana; vacío persistente → sólo calla uno concluyente; reintentos agotados → `dead_letter` con alerta CRITICAL; credencial incorrecta o reconexión → vacíos no concluyentes y sonda diaria; aviso fuera de orden o tardío → no retrocede el estado (pgTAP); cobro duplicado → PAYMENT_NEEDS_REVIEW crítica hasta que el proveedor informa la devolución. Sesión 1: reembolsos, avisos firmados, trabajos muertos, PAY-PROBE-01, EDGE-03, FO-01/FO-02 |
| IDEMPOTENCIA | `PASS` | La carrera global (checkout, preferencia, webhook y su cola, transiciones, cobro manual, entrega, oferta, reembolso, cancelación de pago, perfil y direcciones) en el gate: 751 llamadas, 0 deadlocks, 0 esperas agotadas, local y en CI |
| AUTORIZACIÓN | `PASS` en código · aplicación de AUTHZ-04 `OWNER_APPROVAL_REQUIRED` | Barrido de la sesión 2 sobre la rama aplicada: ninguna tabla pública admite INSERT/UPDATE/DELETE directo de clientes, salvo columnas de `businesses` (AUTHZ-02, registrado) y `products.sort_order`; las políticas están acotadas al comercio; las 16 funciones SECURITY DEFINER que una heurística marcó sin control delegan la autorización o son públicas por diseño. Matrices pgTAP de 838 (RLS) y 796 (autorización) celdas. **Caja Clara, precisado:** el E2E de Caja Clara en CP conecta la caja con la credencial del dueño y la limpieza QA cancela como dueño; ninguna certificación cancela como empleado. Una caja real con cuenta de staff pierde cancelar/rechazar al aplicar 20261002050000 |
| CONCURRENCIA | `PASS` | Carreras de stock (12 escenarios, sin sobreventa ni stock negativo), admisión (topes exactos), impresión y fiscal en el gate; IDEM-07/IDEM-08 (orden de candados) con sondas de llegada fijada. La migración nueva no toma candados nuevos (lecturas y un índice) |
| WEBHOOKS | `PASS` | Aviso duplicado ×20 → 1 recibo y 1 trabajo; firmado y sin firma → 1; snapshot viejo no retrocede; aprobado viejo no revive un cobro reembolsado (pgTAP de la sesión 1) |
| RECOVERY | `PASS` | Simulacros de reversión en el gate y cadena completa de 50 reversiones (sesión 1); reversión de `20261003090000`: huella idéntica a la anterior, re-ejecutable. Restauración de volcado con evidencia durable (gate) |
| MIGRACIONES | `PASS` local, en CI y en el stack · aplicación `OWNER_APPROVAL_REQUIRED` | 209 migraciones (158 de `main` + 51 de la rama) en el gate como no-superusuario y en un Supabase efímero. Las nuevas guardas `ROLLOUT_BLOCKED` se niegan si una función cambió fuera de la rama. Verificaciones previas de sólo lectura: tres archivos en `docs/migrations/checks/` (el de 20261003 es de la sesión 2 y nunca corrió contra Staging/CP: no hubo credenciales) |
| ALERTAS | `PASS` con pendientes | Sesión 2: CHECKOUT_PROVIDER_UNVERIFIED ya no se cierra por tiempo y cubre el pago sin resultado final. Sesión 1: tareas faltantes/apagadas, colas sin intent, reembolsos y cobros para revisar. Pendiente: **no hay canal fuera de banda** para una alerta crítica (DIAG-09): se ve en el Panel y en el pulso, nadie recibe un aviso |
| HEALTH | `PASS` | **DIAG-03 corregido** (`b6a94a96`): la sonda veía 0 CRITICAL con una abierta y exigía exactamente cuatro tareas; ahora exige el inventario de la base, cuenta por severidad y acepta CP y Staging (`--target`). Validada contra la rama aplicada con un rol igual al de sólo lectura de Supabase |
| OBSERVABILIDAD | `PASS` con pendientes | Traza del pedido sin datos personales, salud por componente, evidencia de la alerta con el estado del proveedor; el pulso de CP cuenta un cobro sin pedido desde su aprobación (`288da41f`). Pendientes: DIAG-02 (textos del Panel para los códigos nuevos), DIAG-09, DIAG-10 (el vigilante externo mira la producción vieja) |
| SEGURIDAD | `PASS` con pendientes | El cobro real en CP falla cerrado (leído por la sesión 1 a las 11:25); el interruptor exige el valor exacto `enabled`; la marca de agua y las auxiliares nuevas no las lee ni ejecuta ningún rol de cliente; las sondas sólo mandan SELECT al endpoint de sólo lectura. AUTHZ-02/AUTHZ-04 (resto) esperan decisión |
| STACK | `PASS` con la carrera corregida | Certificador contra un Supabase completo y efímero (GoTrue, PostgREST, pg_cron y Edge reales): 0 FAIL en la corrida del PR sobre `aae0268d`; la del push falló por la carrera de la fase `health`, corregida en `632df82a` y reverificada por el CI del HEAD final |

## Entornos

| | |
|---|---|
| STAGING | Sin cambios de ninguna sesión. Ledger 158 leído a las 11:20 (sesión 1); la rama tiene 51 migraciones más. Pago TEST `179851082485` aprobado sin pedido (no es dinero real): alguien tiene que reembolsarlo o recuperarlo. La sesión 2 no lo pudo releer |
| CONTROLLED_PRODUCTION | Sin cambios. Última lectura (sesión 1, 11:25): compuerta de release NOT_READY, `MONEY_MOVEMENT_POSSIBLE: NO`, ningún comercio con Mercado Pago productivo ni vendedor conectado, ledger 157 |
| PRODUCTION_READ_ONLY | Sesión 1: todas las lecturas por el endpoint de sólo lectura de la Management API o por nombres de secretos. Sesión 2: ninguna lectura (sin credenciales en la nube) |

## Hallazgos

### BUGS_ENCONTRADOS por la sesión 2 (con evidencia)

| Id | Sev. | Qué | Evidencia | Estado |
|---|---|---|---|---|
| PAY-PROBE-02 | **P1** | Pasada la ventana de 48 horas, CHECKOUT_PROVIDER_UNVERIFIED se resolvía sola («condición ausente») y el barrido dejaba de preguntar, sin ninguna prueba de que el comprador no pagó | Reproducido sobre la rama: 47 h abierta, 49 h resuelta por el sistema, ninguna sonda encolada | corregido `d89ad936` |
| PAY-PROBE-03 | **P1** | Un pago pending / in_process / authorized sobre un checkout vencido: ninguna alerta, y pasadas 48 h nadie lo releía. Si el proveedor lo aprueba tarde y el aviso no llega: cobro sin pedido, sin señal | Reproducido: snapshot in_process, sesión vencida por el barrido, ninguna alerta a 47 ni a 49 h, ninguna sonda a 49 h | corregido `56a76d24` |
| DIAG-03 | P2 | La sonda de salud no veía alertas CRITICAL y no podía dar verde | Con 1 CRITICAL abierta la consulta vieja contaba 0 (rol de sólo lectura, base local) | corregido `b6a94a96` |
| CERT-02 | P3 | La fase `health` del certificador afirmaba el latido del planificador antes de la primera corrida de pg_cron | Run 37143748544: leyó 18:21:44, primer barrido 18:22:00 | corregido `632df82a` |
| PULSE-01 | P3 | El pulso de CP contaba un cobro sin pedido desde su última relectura (`updated_at`): uno releído cada pocos minutos no contaba nunca | Prueba nueva que falla con el código anterior | corregido `288da41f` |

### BUGS_CORREGIDOS (la jornada completa)

- Sesión 2: PAY-PROBE-02, PAY-PROBE-03, DIAG-03, CERT-02, PULSE-01 (tabla de arriba).
- Sesión 1 (detalle en su bitácora): idempotencia (7 defectos de la carrera), IDEM-07, IDEM-08, reembolsos y avisos firmados,
  PAY-PROBE-01, TRACK-01, RB-01, RB-02, TOOL-08, FO-01, FO-02, EDGE-03, contrato HTTP (API-01 + C-2), TOOL-05, AUTHZ-04 (parcial).
- Registro: **P1 16 corregidos, 0 abiertos**, 1 riesgo aceptado (TOOL-01); P2 37 corregidos, 21 abiertos.

### PENDIENTES

| Id | Sev. | Qué | Por qué no se hizo |
|---|---|---|---|
| DIAG-09 | P2 | Ninguna alerta crítica sale del Panel: no hay correo, WhatsApp ni push | Hace falta elegir el canal y darle una credencial: decisión del dueño (propuesta en Owner 6) |
| DIAG-10 | P2 | El vigilante externo del planificador mira el sitio de la producción vieja | Retargetearlo a CP es operativo (Owner 7); el código ya acepta la configuración explícita |
| AUTHZ-04 (resto), AUTHZ-02 | P2 | `set_business_open_state` (el empleado abre y pausa), `authorize_arca_homologation` (el encargado autoriza); escritura directa de columnas de `businesses` | Decisión de producto |
| PAY-06 (resto) | P2 | Nadie relee en el proveedor un cobro ya completado; un `cancellation_reconcile` muerto no tiene salida propia | Decisión del dueño (ventana, frecuencia, límites del proveedor) |
| DIAG-02 (resto) | P2 | El Panel muestra con texto genérico los códigos nuevos, y no dice que CHECKOUT_PROVIDER_UNVERIFIED se cierra con una nota (la acción requerida del servidor sí lo dice) | Frontend: tocar un archivo precacheado obliga a subir la identidad del service worker, que es de la línea de frontend |
| EDGE-06, EDGE-15 | P2/P3 | Preferencia dudosa sin re-envío; cancelación `requested` sin trabajo si fallan tres escrituras seguidas | Decisión / residual documentado: no mueven dinero sin que otra alerta lo vea |
| Contrato HTTP (resto) | P3 | 40 entradas de otras líneas y las dos SQL de OAuth siguen contestando 500 a un 55000/P0002 | Son de otras líneas |
| Resto del registro | P2 | 21 P2 abiertos | Ver el registro |

### RIESGOS_RESIDUALES

1. **Nada de la rama corrió sobre un proyecto alojado** (Staging 158, CP 157; la rama 209). La evidencia es el gate (local y CI),
   un Supabase efímero en CI y PG17 local.
2. **La sesión 2 no leyó ningún entorno.** Lo último en vivo es de las 11:25. Antes de aplicar, repetir las tres verificaciones previas.
3. Mercado Pago real nunca se ejercitó (regla); los pagos se probaron con un proveedor simulado, Mercado Pago TEST en lectura y el stack.
4. Una alerta crítica a la noche no la ve nadie hasta que alguien abra el Panel o corra el pulso (DIAG-09).
5. Al aplicar 20261003090000, los checkouts de las 48 horas previas quedan vigilados sin límite de tiempo: en Staging, donde el
   vendedor TEST se reconecta seguido, pueden aparecer alertas CRITICAL de checkouts abandonados que necesitan una nota del
   dueño o un encargado. Es la conducta buscada; la verificación previa U1/U2 dice cuántos antes de aplicar.
6. AUTHZ-04 cambia lo que puede hacer un empleado en el Panel y en una caja de Caja Clara operada con cuenta de staff.

## OWNER_APPROVAL_REQUIRED

Cada ítem con el paso exacto. **Ninguno se ejecutó.**

1. **Aplicar la rama en Staging** (209 migraciones + las 9 Edge Functions de Mercado Pago).
   - Por qué: es la única forma de certificar el build en un proyecto alojado. Riesgo: AUTHZ-04 cambia lo que hacen las corridas de
     la línea Caja Clara (su comercio `la-taba-staging` canceló 24 pedidos como empleado) y `abandoned_order_minutes=120` de ese
     comercio empieza a cumplirse (`docs/ecommerce-hardening/staging-coexistence.md`); 20261003090000 puede abrir alertas críticas
     de checkouts recientes sin verificar.
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
   ejecutado; incluye la guarda y la marca de agua de 20261003090000). No antes del punto 1 y del CI verde sobre el mismo commit.
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

## Compuertas

Significado usado: **YES** = técnicamente listo con evidencia reproducible; lo único que falta es la acción autorizada misma.
**BLOCKED** = no puede avanzar hasta una decisión o un insumo de otro (dueño, comercio, proveedor). **NO** = falta trabajo técnico.

**READY_FOR_STAGING: `YES`**

- CI de la rama verde (base de datos, Windows y web en `aae0268d`; el HEAD final, en el PR #133), gate canónico PASS en local y en
  CI, certificador sin FAIL en un Supabase efímero, 0 P0/P1 abiertos, reversión de cada migración nueva ensayada.
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
- (este informe y el archivo de estado)

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
