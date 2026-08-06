# HANDOFF — TABA2, circuito de pedidos real

Fecha: 2026-08-06 · Worktree: `D:\1212\la-taba2-real-orders-ops` · Rama: `feature/taba2-real-orders-ops`

| | |
| --- | --- |
| Base | `6294a98` — *fix(mercadopago): close the checkout without depending on a webhook* |
| HEAD funcional | `eb36e0b` — *test(orders): certificar el circuito real contra staging*. Todo lo que se verifica más abajo corresponde a ese árbol. |
| Tip de la rama | este commit de documentación (`git log -1`) |
| Commits | 5 de código + los de este handoff, todos locales. Sin push, sin amend, sin merges ni cherry-picks. |
| Diff de código | 13 archivos, +1894 líneas, 0 borradas |
| Proyecto mutado | `la-taba-staging` (`ukxqbgswjlibmnjemrzd`) — sólo backend, Functions y migraciones |

> El commit `32331f3` quedó con un BOM al inicio del asunto por la codificación de
> `Set-Content` en PowerShell 5.1. Como la consigna prohíbe `amend`, se corrigió con un
> `revert` y un commit nuevo (`f37b707`) en vez de reescribir historia. De ahí los tres
> commits de documentación.

---

## Lo que estaba roto

Los cuatro defectos se midieron sobre la base real de staging antes de tocar nada.

**1. El stock se drenaba en silencio.** `expire_checkout_sessions` existía y cubría
exactamente el caso, pero **nadie la llamaba**: no había cron, ni trigger, ni worker. Medido:
4 sesiones `redirected` ya vencidas retenían 4 reservas activas con el stock descontado. Cada
comprador que abría Mercado Pago y no pagaba descontaba stock para siempre. Con 10 productos y
una expiración de 15 minutos, un día de tráfico deja el catálogo en cero sin haber vendido nada.

**2. No existía separación QA.** Ningún pedido llevaba marca de origen. LT-0033, LT-0034 y
LT-0035 llegaban al Panel indistinguibles de un pedido real, y la cola del rider los ofrecía
para reparto. Un piloto no puede despachar una moto a una dirección inventada porque alguien
corrió un E2E.

**3. La modalidad de pago era opcional.** 9 pedidos con `payment_method` NULL. `get_rider_queue`
calcula el monto a cobrar con `case when payment_method = 'cash' then total`, así que un pedido
sin modalidad llega a la moto sin decir si hay que cobrar. Y `'mercadopago'` era sólo texto: nada
ataba ese valor a un pago verificado.

**4. `pending`, `paid` y `expired` no eran observables.** El estado vivía repartido en tres
tablas con tres vocabularios. Un pago aprobado cuya finalización todavía no corrió — webhook
tardío, reintento del worker — no aparecía en ningún lado: el negocio ya tenía la plata y en
pantalla no había nada.

---

## Migraciones (8, todas aplicadas a `la-taba-staging`)

| Versión | Qué hace |
| --- | --- |
| `20260806160000_order_qa_origin_classification` | `orders.origin` y `checkout_sessions.origin`; clasificación automática por catálogo; backfill con evidencia; aislamiento del rider |
| `20260806170000_order_payment_modality_integrity` | `payment_method` NOT NULL + constraint; trigger diferido que exige intent verificado para Mercado Pago |
| `20260806180000_checkout_expiry_stock_recovery` | Cron `taba-checkout-expiry-sweep` cada minuto + `list_stock_reservation_alerts` |
| `20260806190000_operational_pipeline_projection` | `order_pipeline_state`, `checkout_pipeline_state`, `list_operational_pipeline`, `list_unfinalized_paid_checkouts` |
| `20260806200000_qa_orders_do_not_ring_the_panel` | El aviso de pedido nuevo de un pedido QA se cierra con su motivo |
| `20260806210000_manual_qa_reclassification` | `classify_order_as_qa`: sacar un pedido de la operación real sin borrarlo |
| `20260806220000_rider_canonical_claim_excludes_qa` | Guard de origen en `claim_delivery_order`, el claim canónico |
| `20260806230000_lock_down_classification_triggers` | Revoca el execute PUBLIC por defecto de las dos funciones de trigger |

