# PILOT-OPS-HANDOFF — TABA2 operable, monitoreable y medible

**Rama:** `feature/taba2-pilot-ops` · **Base:** `c7c3bbd`

Este documento cuenta qué se construyó, con qué evidencia, qué se encontró roto
por el camino y qué queda pendiente. Los otros dos entregables son
[PILOT-METRICS.md](PILOT-METRICS.md) —qué mide cada número— y
[OPERATIONS-RUNBOOK.md](OPERATIONS-RUNBOOK.md) —qué hacer cuando algo se rompe.

---

## 1. El problema que había

TABA2 tenía el circuito completo funcionando —storefront, checkout, Mercado
Pago, Panel, Rider, entrega— y **ninguna forma de mirarlo**.

Concretamente, antes de esta rama:

- `get_business_opening_status` devolvía
  `'backend', jsonb_build_object('status', 'ok')` **literal**, sin sonda alguna.
  Un estado que no puede dar mal no informa nada.
- `get_production_operation_center` devolvía trece contadores operativos y
  **ningún peso**: no había ventas del día, ni ticket promedio, ni pagos
  aprobados sin pedido, ni stock a reponer, ni reservas vencidas. Para saber si
  el negocio facturó había que abrir la consola.
- Ese mismo centro **contaba pedidos QA como operación real**: se escribió antes
  de que existiera `orders.origin` (`20260806160000`), así que los fixtures de
  prueba entraban en "pedidos nuevos" igual que la compra de un cliente.
- Las alertas cubrían pagos, fiscal e impresión. Faltaban las que se rompen
  todos los días en un reparto: un pedido que nadie acepta, uno listo que ningún
  rider toma, una entrega demorada, stock que se agota, una reserva que no se
  liberó, un importe que no coincide, un aviso mal firmado.
- El `correlation_id` existía desde `20260802180000` y atravesaba todo el
  circuito, pero **no había ninguna lectura**: para seguir un pedido roto había
  que abrir seis tablas a mano, mirando de paso `customer_name`,
  `delivery_street` y el hash del correo del pagador.
- No había reporte comercial.
- No había simulacro de recuperación.

---

## 2. Qué se construyó

### 2.1 Cinco migraciones

| Migración | Qué agrega |
|---|---|
| `20260807110000_pilot_operations_thresholds_and_health` | Umbrales configurables por negocio + salud verificada de 8 servicios |
| `20260807120000_pilot_operations_dashboard` | La superficie operativa completa en una sola lectura |
| `20260807130000_pilot_operational_alert_coverage` | 18 detectores, agregación anti-spam y exclusión de sujetos QA |
| `20260807140000_pilot_incident_trace` | "¿Dónde se rompió LT-XXXX?" en 8 etapas, sin PII |
| `20260807150000_pilot_commercial_report` | Reporte diario/semanal con guard de muestra |

**Ninguna** toca ARCA, la app Android del Rider ni la lógica de transición de
pedidos. Ninguna borra evidencia: no hay un solo `drop table`, `truncate` ni
`delete` sobre pedidos, items, eventos, checkouts, pagos, ubicaciones o alertas.

### 2.2 El Panel

Pantalla nueva **Estado del piloto** (`pilot-ops`), que contesta en orden:

1. **Qué necesita una persona** — cobros sin pedido, importes que no coinciden,
   pedidos sin aceptar, listos sin rider, entregas demoradas, riders sin señal,
   reservas vencidas, stock a reponer y sin stock.
2. **Cómo viene el día** — pedidos, vendido, ticket promedio, entregados,
   cancelados y mostrador (caja aparte), con la nota de cuántos pedidos de
   prueba se excluyeron.
3. **Pedidos por estado** — abiertos y checkouts en curso, un solo vocabulario.
4. **Salud de servicios** — ocho veredictos, cada uno con la evidencia que lo
   sostiene desplegable.
5. **Trabajo interno** — seis colas; rojo para trabajo abandonado, ámbar para
   reintentos, y el tráfico normal no alarma.
6. **Alertas** — con "Ya la vi" y resolución con nota.
7. **¿Dónde se rompió un pedido?** — buscador por código.
8. **Última actividad** — nueve marcas de tiempo.

