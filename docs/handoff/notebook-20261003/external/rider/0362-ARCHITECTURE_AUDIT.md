# TABA Gate 2 — Auditoría de arquitectura rider, GPS y tracking

Fecha de auditoría: 2026-08-01  
Worktree auditado: `C:\1212\la-taba-real-orders-staging`  
Rama: `staging/real-orders-walter`  
HEAD inicial verificado: `c6270589756214eac617515248e93a8e8819190b`  
Proyecto Supabase staging: `ukxqbgswjlibmnjemrzd`

## Alcance y preflight

El preflight inicial devolvió:

- rama exacta `staging/real-orders-walter`;
- HEAD exacto `c6270589756214eac617515248e93a8e8819190b`;
- `git status --short` vacío;
- `git diff --check`, `git diff --stat` y `git diff --name-status` sin diferencias.

La migración Gate 1 `20260801020000_order_revision_and_event_sequence.sql` no fue
editada. Tampoco se tocó `main`, producción ni la rama fuente.

`supabase/config.toml` y `supabase/.gitignore` no fueron modificados ni incluidos
en Gate 2: el primero contiene configuración local portable del CLI/API/Realtime,
pero no es necesario para el contrato rider/GPS; el segundo no contiene cambios
intencionales de este gate. No se copiaron secretos, contraseñas, `supabase/.temp`,
artefactos externos, datos sintéticos ni logs con credenciales.

## Hallazgos antes de Gate 2

El Gate 1 dejó correctamente:

- `orders.revision bigint not null` con `orders_zz_bump_revision`;
- `order_events.sequence bigint not null` y único;
- normalización `arriving -> arrived` antes del bump;
- `transition_order(uuid, bigint, text)` con CAS por revisión, no-op y delegación
  de autorización a `change_order_status`;
- replica identity full en `orders` y `order_events`.

La auditoría de la superficie previa detectó estos huecos:

1. `claim_available_rider_order` sólo comparaba estado y rider esperado, y no
   aceptaba revisión. Un doble toque del mismo rider podía terminar como conflicto
   después del primer update.
2. El botón productivo de `on_the_way` todavía llamaba directamente al RPC legacy
   `change_order_status`, sin contrato Gate 1 de revisión específico para inicio de
   entrega.
3. `rider_locations` no tenía `sequence`, `order_revision`, `recorded_at` ni una
   marca declarada del dispositivo para rechazar muestras futuras/atrasadas.
4. El DTO público ordenaba por `created_at` y la tabla tenía superficies RLS de
   lectura operativa innecesarias para el cliente. La historia cruda no era necesaria
   para tracking público.
5. El controller de GPS no conservaba la intención de reanudar el watcher después
   de una pausa de la pestaña.

## Arquitectura efectiva después de la implementación

```text
Rider Auth + membership rider
  -> cola minimizada con orders.revision
  -> claim_available_rider_order(revision) [FOR UPDATE + CAS]
  -> start_rider_delivery(revision)
  -> transition_order Gate 1 -> change_order_status
  -> publish_rider_location(order_revision, captured_at)
  -> rider_locations(sequence, recorded_at servidor)

Cliente con x-order-token
  -> get_public_order_tracking()
  -> snapshot mínimo + último GPS del rider asignado
  -> MapLibre sólo en entrega activa
  -> freshness + reconsulta en focus/pageshow/visibility/online
```

La migración nueva es `supabase/migrations/20260801040000_rider_gps_tracking_gate2.sql`.

### Toma atómica

`claim_available_rider_order` ahora:

- deriva el actor desde `auth.uid()` y exige membership rider activa;
- acepta sólo delivery `ready` sin rider;
- bloquea la fila con `FOR UPDATE` y verifica `p_expected_revision`;
- usa `UPDATE ... WHERE revision = p_expected_revision ...`;
- registra el evento `order.rider_claimed` y deja que Gate 1 incremente la revisión;
- convierte el segundo toque del mismo rider sobre `assigned` en `idempotent_no_op`;
- nunca devuelve ese no-op a otro rider.