### Decisiones que conviene entender antes de tocar esto

**La señal de QA sale del catálogo, no del navegador.** Un producto con
`catalog_origin in ('test_only','staging_only')` es un fixture de prueba deliberado. `demo_fixture`
**no** alcanza: es el catálogo de demostración comercial y marcarlo QA escondería pedidos legítimos.
En staging los 10 productos son no-comerciales, así que el corte fino importa: los `demo_fixture`
producen pedidos de **operación real**, que es lo que permitió certificar el circuito completo.

**La clasificación es de una sola dirección.** `production → qa` y nada la devuelve. Si se pudiera
volver, la marca no valdría nada.

**Reclasificar no mueve `revision`.** `bump_order_revision` quedó exento sólo para los tres campos
de clasificación; cualquier update que además toque un campo operativo conserva la semántica
original. Sin esto, el backfill habría invalidado la vista de quien estuviera operando.

**El claim canónico es `claim_delivery_order`.** La primera versión puso el guard en
`claim_available_rider_order`, que es la sobrecarga legacy: `20260802102000` le revocó el execute
justo para que nadie la llame. El guard real se agregó en `20260806220000`. Ambas quedan protegidas.

---

## Archivos fuera de `supabase/`

- `js/repositories/supabase_order_repository.js` — la bandeja del Panel pide `origin = 'production'`
  al backend; la exclusión no se hace filtrando después de traer todo.
- `scripts/certify-real-order-pipeline.mjs` — certificación viva (nuevo).
- `tests/order-qa-origin-migration.test.mjs` — 13 tests de invariantes de migración (nuevo).
- `tests/supabase-repository.test.mjs` — fixture con `origin` + test de que el Panel excluye QA.
- `package.json` — `npm run certify:orders:staging`.

No se tocó CSS, identidad visual, imágenes, textos comerciales, catálogo, combos, Cloudflare Pages
ni el worktree del otro agente.

---

## Pruebas

| Gate | Resultado |
| --- | --- |
| `npm test` | **1025/1025** (base: 1011; +14 nuevos) |
| `npm run test:e2e` | **196/196** — requirió `npx playwright install chromium firefox`, que faltaba en el worktree |
| `npm run test:webhook` | 12/12 |
| `npm run check` | passed |
| `npm run secrets:scan` | passed |
| `npm run migrations:validate` | aprobado |
| `npm run certify:orders:staging` | **47/47 contra la base real** |

### Qué prueba la certificación viva

No prueba SQL contra un archivo: le pide al backend desplegado que haga el recorrido completo y
comprueba cada invariante contra la base.

- **Compra real completa** — cliente → pedido único → Panel → aceptar/preparar/listo → rider ve,
  toma, retira, sale, llega → entrega con el código del cliente → `delivered`. Dirección, teléfono,
  envío y total completos; stock descontado; reintento del mismo `client_request_id` no duplica ni
  vuelve a descontar; una revisión atrasada no mueve nada; el segundo claim es no-op idempotente;
  un código de entrega incorrecto no cierra el pedido.
- **Aislamiento QA** — el pedido con fixture se clasifica solo, no entra a la bandeja, no suena, el
  rider no lo ve estando `ready` y no puede tomarlo ni sabiendo el código; la evidencia sigue
  consultable con `p_include_qa`.
- **Pago no falsificable** — marcar `mercadopago` sin intent verificado es rechazado por la base;
  los 3 pedidos Mercado Pago existentes tienen su intent `completed` + `approved`.
- **Ciclo de stock de Mercado Pago** — abrir el checkout reserva, no crea pedido, se ve `pending`;
  al vencer, el barrido devuelve el stock y la sesión queda `expired`.
- **LT-0030 protegido** — `arrived`, revision 11, rider asignado y sus 4 fixes de GPS, idénticos.

La certificación es fail-closed: sin `TABA_CERTIFY_CONFIRM` ni credenciales de servicio no hace
nada, y se niega a correr contra `la-taba-demo`. Al terminar retira sus propios pedidos.

---

## LT-0033, LT-0034, LT-0035 — clasificados, no borrados