Archivos: `js/business/pilot-operations-language.js` (presentador puro),
`renderPilotOperationsSurface` en `js/business/business-panel-render.js`,
wiring en `js/business/business-operations-center.js`, cinco RPC nuevas en
`js/repositories/supabase-operations-repository.js`, estilos en
`styles/business.css`.

### 2.3 Simulacro de recuperación

`npm run pilot:ops:drill` — dos clústeres Postgres efímeros, datos sintéticos,
cero datos humanos. Ver §5.

---

## 3. Tres defectos encontrados y corregidos

Los tres aparecieron por medir en vez de suponer.

### 3.1 La cadena de migraciones no era replayable

**Medido el 2026-08-07** replicando las migraciones sobre Postgres 17.6 limpio.
`20260806160000` redefine `get_rider_queue` agregando dos columnas de salida con
`create or replace`, y PostgreSQL no puede cambiar el tipo de retorno de una
función `returns table`. La cadena **abortaba exactamente ahí**.

Consecuencia: reconstruir el proyecto desde cero —el camino de recuperación ante
desastre— era imposible. Un backup sirve poco si el esquema no se puede
levantar.

Corrección: `drop function if exists public.get_rider_queue(uuid);` inmediatamente
antes del `create or replace`, en la misma migración. El cuerpo de la función no
cambia. En staging esa migración ya corrió, así que editarla no la re-ejecuta;
lo que hace es volver replayable la cadena para cualquier proyecto nuevo.

### 3.2 El `drop` reabrió un privilegio

Al recrear la función, PostgreSQL le devuelve el default: `EXECUTE` para
`PUBLIC`. Verificado en la base local: `get_rider_queue` quedó **ejecutable por
`anon`**, es decir la cola de retiro del rider accesible sin iniciar sesión.

Corrección: en la misma migración, `revoke all … from public, anon` y
`grant execute … to authenticated`, restituyendo exactamente la postura de
`20260802100000`, más el comentario que había fijado `20260802103000`.

Verificado después del cambio: `get_rider_queue` → `authenticated: sí`,
`anon: no`.

> Este defecto es la razón por la que el health check `rider_contracts` verifica
> la **matriz de privilegios** y no sólo la existencia de las funciones. Si algo
> así vuelve a pasar, el tablero lo dice.

### 3.3 Las alertas contaban pedidos QA como incidentes reales

Medido sobre el escenario sintético: tres alertas `CRITICAL` de "pago aprobado
sin pedido", y **una era un checkout QA**. Una alerta crítica falsa por cada dos
verdaderas entrena al operador a ignorar el tablero, que es peor que no tenerlo.

Corrección: todos los detectores derivados de pedidos, checkouts y pagos filtran
por `origin = 'production'`. Las alertas viejas apuntadas a sujetos QA se cierran
con motivo auditado (`qa_subject_excluded`), sin borrar nada.

---

## 4. Decisiones de diseño que conviene conocer

### `unknown` es un estado de salud de primera clase

Cuatro estados: `healthy`, `degraded`, `down`, `unknown`. **Sin evidencia el
veredicto es `unknown`, nunca `healthy`.** Un servicio que nunca se vio andar no
está sano; decir que sí es la forma más barata de que un tablero mienta.

`unknown` no degrada el estado general a `down`: no saber no es lo mismo que
estar caído, y confundirlos entrena a ignorar el tablero.

### Los umbrales tienen procedencia

Cada umbral viaja con `source: "business" | "default"`. El tablero puede decir
si el número es una decisión del negocio o el default del producto. Los defaults
están declarados en PILOT-METRICS.md; no son mediciones disfrazadas.

### Las alertas masivas se agregan

Cuarenta productos bajo mínimo son **una** alerta con cuarenta adentro, no
cuarenta alertas que tapan todo lo demás. Lo mismo con reservas vencidas y
avisos con firma inválida.

### El "Ya la vi" registra quién la vio primero, una sola vez

Repetirlo devuelve `idempotent_replay: true`, no reatribuye el reconocimiento a
otro operador y no escribe un segundo evento de auditoría. (Esta propiedad ya la
había cerrado `20260807090000`; acá se verifica.)

### El ticket promedio es `null` sin pedidos, no cero

Dividir por cero devuelve un número; no dividir devuelve la verdad. El Panel lo
muestra como "sin pedidos".

### No hay "más vendido" sin muestra

Doble guard: 20 pedidos en el período **y** 10 unidades del que encabeza. Por
debajo, el ranking se publica igual —las cantidades son ciertas— pero
`best_seller` viaja en `null` y el texto dice "muestra insuficiente".

