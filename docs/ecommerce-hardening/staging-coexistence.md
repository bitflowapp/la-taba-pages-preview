# Convivencia en Staging con la línea de Caja Clara

Staging lo comparten dos líneas de trabajo: esta rama (endurecimiento del e-commerce) y la del libro de ventas de Caja Clara (`feat/caja-clara-sales-ledger`). Este documento es el contrato entre las dos: qué cambia para un comercio que ya existe cuando se aplican las migraciones de esta rama, qué se comprobó, y cómo se sale de cada regla sin que nadie toque los datos del otro.

Regla de esta rama: no se modifica ninguna fila de un comercio que no creó. Ni el modo del guardián, ni los topes, ni el vencimiento de pedidos del comercio de QA de Caja Clara se tocan desde acá.

## Orden de las migraciones

La migración pendiente de Caja Clara es `20261001030000_caja_clara_sales_ledger.sql`; las de esta rama empiezan en `20261001180000`. Si esta rama se aplica primero, el `db push` de la otra línea ve una versión local anterior a la última aplicada. No es un conflicto de contenido: se aplica con `supabase db push --include-all`.

Comprobado en local (PostgreSQL 17 con sustitutos de auth/storage/cron; no es Staging), con la migración de Caja Clara tal como estaba en su árbol de trabajo el 2026-10-02 (sha256 `b8cec509425bebc7…`):

| Orden | Resultado |
|---|---|
| Las dos líneas en orden de versión (la de Caja Clara antes que las de esta rama) | 191 de 191 migraciones aplican. Su prueba `caja_clara_sales_ledger_test` (187) y las suites que comparten objetos pasan: 6 archivos, 1.375 aserciones |
| Como quedaría Staging si esta rama entra primero (190 migraciones y después la de Caja Clara encima) | aplica sin errores. Su prueba (187) y las suites compartidas pasan: 6 archivos, 889 aserciones |

Ninguna función es redefinida por las dos líneas (comparado por nombre). Si eso cambia, la que se aplique última pisa a la otra: antes de integrar, repetir la comparación.

Las dos líneas editan `scripts/run-release-v5-db.mjs` en las mismas líneas (la lista de pruebas, el total de aserciones y la lista de carreras). Quien integre segundo vuelve a sumar el total: el runner exige el número exacto.

## Qué empieza a regir para un comercio que ya existe

| Regla | De dónde sale | Para el comercio de QA de Caja Clara (`la-taba-staging`) |
|---|---|---|
| Tope de pedidos por cliente (sin atender y cada 10 minutos) | valores del propio comercio | sin cambio: usa los suyos (5 y 20) |
| Tope por origen de red: 30 pedidos cada 10 minutos y 12 sin atender | valor por defecto nuevo | empieza a regir |
| Tope por comercio: 120 pedidos cada 10 minutos | valor por defecto nuevo | empieza a regir |
| Tope de 120 unidades en un pedido sin cobrar | valor por defecto nuevo | empieza a regir |
| Un pedido en efectivo sin atender se cancela solo y devuelve el stock | `abandoned_order_minutes` del propio comercio | el comercio ya tenía 120 minutos cargados: pasa a cumplirse |
| `authenticated` no escribe directo `stock`, `available` ni `is_active` de un producto | esta rama | el cliente de Caja Clara no hace ese PATCH (lee `businesses` y `business_members` por REST y opera por RPC) |
| Cancelar y rechazar un pedido piden `orders.cancel` del catálogo (dueño y encargado; el empleado no): `20261002050000`, decisión del dueño AUTHZ-04 | esta rama | **cambia**: el comercio tiene un empleado activo por `panel_web` que canceló 24 pedidos hasta el 2026-10-01 (lectura del 2026-10-03 con `docs/migrations/checks/20261002_ecommerce_hardening_preflight.sql`). Lo que cancele como empleado va a recibir 42501 `PERMISSION_REQUIRED: orders.cancel`, y no hay salida por comercio: el catálogo da permisos por rol y para toda la plataforma. **Por eso esta migración no se aplica en Staging sin acordarlo con esa línea** (ver `LA_TABA_AUTONOMOUS_STATUS.md`) |

Medido en Staging, en modo de sólo lectura, sobre los últimos 21 días de ese comercio: a lo sumo 7 pedidos en una ventana de 10 minutos y ningún pedido sin atender. Queda por debajo de todos los topes nuevos, y no hay ningún pedido que el vencimiento vaya a cancelar en su primera corrida.

## Cómo sale cada uno de una regla, sin tocar datos ajenos

Lo decide y lo ejecuta el dueño de cada comercio de QA, sobre su propia fila de `businesses`:

- **El guardián de admisión estorba una prueba de volumen.** `order_intake_guard_mode = 'monitor'` deja pasar todo y sigue anotando lo que habría frenado; `'enforce'` es el valor por defecto. O subir los topes del comercio (`order_ip_rate_limit_per_10_minutes`, `max_pending_orders_per_ip`, `order_business_rate_limit_per_10_minutes`, `max_units_per_unpaid_order`).
- **No se quiere que los pedidos de prueba venzan.** `abandoned_order_minutes = null`.
- **Un comercio marcado `qa_fixture`** recibe techos altos al aplicar `20261001180000` (2.000 por origen, 5.000 por comercio). El de Caja Clara no lleva esa marca.

## Qué mirar antes y después de aplicar

`docs/migrations/checks/20261001_ecommerce_hardening_preflight.sql` (sólo lectura) lista, por comercio, a quién le cambia algo. Se corre antes y después, y se guardan las dos salidas.

`docs/migrations/checks/20261003_unverified_checkout_preflight.sql` (sólo lectura) cubre `20261003090000`: al aplicarla, un
checkout que llegó a Mercado Pago dentro de las 48 horas anteriores y sigue sin verificar (sin pago del proveedor y sin un vacío
concluyente, o con un pago pendiente o en revisión) ya no ve su alerta CHECKOUT_PROVIDER_UNVERIFIED cerrarse sola: la cierra el
resultado del proveedor o el dueño / un encargado con su nota. En Staging, donde el vendedor TEST se reconecta seguido, eso puede
dejar alertas críticas de checkouts abandonados de esas 48 horas: la consulta U1 dice cuántas antes de aplicar. Lo anterior a la
marca de agua (el momento de aplicar menos 48 horas) no abre alertas y lo sigue mostrando `scripts/payments/reconcile-payments.mjs`.