La RPC de cuatro argumentos legacy se elimina del catálogo SQL. La cola no expone
UUID interno ni PII completa y ahora lleva la revisión necesaria para el botón.

### Inicio de entrega

`start_rider_delivery` exige rider activo, pedido delivery, asignación exacta y
estado `assigned` o `picked_up`. Compara la revisión, delega la transición a
`transition_order` de Gate 1 y devuelve el payload operativo minimizado. Un retry
cuando ya está `on_the_way` es no-op sin segundo evento ni bump.

Negocio, cliente y otro rider quedan fuera de la RPC por `auth.uid()`, membership
y asignación.

### GPS y privacidad

`rider_locations` agrega:

- `sequence bigint not null` con secuencia PostgreSQL e índice único;
- `order_revision bigint not null`;
- `recorded_at timestamptz not null`, escrito por trigger con `clock_timestamp()`;
- `captured_at` opcional, sólo para rechazar timestamp futuro o más viejo que tres
  minutos y muestras atrasadas respecto de la última aceptada.

La publicación exige rider asignado, estado `assigned/picked_up/on_the_way/arrived`,
revisión vigente, coordenadas dentro de rango, accuracy hasta 250 m, rumbo/velocidad
válidos y frecuencia mínima de cinco segundos. Al entregar/cancelar el estado deja
de ser elegible y el trigger terminal purga las ubicaciones como antes.

Se eliminaron las policies de lectura/escritura de `rider_locations` y se revocaron
privilegios `SELECT/INSERT/UPDATE/DELETE` a `anon` y `authenticated`. La única
escritura es la RPC `SECURITY DEFINER`; el cliente no puede leer la historia raw.
El DTO tokenizado retorna sólo el último fix del pedido, del rider asignado, por
`sequence desc`, redondeado y con `recorded_at`. No expone token, UUID del rider,
historial ni secretos.

Freshness de UI:

- hasta 15 s: reciente / marcador actual;
- 16–45 s: demorada / última ubicación, sin movimiento inventado;
- más de 45 s: sin GPS en vivo / última ubicación honesta;
- sin fix válido: no se muestra mapa productivo.

### Realtime, polling y recuperación

`orders` y `order_events` mantienen replica identity full y Realtime. El cliente usa
Realtime como señal de cambios de pedido, nunca como autoridad. La consulta
tokenizada del cliente permanece en polling porque `x-order-token` no puede viajar
como header de un WebSocket; cada snapshot vuelve a PostgreSQL. El controller
reconsulta en foco, `pageshow`, visibilidad y regreso de red, aborta requests
duplicadas y oculta el GPS al estado terminal.

El watcher rider conserva una intención explícita durante `pagehide`, pausa el
watcher y lo vuelve a validar/reanudar al regresar a foreground. Esto no declara
background confiable: la suspensión de pestañas Android no fue certificada como
servicio continuo.

### UI y mapa

La UI productiva usa `js/map/maplibre_tracking_map.js`, no Leaflet. No fabrica ruta,
destino, comercio ni posición: MapLibre recibe sólo el fix GPS real confirmado por
PostgreSQL. La ruta sintética queda aislada en sandbox. El mapa de cliente se monta
únicamente para `picked_up`, `on_the_way` o `arrived` y desaparece al terminar.

## Verificación viva realizada

`npx supabase migration list --linked` confirmó remoto:

- Gate 1 `20260801020000` aplicado;
- Gate 2 `20260801040000` aplicado.

Consulta de contrato remoto, sin exponer IDs ni secretos, confirmó:

- `orders.revision` NOT NULL;
- `order_events.sequence` NOT NULL y único;
- triggers `orders_zz_bump_revision` y RPCs Gate 1 presentes;
- firma claim: `uuid, text, bigint, text, uuid`;
- firma GPS: `uuid, bigint, double precision, double precision, double precision,
  double precision, double precision, timestamp with time zone`;