### Los tiempos son percentiles

p50 y p90 con su tamaño de muestra. Un pedido que tardó tres horas porque el
negocio cerró no puede mover la medida de los otros veinte.

### La traza no necesita saber quién es el cliente

`trace_pilot_order` devuelve estados, instantes y contadores. No devuelve
nombre, teléfono, dirección, coordenadas, hash de correo, token de seguimiento,
código de entrega ni el id del rider. Sí devuelve `provider_payment_id`: no es
un dato personal y sin él el runbook R2 no se puede ejecutar.

### El mostrador es otra caja

Las ventas de `pos_sales` se informan aparte y **nunca** se suman a las ventas
de la web. Sumarlas sin decirlo produce un número que no coincide con ninguna de
las dos.

---

## 5. Evidencia

### 5.1 Simulacro de recuperación — `npm run pilot:ops:drill`

Corrida completa el 2026-08-07. Evidencia en
`artifacts/pilot-ops-restore-drill.json`.

| Paso | Resultado |
|---|---|
| Reconstrucción desde cero | **60 migraciones** replicadas sobre Postgres limpio, 9.9 s |
| Escenario sintético | cero datos humanos, dominios `.invalid` |
| Contrato operativo antes del backup | **72 comprobaciones** |
| Backup | `pg_dump --format=custom`, sha256 registrado |
| Proyecto de recuperación | clúster **nuevo**, esquema desde las mismas 60 migraciones |
| Restauración | `pg_restore --exit-on-error --single-transaction`, 197 ms |
| Equivalencia | **69 tablas** con igual cantidad de filas + huella de contenido idéntica |
| Contrato sobre el proyecto recuperado | **72 comprobaciones**, otra vez |

Las 72 comprobaciones no son "el JSON tiene esta clave": son números conocidos
del escenario. Entre ellas:

- el pedido QA de $99.999 existe y **no movió un solo peso** del tablero;
- el intento de pago QA aprobado sin pedido **no** cuenta en "cobrado sin
  pedido", y el de producción sí;
- ninguna alerta abierta apunta a un sujeto QA;
- ningún servicio se declara sano con evidencia vacía;
- la traza señala `panel` para el pedido sin aceptar y `rider` para el listo sin
  rider, y **ninguna etapa rota** para el entregado;
- la traza no filtra el nombre del cliente;
- el reporte del día (5 pedidos) devuelve `best_seller: null`; el del día
  anterior (25 pedidos, 50 unidades) devuelve el ranking coronado;
- repetir el "Ya la vi" no reatribuye actor ni hora.

### 5.2 Gates del repositorio

| Gate | Resultado |
|---|---|
| `npm test` | **1152 / 1152** |
| `npm run check` | aprobado |
| `npm run migrations:validate` | aprobado, sin ERROR ni WARNING |
| `npm run secrets:scan` | limpio |
| `npm run fiscal:test` | 22 / 22 |

De los 1152 tests, **50 son nuevos**: 15 del Panel, 24 del contrato de las
migraciones y 11 del simulacro.

### 5.3 Verificación en base real

Las cinco migraciones se aplicaron y probaron contra Postgres 17.6 con el mismo
stack de extensiones que Supabase (`pg_cron`, `pg_net`, `supabase_vault`,
`pgcrypto`) y el esquema `auth` real. Los health checks devolvieron veredictos
distintos según la evidencia disponible —`scheduler` sano con dos jobs corriendo
de verdad, `worker` en `unknown` sin trabajo en la cola— y no un estado fijo.

---

## 6. Qué NO está hecho

Escrito acá para que nadie lo descubra en el piloto.

### 6.1 No se validó contra staging

**El lock `taba2-staging-mutation.lock` del directorio de locks compartido lo
sostiene `TABA2_PILOT_RC`** (`STATUS=HOLDING_ESPERANDO_COMPRA_IPHONE`). No se mutó
staging ni se aplicaron estas migraciones ahí. Toda la verificación es local,
sobre bases efímeras.

Para desplegar hace falta tomar el lock y aplicar, en orden:

```
20260807110000_pilot_operations_thresholds_and_health.sql
20260807120000_pilot_operations_dashboard.sql
20260807130000_pilot_operational_alert_coverage.sql
20260807140000_pilot_incident_trace.sql
20260807150000_pilot_commercial_report.sql
```

