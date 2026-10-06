# E2E físico de producción — La Taba + Caja Clara + Rider (2026-10-06)

Un pedido real nació en la tienda de producción, lo recibió Caja Clara sin que nadie la tocara, lo preparó el
comercio, lo ofreció a un repartidor real, el repartidor lo llevó en la calle con GPS real, el cliente lo siguió en
su teléfono, el código equivocado se rechazó, el correcto lo entregó y el efectivo quedó registrado por el comercio.
Todo con las tres aplicaciones reales y el backend real, sin RPC directas, sin SQL de estado, sin mocks.

- **Pedido:** `LT-0004` · Coca-Cola 2,25 L × 1 · $ 5.900 · efectivo · envío
- **Tienda:** https://la-taba.pages.dev (v141, `main` `5acecb44`) · backend `wwcpogltfgzgkrlilbcd`
- **Caja Clara:** WPF en la PC real del local, conectada a producción (PR bitflow-inspecciones #38)
- **Rider:** `com.lataba.rider.production` en un Moto G15 real, firmado con la clave de producción (PR #137)
- **Resultado máquina:** [`result.json`](result.json) · **línea de tiempo:** [`timeline.json`](timeline.json)

> El repositorio es público. Este dossier no lleva nombres, direcciones, teléfonos, correos, coordenadas, códigos de
> entrega, tokens ni identificadores de personas: en las capturas esas zonas están tapadas y en la línea de tiempo las
> personas son `customer-1`, `business-1`, `rider-1`. La evidencia cruda (107 capturas, grabación de pantalla de 81
> min, respaldos `pg_dump`) queda fuera del repo porque contiene datos personales y la terminal del operador.

## Informe final

| Campo | Valor |
|---|---|
| PRODUCTION_SCHEMA_PARITY | PASS (159 = repo; la 159 entra a `main` con este PR) |
| PENDING_MIGRATIONS_AFTER | 0 |
| REQUIRED_RPCS_PRESENT | PASS |
| STOREFRONT_PRODUCTION | PASS |
| CAJA_CLARA_PRODUCTION_CONNECTION | PASS |
| RIDER_PRODUCTION_BUILD | PASS |
| RIDER_SESSION | PASS |
| RIDER_HEARTBEAT | PASS |
| REAL_ORDER_CREATED | PASS |
| PUBLIC_CODE | LT-0004 |
| ORDER_ID | fc2d4711-87c5-4b5b-b91f-9b9a956ac0df |
| PRODUCT | Coca-Cola 2,25 L × 1 |
| PAYMENT_METHOD | cash |
| ORDER_TO_CAJA | PASS |
| ORDER_TO_CAJA_LATENCY_MS | 1320 |
| CAJA_ACCEPT / CAJA_PREPARING / CAJA_READY | PASS / PASS / PASS |
| RIDER_OFFER / RIDER_CLAIM / RIDER_PICKUP / RIDER_ON_THE_WAY | PASS / PASS / PASS / PASS |
| LIVE_GPS | PASS |
| NETWORK_LOSS_RECOVERY | PASS |
| RIDER_COLD_START_ONLINE / RIDER_COLD_START_OFFLINE | PASS / PASS |
| CUSTOMER_TRACKING | PASS (con dos defectos de presentación, corregidos en el PR #139) |
| WRONG_DELIVERY_CODE_REJECTED / CORRECT_DELIVERY_CODE | PASS / PASS |
| DELIVERED_EXACTLY_ONCE | PASS |
| CASH_PAYMENT_FLOW | PASS |
| STOCK_CONSISTENCY / RESERVATIONS_FINAL | PASS / PASS |
| DUPLICATE_ORDER / DUPLICATE_TRANSITIONS | 0 / 0 |
| STUCK_OUTBOX | 0 (ver «Colas sin consumidor») |
| OPEN_STOCK_CONFLICTS | 0 |
| CUSTOMER_FINAL_STATE / CAJA_FINAL_STATE / RIDER_FINAL_STATE | PASS / PASS / PASS |
| P0_OPEN / P1_OPEN / P2_OPEN / P3_OPEN | 0 / 0 / 4 / 10 |
| CASH_DELIVERY_PRODUCTION_READY | **YES** |
| READY_FOR_REAL_CUSTOMERS | **NO** — falta lo de «Qué falta para decir YES» |

## Línea de tiempo de LT-0004 (UTC)

Medida por un observador de **sólo lectura** sobre producción (consulta cada ~1 s, transacción `read only`).

| Hora | Qué pasó | Quién |
|---|---|---|
| 03:21:33.521 | El cliente confirma en la tienda. Stock 24 → 23 | cliente, teléfono propio |
| 03:21:34.842 | La tarjeta aparece sola en Caja Clara y suena el aviso (1,32 s) | Caja Clara |
| 03:22:32 | Aceptado | Caja Clara |
| 03:22:46 | En preparación | Caja Clara |
| 03:23:01 | Listo | Caja Clara |
| 03:23:35 | Ofrecido al repartidor | Caja Clara |
| 03:23:59 | El repartidor acepta (oferta `pending` → `accepted`, versión 1 → 2) | Rider |
| 03:24:35 | Retirado | Rider |
| 03:24:54 | En camino | Rider |
| 03:25:05 | Primer fix GPS publicado | Rider |
| 03:25:41 → 03:27:33 | Sin red + app cerrada a propósito: arranque en frío sin conexión, luego con conexión | Rider |
| 03:51:11 | Llegó | Rider |
| 03:51:24 | Código equivocado: `incorrect_code`, intentos fallidos 0 → 1, sin bloqueo | Rider |
| 03:52:23 | Código correcto: entregado, handoff confirmado una vez | Rider |
| 03:52:25 | Las 139 ubicaciones del reparto ya no están: se purgan al entregar | backend |
| 04:36:28 | El comercio registra el efectivo recibido ($ 5.900, efectivo) | Caja Clara |

GPS del reparto: 139 fixes, 139 pedidos distintos (cero duplicados), intervalo mediano 10 s, p90 12 s. Dos huecos:
112 s (la prueba de arranque en frío sin red) y 64 s durante el recorrido. Después de los dos el envío siguió solo.

## Qué hubo que arreglar para llegar acá

Cada uno con causa, arreglo y una prueba que fallaba antes. Del 1 al 6, además, corridos de verdad con LT-0004; el 10 se verificó en vivo; del 7 al 9 y el 11 falta verlos con un pedido real.

| # | Eslabón | Defecto | Arreglo |
|---|---|---|---|
| 1 | backend | Producción estaba 30 migraciones atrás (128/158): faltaban el contrato `pos_*`, el cobro manual, la disponibilidad compartida del Rider, el cierre de entrega del comercio | Ensayo real (respaldo, restauración sin red, atomicidad, pgTAP, huella contra base desde cero) y aplicación verificada adentro de la transacción. PR #138 |
| 2 | Caja Clara | No se conectaba a la tienda de producción: exigía `Object.freeze(` en `runtime-config.js` | Parser estricto de las dos formas generadas. bitflow-inspecciones #38 |
| 3 | Caja Clara | Cerrarla con La Taba conectada dejaba un proceso sin ventana con el candado de instancia única | `OnExit` sin deadlock; prueba con contexto congelado; cierre medido en 107 ms |
| 4 | Rider | El build rechazaba el backend de producción y no había firma de producción | Destino `production` con su propio firmante; el piloto nunca firma producción. PR #137 |
| 5 | Rider | Con una entrega activa, sin red y en arranque en frío la app no mostraba nada (P2) | Tablero cifrado en el teléfono (Keystore AES-GCM) con tarjeta «información guardada, no es el estado actual» |
| 6 | backend + Caja Clara | Un envío entregado en efectivo no se podía cobrar: `pos_list_orders` dejaba de ofrecer `confirm_payment` al entregar | Migración `20261006050000` (159), ensayada y aplicada; Caja Clara muestra «Cobrar en efectivo» en Entregados |
| 7 | Rider | El repartidor no veía que tenía que cobrar | v6: «Cobrar en efectivo: $ 5.900», productos, referencia y notas |
| 8 | Caja Clara | Un entregado con cobro pendiente decía «para poder entregarlo» | Texto según el estado (1.1.5) |
| 9 | tienda | Volver al seguimiento repetía el recorrido viejo; la moto parpadeaba | PR #139, desplegado en v142 (ver abajo) |
| 10 | tienda | `/cuenta/`: la contraseña se escribía invisible (1,07:1) y un error la borraba | PR #139, desplegado en v142 y verificado en vivo |
| 11 | Caja Clara | Un envío entregado con el efectivo sin registrar desaparecía del tablero con «Entregados y cancelados de hoy» apagado, y a la medianoche aunque estuviera prendido | Queda en «En camino» con «Cobrar en efectivo» hasta registrarlo (1.1.6) |

### Semántica del efectivo

Entregar no es cobrar. El repartidor cobra en la puerta (la app se lo dice con el monto). El comercio registra el
efectivo recibido desde Caja Clara (`confirm_manual_order_payment`): queda quién, cuándo, el monto y el medio en
`order.manual_payment_confirmed`, es idempotente (un segundo registro no duplica) y no ocurre solo al entregar.

### Seguimiento del cliente (PR #139)

El cliente siguió al repartidor en la calle y reportó dos cosas, las dos reproducidas y corregidas:

- **Al volver a la pestaña la moto aparecía donde había estado y caminaba despacio.** En segundo plano el navegador
  estrangula los timers; las lecturas espaciadas entraban como «cadencia» al motor de movimiento. Ahora un hueco
  > 30 s no cuenta como cadencia, y al volver (`visibilitychange`/`pageshow`) el próximo fix se planta sin animar.
- **La moto parpadeaba.** Con el corte de «en vivo» en 15 s y la cadencia real (10–12 s + consulta cada 5 s + hasta
  3,9 s de publicación) el estado alternaba en cada ciclo; además cada lectura saca el lienzo del DOM y reinicia la
  animación CSS del pulso. Corte en 25 s y pulso anclado al reloj del documento.

## Despliegue v142 (2026-10-06 16:41Z)

El PR #139 se mergeó (`fe49d229`), el CI canónico de `main` pasó sobre ese SHA exacto y `deploy-production.yml`
lo publicó (corrida 37497573486: no retroceder, CI verde del SHA, artefacto, Cloudflare Pages y smoke en vivo).
Verificación independiente contra https://la-taba.pages.dev, con el estado anterior medido antes como control:

| | v141 (antes) | v142 (después) |
|---|---|---|
| `version.json` / `CACHE_NAME` | `5acecb44` · v141 | `fe49d229` · `la-taba-runtime-v142-tracking-resume` |
| Umbral «en vivo» | 15 s | 25 s |
| Motor de movimiento con `resume()` | no | sí |
| Pulso tras 5 redibujos seguidos del lienzo (código publicado) | — | desfase 0 ms en los 5 |
| `/cuenta/`: tinta del campo sobre su fondo | 1,07:1 | 13,13:1 |
| `/cuenta/`: un error borra lo escrito | sí | no; contador «Llevás 7 de 12 caracteres.» |

## Clasificación de las 30 migraciones aplicadas

Tenían que ir juntas y en orden: el historial de producción era un prefijo exacto del repo y las pendientes un sufijo
sin huecos. Se aplicaron como un solo bloque (sha256 `470e1216…`), con los valores previos de pedidos, productos,
negocio, eventos e imágenes verificados idénticos **dentro** de la transacción antes del commit.

| Migración | Clase |
|---|---|
| `20260919120000_business_self_delivery_and_finished_today` | REQUIRED_FOR_E2E (reparto propio y «entregados hoy» de Caja Clara) |
| `20260920120000_customer_address_json_declared_neighborhood` | DEPENDENCY |
| `20260920130000_saved_address_neighborhood_order_contract` | DEPENDENCY |
| `20260923064927_commercial_pilot_manual_payment` | REQUIRED_FOR_E2E (cobro en efectivo) |
| `20260923071557_pilot_rider_shared_availability` | REQUIRED_FOR_E2E (presencia del repartidor) |
| `20260924200000_revision_conflicts_answer_409` | DEPENDENCY (Caja Clara y Rider esperan 409) |
| `20260925085000_pause_keeps_ordering_configuration` | UNRELATED |
| `20260925090000_cp_qa_window_and_private_product_columns` | RISKY (cambia privilegios de columnas; verificado `unit_cost`/`verified_by` cerradas) |
| `20260925170000_mercadopago_offered_only_with_connected_seller` | UNRELATED (MP es gate aparte) |
| `20260925220000_mercadopago_seller_cannot_charge_alert` | UNRELATED |
| `20260925223000_mercadopago_operator_switch_per_business` | UNRELATED |
| `20260926160000_local_print_agent` | UNRELATED |
| `20260927004045_catalog_pending_stock_and_cp_drafts` | DEPENDENCY (catálogo de Caja Clara) |
| `20260927004347_catalog_draft_juice_taxonomy` | UNRELATED |
| `20260927005628_cp_published_requires_approved_image` | RISKY (regla de publicación; ningún producto cambió de estado) |
| `20260927175058_catalog_image_storage_pipeline` | UNRELATED |
| `20260928150000_store_opening_readiness` | DEPENDENCY |
| `20260928160000_publish_sets_merchant_intent` | DEPENDENCY (publicación desde Caja Clara) |
| `20260928170000_identity_and_alcohol_invariants_null_safe` | DEPENDENCY (identidad) |
| `20260928180000` … `20260928180600` (7 del núcleo fiscal) | RISKY por tamaño, UNRELATED al E2E (ARCA apagado); pgTAP fiscal PASS |
| `20260928180700_commercial_fiscal_policy` | UNRELATED |
| `20260928180800_commercial_order_fiscal_adapter` | RISKY (toca pedidos); ejercida por LT-0004 y pgTAP |
| `20260929120000_caja_clara_pos_integration` | REQUIRED_FOR_E2E (contrato `pos_*`) |
| `20261005210000_products_internal_columns_private` | DEPENDENCY (seguridad) |
| `20261006050000_pos_confirm_payment_after_delivery` (la 159, aparte) | REQUIRED_FOR_E2E (cobrar después de entregar) |

ALREADY_EFFECTIVE_BUT_UNREGISTERED: ninguna. El bloque aplicó sin conflictos de objetos existentes. Diferencias con la
base construida desde cero, todas previas y fuera del bloque: privilegios de `service_role`, 16 secuencias y 6
funciones de Mercado Pago (P3).

Ensayos y recibos: [`backend-readonly-snapshots/`](backend-readonly-snapshots/). El último ensayo, **después** de
aplicar todo, restauró una copia nueva de producción (115 tablas, 10.875 filas, 0 errores) y pasó **919 aserciones
pgTAP en 31 archivos**.

## Seguridad (revalidada en producción)

Por el camino real (PostgREST + GoTrue), sin escribir datos de negocio: como visitante sin sesión y como identidad
anónima de visita. Resultado: **sin hallazgos**.

- Las 103 tablas de `public` tienen RLS; ninguna tabla privada devuelve filas. `anon` tiene privilegio de lectura
  sobre `orders`/`order_items` y RLS no deja ver ninguna.
- `unit_cost` y `verified_by` no se pueden leer (401/403); el catálogo de tienda sí.
- El seguimiento de un pedido ajeno sin su token, o con un token inventado, devuelve `null`.
- 12 RPC de personal y repartidor (`pos_list_orders`, pagos, ofertas, disponibilidad, miembros, código de entrega,
  recuperar acceso al seguimiento, confirmar código, reclamar pedido, publicar ubicación) responden 403 a una visita.
  Las de escritura apuntaron sólo a LT-0004, ya entregado: siguió en revisión 13, 1 token, 12 eventos.
- Sin auto-membresía y sin insertar pedidos por fuera del RPC.

Aislamiento entre negocios y sesión de otra PC: pgTAP sobre la copia de producción, `caja_clara_pos_integration`
(«la sesión de otra PC no puede presentarse como la caja 1», «una sesión revocada queda afuera», «la caja del
comercio B no lee el comercio A», «un rider no lee la bandeja de la caja»). En producción, `pos_list_orders` con un
`device_key_hash` no registrado responde «terminal no autorizada».

## Hallazgos abiertos

**P2 (4)**

1. Seguimiento: recorrido viejo al volver y parpadeo — **corregido y desplegado (v142)**; abierto hasta que el cliente lo confirme en su teléfono.
2. Caja Clara: el efectivo de un pedido online registrado en Caja Clara no entra al arqueo de la caja.
3. CI de bitflow-inspecciones bloqueado por facturación de GitHub: el PR #38 no tiene CI; se validó local (325/325) y en la PC real.
4. La Edge Function `team-invitation` no está desplegada en producción: invitar personal por correo no funciona (la solicitud de acceso sí).

**P3 (10)**

1. Caja Clara dice «Repartidor sin conexión» en un pedido ya entregado (lee sólo la presencia).
2. La oferta en el Rider muestra «Zona:» vacía.
3. «Pausado» y «Fuera de turno» no son estados distintos del backend (hoy: Disponible / No disponible / En entrega).
4. 16 secuencias con privilegios de `anon` (previo).
5. `pos_list_orders` sólo trae 14 días: un pedido viejo abierto no aparece en Caja Clara.
6. `notification_outbox` y `delivery_outbox` no tienen consumidor en producción y acumulan filas desde agosto.
7. Caja Clara muestra «Sincronización: requiere revisión» por su nube propia no vinculada (ruido, no es La Taba).
8. `tracking-terminal-expiry` falla en el host Windows también sobre `main` (en CI Linux pasa).
9. Caja Clara a 1366×768: con «Entregados y cancelados de hoy» prendido, la columna «Entregados» queda cortada ([captura 08](screenshots/08-caja-clara-columna-entregados-cortada-1366.png)). Era P2 mientras ahí estaba el cobro pendiente; desde la 1.1.6 el cobro vive en «En camino».
10. `campaigns › fuera de pantalla` en WebKit de CI falló en 3 de 5 corridas del 2026-10-06, en PR sin cambios de campañas (localmente 5/5). En CI la pieza siguió «en vivo» fuera de pantalla varios sondeos y después el presupuesto de cuadros la dejó estática. Con la CPU de Chromium 16× más lenta la prueba falla igual; pero forzando un defecto real (seguir animando fuera de pantalla) WebKit muestra la misma firma, así que «CI lento» y «WebKit no pausa a tiempo» no se pueden distinguir con estos datos. No se suavizó la prueba (un parche que aceptaba el estático dejaba pasar ese defecto en WebKit): queda abierto para investigar en un iPhone.

## Capacidad (laboratorio con copia de producción)

`capacity-30.mjs` bloquea a propósito el ref de producción y el staging de Supabase ya no existe, así que corrió contra
un stack **local** de Supabase (PostgREST, GoTrue y Realtime reales, 127.0.0.1) con las 159 migraciones y una copia de
los datos de producción del respaldo de 05:38Z. El arnés corrió igual que siempre salvo tres cosas: destino local,
repartidores QA dados de alta por solicitud y aprobación del dueño, y el mínimo general cuando la cobertura no se
exige (como en producción). Resultado: **PASS** ([`capacity-local-lab.json`](backend-readonly-snapshots/capacity-local-lab.json)).

| Prueba | Resultado |
|---|---|
| 20 visitas con realtime, 10 carritos, 8 pedidos casi simultáneos | 631 pedidos HTTP, 0 errores, p95 44 ms; realtime 20/20 |
| Doble clic en «Confirmar» | un solo pedido |
| Reintento tras perder la respuesta | el mismo pedido |
| Carrera por las últimas unidades | exactamente un ganador; el otro rechazado por el CHECK de stock |
| Dos pestañas aceptan el mismo pedido | una sola transición; la otra recibe 409 |
| Cobro en efectivo dos veces a la vez + con otra clave | 1 evento de cobro; repetición idempotente; `already_confirmed` |
| Doble cancelación | el stock vuelve una sola vez (13 de 13) |
| Oferta disputada entre dos repartidores | un solo repartidor asignado |
| 6 entregas con 3 repartidores | 6/6; código equivocado rechazado; doble confirmación idempotente; 6 handoffs |
| Seguimiento del cliente | todos ven «entregado»; el de la carrera ve «cancelado» |
| Visitas anónimas leyendo pedidos | 0 filas |
| Integridad (SQL directo) | 0 duplicados, 1 entrega por pedido, stock 24 → 23 con 1 vendido en cada producto, nada negativo, ningún repartidor ocupado al final |

El arnés reportó 2 «P0» y 1 «P1» que son falsos positivos del laboratorio: en una base construida desde cero
(mínimo privilegio) `service_role` no puede leer `orders`, `order_events` ni `products`, así que sus lecturas de
integridad y su limpieza fallaron con 42501. Lo que esas lecturas debían comprobar se verificó por SQL directo.

## Qué no se corrió

- **Venta de mostrador sin conexión** en Caja Clara: bloquear la salida de `CajaClara.exe` pide una regla de firewall
  con administrador, y la venta mueve caja y stock reales.
- **Video corto publicable.** La grabación de la PC (81 min, sha256 `3658aeec…`) muestra la terminal y la tarjeta con
  datos del cliente; queda privada. La grabación del teléfono no se pudo hacer. Las capturas tapadas cubren cada paso.
- **Mercado Pago**: gate aparte, sin autorización para un pago real.
- **Cobro en el Rider v6 con un pedido real**: verificado por pruebas unitarias; falta verlo en el teléfono.

## Qué falta para decir READY_FOR_REAL_CUSTOMERS = YES

1. Que el cliente confirme en el teléfono que el seguimiento ya no repite el recorrido ni parpadea (v142 ya está en producción).
2. Venta de mostrador sin conexión con reconciliación posterior.
3. Decidir el arqueo del efectivo online en Caja Clara.

## Capturas

Datos personales tapados. La dirección del local es pública.

| | |
|---|---|
| [00](screenshots/00-caja-clara-aviso-pedido-nuevo.png) | Aviso de Windows de Caja Clara: pedido nuevo, sin intervención |
| [01](screenshots/01-caja-clara-aceptado.png) | Aceptado |
| [02](screenshots/02-caja-clara-ofrecido-al-repartidor.png) | Listo y ofrecido al repartidor |
| [03](screenshots/03-rider-oferta.png) | La oferta en el Rider de producción |
| [04](screenshots/04-caja-clara-en-camino.png) | En camino, visto desde la caja |
| [05](screenshots/05-rider-en-camino.png) | En camino, visto desde el Rider |
| [06](screenshots/06-rider-sin-red-arranque-en-frio-P2.png) | Arranque en frío sin red con la entrega activa (P2 corregido) |
| [07](screenshots/07-caja-clara-entregado-y-cobrado.png) | Entregado y cobrado en efectivo |
| [08](screenshots/08-caja-clara-columna-entregados-cortada-1366.png) | Hallazgo P2: columna cortada a 1366×768 |
| [09](screenshots/09-caja-clara-stock-24-a-23.png) | Stock 23 después de la venta |
| [10](screenshots/10-rider-libre-tras-entrega.png) | Rider libre después de entregar (0/3) |