Los tres quedaron `origin=qa`, motivo `qa_fixture_product`, con sus eventos intactos (3, 4 y 2
respectivamente) y un `order.origin_classified` que registra quién los clasificó y por qué. Salieron
de la bandeja del Panel y de la cola del rider; siguen consultables con `list_operational_pipeline(…,
p_include_qa => true)`.

El mismo criterio alcanzó a **LT-0030** (fixture de GPS, `staging_only`) y **LT-0036** (compra del
producto literalmente llamado *"QA TEST iPhone - compra de prueba"*).

### Estado final de staging

```
orders=50  order_items=53  order_events=338  checkout_sessions=26
payment_intents=26  rider_locations=4      (ninguna fila borrada)

origen:        production=3, qa=47
bandeja Panel: (vacía)
reservas huérfanas: 0        pagos verificados sin pedido: 0
cron: taba-checkout-expiry-sweep [* * * * *] · taba-payment-outbox-worker [30s]
medios de pago: cash=17, coordinate=20, mercadopago=3, qa_no_charge=10
```

Los 3 pedidos que siguen en `production` son LT-0005, LT-0006 y LT-0007 — todos terminales
(`cancelled`/`delivered`). Se los dejó deliberadamente: llevan nombres de personas reales sobre
catálogo de demostración y no hay evidencia dura de que sean QA. Ser conservador al llamar algo QA
es lo correcto; la invariante que importa es que **ningún pedido QA se trate como real**, y los
terminales no son operables.

---

## Riesgos de integración

1. **La bandeja del Panel ahora filtra por `origin`.** Cualquier otro lector de `orders` que
   alimente operación —otro worktree, un panel alternativo, un reporte— debe agregar
   `origin = 'production'` o va a mostrar pedidos de prueba. Los lectores de *evidencia* no deben
   filtrarlo.

2. **`payment_method` es NOT NULL.** Cualquier inserción directa de pedidos que hoy lo omita va a
   fallar. Las rutas del producto ya lo mandan siempre.

3. **El trigger diferido de Mercado Pago valida al COMMIT.** Un flujo que inserte un pedido con
   `payment_method='mercadopago'` y no ligue un `payment_intent` `completed` en la **misma
   transacción** va a fallar al cerrar, no al insertar. Es intencional:
   `finalize_paid_checkout_session` inserta el pedido antes de ligar el intent.

4. **Dos crons activos.** Si se restaura la base desde un dump, `cron.job` puede no venir incluido.
   Verificar que `taba-checkout-expiry-sweep` exista después de cualquier restore, o el stock vuelve
   a drenarse en silencio. `list_stock_reservation_alerts()` lo detecta.

5. **`bump_order_revision` fue redefinida.** Sigue avanzando la revisión en todo update operativo,
   pero si otra rama la redefine sin la exención de clasificación, reclasificar volverá a invalidar
   las vistas en curso.

6. **Los actores de certificación quedan desactivados, no borrados.** `auth.admin.deleteUser` falla
   porque son sujeto de eventos de auditoría — borrarlos destruiría evidencia. Quedan con
   `business_members.is_active = false` y baneados. Se acumulan de a 3 por corrida.

7. **Sin cobertura de webhook real de Mercado Pago en esta rama.** La recuperación de pago tardío se
   verificó por el lado del contrato (`list_unfinalized_paid_checkouts` en 0, worker con cron activo,
   los 3 pedidos MP con intent verificado), no disparando una notificación firmada nueva. El runbook
   `docs/implementation/mercadopago-staging-runbook.md` explica que en staging esa notificación se
   dispara a mano desde el panel de Mercado Pago.

8. **Playwright necesitaba `npx playwright install`.** El worktree no traía navegadores; sin eso el
   gate E2E falla entero por ejecutable ausente, no por regresión.

---

## Lo que no se tocó

Producción, ARCA (`services/arca-fiscal-bridge` sin cambios) y `la-taba-demo`
(`yakhtrkukqlgzvxuvhzs`, nunca conectado; la certificación se niega explícitamente a apuntarle).

---

TABA2_REAL_ORDER_PIPELINE_READY_FOR_PILOT