- `start_rider_delivery` presente;
- replica identity full en orders/eventos;
- RLS GPS habilitado, cero policies raw y sin privilegios directos select/insert
  para `authenticated`;
- Realtime de orders presente; `rider_locations` continúa publicado pero no es una
  superficie de lectura del cliente;
- estado observado: un pedido `delivered`, uno `on_the_way`, un rider activo, un
  owner activo y cero filas GPS.

Pruebas negativas en staging, con la transacción sin inserción válida, rechazaron:

- latitud inválida con SQLSTATE `22023`;
- `captured_at` atrasado diez minutos con SQLSTATE `22023`.

No se publicó una coordenada válida desde SQL ni se usó GPS simulado como PASS.

## Concurrencia real pendiente

La verificación de dos riders concurrentes no pudo ejecutarse sin fabricar datos:
staging sólo tiene un rider activo y no tiene pedido `ready` elegible. No se inventó
un segundo rider, pedido ni coordenada. El contrato está cubierto estáticamente y
por pruebas locales, pero la carrera real de dos sesiones queda pendiente de dos
cuentas rider QA y un pedido staging autorizado.

## Moto G15

`adb devices -l` detectó el dispositivo solicitado:

- serial `ZY32LHS6PS`;
- modelo `moto_g15`;
- Android `15` / SDK `35`;
- dispositivo Android `lamu`.

No se abrió una URL rider real porque el worktree no contiene un `runtime-config.js`
de staging ni una URL HTTPS de frontend con la publishable key pública. Abrir una
URL inventada habría producido una prueba falsa. Queda pendiente el recorrido
físico: login rider, permiso preciso, claim, inicio, GPS real, segundo dispositivo,
bloqueo/desbloqueo y recuperación.

## Conclusión de auditoría

La arquitectura SQL, RLS, RPC, freshness, cliente MapLibre y recuperación de
foreground están implementadas y validadas localmente y contra el catálogo remoto
de staging. La certificación física y la carrera real de dos riders requieren datos
QA y URL HTTPS staging autorizados; no se presentan como observadas.

## Validacion ejecutada

- `npm run check`: PASS.
- `npm run migrations:validate`: PASS; 21 migraciones validadas, sin errores.
- `npm run catalog:images:verify`: PASS; 22 productos y 44 WebP demo verificados.
- `npm audit --audit-level=high`: PASS; 0 vulnerabilidades.
- `git diff --check`: PASS.
- Focales existentes: 93/93 PASS.
- Unitarios nuevos Gate 2: 7/7 PASS.
- E2E focales nuevos Gate 2: 2/2 PASS como contratos de navegador; no son PASS
  de GPS fisico ni de staging multiusuario.
- `npm test` en el worktree: 642 PASS, 1 FAIL; unica falla
  `tests/promotions.test.mjs:152`, `0 !== 800`.
- Exportacion limpia de `c6270589756214eac617515248e93a8e8819190b`: 636 tests,
  635 PASS y la misma unica falla `tests/promotions.test.mjs:152` (`0 !== 800`),
  por lo que la falla se documenta como preexistente.

## Archivos del Gate 2

- `supabase/migrations/20260801040000_rider_gps_tracking_gate2.sql`.
- `js/repositories/supabase_order_repository.js`.
- `js/production-operations.js`.
- `js/tracking/production_rider_gps.js`.
- `js/app.js`.
- `docs/real-rider-gps-supabase.md`.
- `tests/rider-gps-gate2.test.mjs`.
- `tests/e2e/rider-gps-gate2.spec.mjs`.
- `tests/production-rider-gps.test.mjs`.

No hubo commits: el Gate 2 queda intencionalmente listo para revision en el
worktree solicitado.