La corrección de `20260806160000` **ya está aplicada en staging** en su versión
anterior; el archivo editado sólo afecta a proyectos nuevos. Si se quiere que
staging también cierre el privilegio de `get_rider_queue`, hay que verificarlo
ahí explícitamente:

```sql
select has_function_privilege('anon', 'public.get_rider_queue(uuid)', 'execute');
-- tiene que devolver false
```

### 6.2 La configuración de backups del proyecto hospedado no está auditada

El simulacro prueba **el procedimiento** de recuperación, no la configuración
del proveedor. Las cinco preguntas que faltan responder —backups habilitados,
frecuencia, retención, PITR, último backup exitoso y quién puede restaurar—
están como checklist en OPERATIONS-RUNBOOK.md § Backups. Viven en la consola de
Supabase y no se pueden verificar desde el repo.

**Sin esas cinco respuestas escritas no hay política de backup: hay una
suposición.**

### 6.3 ARCA queda fuera

Los detectores fiscales (`FISCAL_OUTBOX_STALLED`, `FISCAL_AUTHORIZATION_AMBIGUOUS`,
`FISCAL_ARTIFACT_STALLED`, `PRINT_JOB_FAILED`) están en la bandeja y funcionan,
pero ARCA no está integrada. Cuando lo esté, esas alertas empiezan a disparar
solas: no hay que agregar nada.

No se tocó `services/arca-fiscal-bridge` ni ninguna migración fiscal.

### 6.4 Rider Android y E2E

No se tocó la app del Rider ni los tests E2E: son frentes de otros agentes. Lo
único que esta rama observa del Rider es la **matriz de privilegios** de sus
diez RPC, que se verifica sin ejecutar ninguna.

### 6.5 Limitaciones conocidas de las métricas

- **`unknown_stock` debería ser siempre 0.** El invariante
  `products_verified_master_data` exige `stock is not null` para publicar. Se
  informa igual, para poder detectar si el invariante se rompe.
- **El stock del reporte comercial es una foto del instante**, no del período: no
  hay historia de stock en el modelo. El payload lo declara.
- **`approved_without_order` y `paid_checkouts_without_order` no se suman**: son
  dos vistas del mismo dinero. El Panel las muestra en una sola tarjeta
  justamente por eso.
- **El reporte tiene un tope de 366 días** por consulta.

---

## 7. Cómo verificar todo esto

```bash
npm ci
npm run check
npm test
npm run migrations:validate
npm run secrets:scan

# Simulacro completo (requiere Docker; levanta y borra dos contenedores)
TABA_PILOT_RESTORE_DRILL=I_UNDERSTAND_THIS_IS_LOCAL_ONLY npm run pilot:ops:drill
```

El simulacro es local-only por construcción: exige confirmación explícita y se
niega a correr si `SUPABASE_URL`, `SUPABASE_DB_URL` o `DATABASE_URL` apuntan
fuera de la máquina.

---

## 8. Higiene

- Rama `feature/taba2-pilot-ops`, commits locales, sin `push`, `reset`, `clean`,
  `stash`, `amend` ni `git add .`.
- `PRODUCTION_TOUCHED=false` · `STAGING_TOUCHED=false` · `ARCA_TOUCHED=false` ·
  `RIDER_ANDROID_TOUCHED=false`
- Lock de cómputo pesado (`heavy-compute.lock`) tomado y liberado.
- Lock de mutación de staging **no tomado**: lo sostenía otro agente.
- Datos: cero datos humanos. Todo el escenario es sintético y declarado.

---

## DECLARACIÓN

```
TABA2_PILOT_OPERATIONS_AND_OBSERVABILITY_CERTIFIED
```

Alcance de la certificación: la superficie operativa, las alertas, la
observabilidad por correlation ID, los health checks con evidencia, el
simulacro de recuperación y la analítica comercial están implementados y
verificados contra una base PostgreSQL real con el escenario sintético, antes y
después de una restauración.

**Excluido explícitamente de la declaración:** la validación contra
`la-taba-staging` (el lock lo sostenía otro agente) y la auditoría de la
configuración de backups del proyecto hospedado (§6.2). Las dos son
verificables con los procedimientos escritos en OPERATIONS-RUNBOOK.md y ninguna
está hecha.
