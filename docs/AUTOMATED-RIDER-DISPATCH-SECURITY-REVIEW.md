# Security review: auto-dispatch de Riders

Alcance: el auto-dispatch agregado en esta rama. Backend
(`20260811100000`, `20260811101000`, `20260811102000`), Panel
(`js/business/business-dispatch-panel.js`, `js/repositories/supabase-dispatch-repository.js`)
y Rider (`feature/taba2-rider-shifts-dispatch`).

Fuera de alcance: contratos ya certificados que esta rama no toca —tracking
publico, mapa, checkout, fiscal— y todo lo que vive en `main` desde antes.

Fecha de la medicion: 2026-08-11. Base: PostgreSQL 17.6 efimero con las 76
migraciones del repo aplicadas.

## 1. Modelo de amenaza

PostgREST expone el esquema `public` al rol `authenticated`. Cualquier sesion
autenticada —cliente, Rider de otro negocio, staff de otro negocio— puede
invocar cualquier funcion con `grant execute` a `authenticated`, con los
argumentos que quiera. `business_id`, `rider_user_id`, `offer_id` y `order_id`
son todos controlados por quien llama.

De ahi que la unica defensa real sea la que esta adentro de la funcion. Nada se
apoya en que el cliente mande el argumento correcto.

Actores considerados:

- **Rider legitimo del negocio**, que intenta operar sobre otro Rider.
- **Rider o staff de otro negocio**, que intenta leer o mover un negocio ajeno.
- **Usuario autenticado sin membresia**, es decir cualquier cliente registrado.
- **Rider con la app modificada**, que puede saltear toda validacion local.

## 2. Superficie expuesta

Solo estas funciones tienen `grant execute` a `authenticated`:

Rider: `get_rider_operational_state`, `rider_work_now`, `rider_start_shift`,
`rider_pause_shift`, `rider_resume_shift`, `rider_end_shift`,
`rider_shift_heartbeat`, `accept_rider_dispatch_offer`,
`reject_rider_dispatch_offer`.

Panel: `get_business_dispatch_control`, `schedule_rider_shift`,
`configure_rider_dispatch_profile`, `configure_business_auto_dispatch`,
`manual_override_dispatch`.

Todo lo demas —ranking, creacion de ofertas, sweep, worker, helpers de lock,
proyeccion pre-claim, receipts— es interno y no tiene grant. `anon` no alcanza
nada.

Verificado sobre la base:

- las 12 tablas nuevas tienen RLS activo y **cero** privilegios directos
  (`select`, `insert`, `update`, `delete`) para `authenticated`. La verdad de
  dispatch se toca solo por RPC;
- el esquema `private` no es alcanzable ni por `authenticated` ni por `anon`;
- `run_rider_dispatch_cycle` es `service_role` unicamente: una sesion de
  navegador no puede correr el worker;
- las 45 funciones de dispatch tienen `search_path` explicito. Ninguna
  `SECURITY DEFINER` queda expuesta a redefinicion de nombres por el llamante.

## 3. Bypass legado cerrado

El hallazgo previo mas serio: `change_order_status(uuid,text,text)` conservaba
un grant a `authenticated`, y `transition_order(uuid,bigint,text)` delega en
ese helper. Con cualquiera de los dos, un Rider podia saltar de `ready` a
`on_the_way` autoasignandose, sin pasar por el claim canonico, sin CAS y sin
idempotencia.

Revocar solo el primero no cerraba nada. Esta rama revoca **ambas firmas** para
`authenticated`. El Panel sigue operando por el wrapper idempotente de cuatro
argumentos, que no cambia.

## 4. Privacidad previa al claim

La oferta llega al Rider antes de que exista contrato con el pedido. Su
proyeccion (`private.dispatch_safe_payload`) es deliberadamente igual en forma
a `get_rider_queue`, que ya estaba certificada: nombre y direccion del
**negocio**, barrio del destino, distancias, cantidad de bultos, metodo de pago
y monto a cobrar si es efectivo.

No incluye —y esta verificado en la corrida— nombre del cliente, telefono,
direccion exacta, notas de puerta ni coordenadas. La UI del Rider dice
explicitamente que la direccion exacta se habilita al aceptar, y el destino no
es navegable hasta entonces.

Despues del claim se reutiliza el payload Rider ya certificado. Esta rama no lo
modifica.

En el Panel, `get_business_dispatch_control` clasifica en vez de exponer: el
estado de presencia sale como `fresh` / `stale` / `missing` y la precision como
`acceptable` / `coarse` / `missing`. Las coordenadas viven en
`private.rider_dispatch_presence` y no cruzan ese limite. El timeline expone
`event_type`, `occurred_at`, `reason_code` y `actor_role`, nunca el `detail`
completo.

## 5. Autorizacion, medida en vez de razonada

Doce intentos hostiles contra la base, cada uno con el actor equivocado y
argumentos elegidos para que funcionen si la funcion no valida:

| Intento | Actor | Resultado |
| --- | --- | --- |
| leer el control de dispatch | tercero sin membresia | rechazado 42501 |
| leer el control de dispatch | owner de otro negocio | rechazado 42501 |
| override manual sobre negocio ajeno | owner de otro negocio | rechazado 42501 |
| aceptar la oferta de otro Rider | Rider del mismo negocio | rechazado P0002 |
| rechazar la oferta de otro Rider | Rider del mismo negocio | rechazado P0002 |
| pausar el turno de otro Rider | Rider del mismo negocio | rechazado P0002 |
| latir por el turno de otro Rider | Rider del mismo negocio | rechazado P0002 |
| encender auto-dispatch | Rider | rechazado 42501 |
| programar un turno | Rider | rechazado 42501 |
| configurar un perfil de dispatch | Rider | rechazado 42501 |
| autoasignarse por override | Rider | rechazado 42501 |
| abrir turno de Rider | tercero sin membresia | rechazado 42501 |

Despues de los doce, el pedido sigue sin dueño. La verificacion vive en
`supabase/tests/rider_dispatch_runtime.local.sql` y corre en cada gate.

## 6. Integridad bajo concurrencia

Cuatro carreras reales con dos sesiones PostgreSQL y barrera temporal, no
simuladas:

1. **doble tap** del mismo Rider sobre la misma oferta con claves distintas;
2. **oferta vencida contra vigente**: el cliente de A no se entero de que su
   lease expiro y acepta mientras B acepta la suya;
3. **accept contra override manual** del negocio;
4. **accept contra el sweep** de expiracion, con el lease venciendo dentro de
   la ventana de la carrera.

En las cuatro: un unico ganador, un unico `dispatch_job`, una unica oferta
aceptada y a lo sumo un asiento `estimated`. El perdedor recibe siempre un
receipt estructurado (`offer_not_available`, `already_accepted`,
`stale_revision`), nunca se clasifica por texto de error.

La carrera 3 encontro un defecto real: `accept` tomaba oferta -> job y el
override job -> oferta, y las dos sesiones se trababan (`deadlock detected`).
Los invariantes se sostenian porque PostgreSQL aborta un lado, pero el orden
divergente era un bug. Hay ahora un unico orden de locks, con advisory por job
antes de cualquier fila, y la carrera devuelve un resultado limpio.

## 7. Riesgos aceptados y deuda

- **Deadlock cruzado con mutaciones externas del pedido.** Una cancelacion del
  Panel sostiene la fila de `orders` y dispara el trigger de ciclo de vida,
  mientras un accept sostiene la oferta y va hacia el pedido. PostgreSQL lo
  detecta y revierte un lado; ningun invariante se rompe, pero el Rider ve un
  error en vez de un receipt. Cerrarlo requiere que cada RPC de estado de
  pedido tome primero el advisory del job.
- **`is_mock` del cliente.** El Rider Android rechaza localmente una ubicacion
  mockeada y por eso siempre manda `p_is_mock = false`. Un cliente modificado
  podria mandar coordenadas falsas con `is_mock = false`. El servidor no puede
  distinguirlas: valida precision, antiguedad y ventana temporal, no
  autenticidad del GPS. Es una limitacion conocida del modelo, no de esta
  implementacion.
- **Auto-dispatch sigue apagado.** `auto_dispatch_enabled = false` y
  `qa_fixture_only = true` son el estado inicial y el rollback. Habilitar
  produccion es una decision operativa explicita, con motivo auditado.
- **Borrado de pedidos.** `dispatch_events` es append-only y referencia
  `orders` con `on delete cascade`, asi que un pedido con historial de dispatch
  ya no se puede borrar fisicamente. En produccion los pedidos se cancelan, no
  se borran, pero conviene saberlo antes de escribir cualquier limpieza.

## 8. Conclusion

No quedan hallazgos abiertos de severidad alta o media dentro del alcance. La
superficie expuesta es la minima, la autorizacion esta medida contra actores
hostiles, la privacidad previa al claim esta verificada, y el bypass legado que
motivo buena parte de este trabajo esta cerrado en sus dos firmas.
