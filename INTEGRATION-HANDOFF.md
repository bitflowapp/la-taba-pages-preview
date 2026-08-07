# INTEGRATION-HANDOFF — TABA2, RC única de piloto

Worktree de integración aislado, rama `release/taba2-pilot-integration`.
Todo local: sin push, sin `amend`, `reset`, `clean`, `stash` ni `git add .`.

## 1. HEADs

| | |
| --- | --- |
| Operaciones | `feature/taba2-real-orders-ops` → **`aed0293c32d5cbf5a4599e5eb4f46033192bb84e`** |
| Comercial | `feature/taba2-commercial-storefront` → **`6dd05655a491897037af84a77808e7680bb50401`** |
| Ancestro común | `6294a989f67aada984f66cc2312142db63a563a0` — *fix(mercadopago): close the checkout without depending on a webhook* |
| Base del worktree | el mismo `6294a98` |
| HEAD final | ver `git rev-parse HEAD`; la entrega es `git log --oneline 6294a98..HEAD` |
| Fuentes | **intactas**: ninguna de las dos ramas fue movida ni tocada |

Las dos ramas divergen de un ancestro reciente —10 commits Operaciones, 14
Comercial— así que la integración es acotada y auditable, no una fusión de dos
historias largas.

## 2. Conflictos resueltos

**Un solo conflicto de contenido**, y uno automático verificado a mano.

| Archivo | Qué pasó | Resolución |
| --- | --- | --- |
| `HANDOFF.md` | add/add: las dos ramas entregaron su propio handoff en la misma ruta | Se conservan **los dos completos y sin editar**, como Parte A y Parte B. Documentan trabajo disjunto; elegir uno habría borrado la entrega del otro, que es exactamente lo que hace un `ours`/`theirs` a ciegas. Las dos declaraciones fuente siguen en el archivo. |
| `package.json` | Git auto-mergeó scripts distintos | Verificado uno por uno: quedaron los cuatro (`certify:orders:staging` de Operaciones; `catalog:pending`, `qa:taba2:commercial-audit`, `qa:taba2:commercial-screenshots` de Comercial). |

**Prioridad de autoridad aplicada.** Comercial no tocó `supabase/` en ningún
commit, así que las 8 migraciones de Operaciones y el filtro `origin =
'production'` de la bandeja del Panel llegaron intactos. Ningún archivo requirió
elegir entre lógica operativa e identidad visual: no hubo solape.

## 3. Combos — bloqueante #1 cerrado

Los siete combos existían como propuesta, con su ahorro derivado del catálogo
vivo, pero **nadie aplicaba el descuento al total**. Por eso la ficha no ofrecía
"Agregar combo": hacerlo habría cobrado la suma de los precios de lista.

### El contrato, punto por punto

| Requisito | Dónde vive |
| --- | --- |
| Combo por ID estable | `product_combos.combo_id`, único por negocio, formato validado |
| Componentes y cantidades validados server-side | `product_combo_components`, y el checkout expande con **su** definición, no con lo que manda el navegador |
| Precio de lista desde el catálogo vivo | se calcula con los precios **bloqueados** por el bucle de reserva, no con los leídos antes |
| Descuento validado server-side | sale de `product_combos.discount_percentage`, no del pedido |
| Total final decidido por el backend | `total = subtotal - discount_total + delivery_fee`, y es el que espera el `payment_intent` |
| El frontend nunca dicta el precio | el payload sólo acepta `{combo_id, quantity}`; ningún campo de dinero entra al checkout |
| Stock = componente limitante | `min(stock/cantidad)`, y las cantidades se consolidan por producto antes de reservar |
| Reserva/descuento atómico | una sola transacción; cualquier fallo revierte reservas, stock y sesión |
| Rollback completo si falta uno | `combo incompleto al reservar` aborta el checkout entero |
| +18 cuando corresponde | se propaga desde cualquier componente alcohólico |
| Snapshot en el pedido | `order_combos` guarda lista, promocional, ahorro y los componentes con su precio del momento |
| Idempotencia segura | el hash de intención incluye los combos: repetir devuelve la misma sesión, cambiarlos se rechaza |

### "Agregar combo" sólo donde se puede cobrar

`chargeable` separa **se puede armar** de **se puede cobrar a este precio**: hace
falta aprobación comercial *y* que el combo resuelva entero contra el catálogo
vivo. En staging eso da **3 de 7**:

| Combo | Lista | Combo | Ahorro | Estado en staging |
| --- | ---: | ---: | ---: | --- |
| Cuatro para arrancar | $ 11.700 | $ 10.500 | $ 1.200 | **cobrable** |
| Heineken x6 | $ 23.400 | $ 21.000 | $ 2.400 | **cobrable** |
| Noche larga | $ 22.752 | $ 20.000 | $ 2.752 | **cobrable** |
| Previa Imperial · Corona x6 · Birra y energía · Tabla de cervezas | — | — | — | bloqueados: sus componentes no están en el catálogo de staging |

Los números que devuelve el backend son idénticos a los que deriva la góndola.
No se inventó ni un precio: el descuento sale del manifiesto y los precios de
componente del catálogo.

### Un defecto de integración que sólo se ve en el catálogo real

`resolveCombo` indexaba los productos por `id`. En la demo estática el `id` de un
producto **es** su SKU; contra Supabase el `id` es un UUID y el SKU viaja aparte.
Con el índice por `id` solamente, **la góndola productiva mostraba cero combos**:
todos los componentes quedaban "fuera del catálogo". Ahora indexa por los dos.

## 4. Precios pendientes — las nueve unidades siguen bloqueadas

No se derivó ningún precio unitario del pack. Lo que se agregó es el camino para
completarlos **sin tocar código**:

- `catalog/pending-unit-prices.csv` — en el mismo formato que `npm run
  catalog:import` ya sabe importar. Todo lo que el catálogo verificó viene lleno;
  `price`, `stock` e `image_path` quedan vacíos.
- `catalog/pending-unit-prices.reference.csv` — la evidencia: precio del pack,
  unidades por pack y **la división que NO se usa**, con el motivo.
- `npm run catalog:prices:pending` / `:check` / `:verify`.

Se genera, no se escribe a mano: un test falla si el archivo committeado se
desvía del catálogo.

Dos hallazgos medidos contra el validador real del importador:

1. el importador **se niega** a publicar con precio o stock vacío, así que no hay
   forma de publicar las nueve a $0 por olvido;
2. la unidad también necesita **foto propia** — la del pack muestra seis botellas
   y no puede hacer de unidad. Sin decirlo en la planilla, el operador completa
   los nueve precios y descubre el bloqueo recién al importar.

El verificador además rechaza un precio que sea **exactamente el pack dividido**:
es el único error que se ve razonable y publica un precio que el local nunca
fijó. Se puede forzar con `--permitir-coincidencia` si el local confirmó ese
número igual.

## 5. Migraciones

Cuatro nuevas, todas aplicadas a `la-taba-staging` (`ukxqbgswjlibmnjemrzd`).

| Versión | Qué hace |
| --- | --- |
| `20260806240000_taba2_combo_catalog_contract` | `product_combos`, componentes y sustituciones; RLS; `resolve_business_combo` y `list_business_combos` |
| `20260806250000_taba2_combo_checkout_pricing` | `orders.discount_total`; snapshots de sesión y pedido; `create_checkout_session` y `finalize_paid_checkout_session` con combos |
| `20260806260000_taba2_combo_preference_lines` | la preferencia de Mercado Pago muestra el combo, no sus componentes |
| `20260806270000_taba2_order_total_with_discount` | `total = subtotal - discount_total + delivery_fee` |

Las dos redefiniciones grandes (`create_checkout_session`, 430 líneas, y
`prepare_mercadopago_preference`) se generaron **desde el fuente exacto con
reemplazos puntuales**, no transcribiéndolas: un test verifica que las 11
validaciones del checkout original y las 6 guardas de autorización de la
preferencia siguen ahí. Copiar a ojo una función de ese tamaño es la forma más
barata de perder una validación sin que ningún test lo note.

### Tres defectos que encontró la base, no el diseño

1. **`operator does not exist: uuid = text`** — en la política RLS de componentes,
   `combo_id` sin calificar resolvía a la columna *text* del subquery en vez de la
   uuid de la fila filtrada. La migración fallida **revirtió entera**: ninguna de
   las cinco tablas quedó a medias.
2. **La preferencia de Mercado Pago rompía con descuento.** El armador asume
   `total ≥ suma de ítems`; con el combo daba `10650 - 11700 = -1050` y lanzaba
   `Preference items exceed the server-side checkout total`, que el Edge Function
   clasifica como `network_or_timeout`. El guard estaba bien: hasta hoy no existía
   ningún descuento. Faltaba que la preferencia supiera que un combo se **reserva**
   por componentes y se **cobra** como combo.
3. **La otra invariante de dinero del pedido.** `20260806250000` relajó
   `orders_total_not_below_subtotal` pero se le pasó
   `orders_total_matches_parts check (total = subtotal + delivery_fee)`, declarada
   inline en la primera migración de pedidos. Con un pago real ya aprobado,
   `finalize_paid_checkout_session` levantaba `23514` en cada intento y el
   comprador veía "Confirmando tu pedido" para siempre. Lo único bueno del defecto
   es lo que demostró: **la finalización es idempotente y no crea nada a medias** —
   el pago quedó verificado, sin pedido duplicado y sin stock perdido; corregida la
   invariante, el mismo checkout finalizó en `LT-0078`.

## 6. Deploy — sólo staging, con el lock compartido

Lock tomado en el directorio compartido de locks, como
`taba2-pilot-integration-staging.txt`.

| Superficie | Qué se hizo |
| --- | --- |
| Base | las 4 migraciones nuevas por `supabase db push` |
| Edge Functions | las 5 del producto, sincronizadas desde esta RC |
| Storefront | Cloudflare Pages `taba2-staging`, rama **`staging`** (la de producción del proyecto de staging) |
| Catálogo | `npm run combos:import -- --approve`: 3 combos importados, 4 omitidos con su motivo |

**Producción y ARCA intactos.** `fiscal_documents` y `fiscal_outbox` en 0. Nunca
se apuntó a `la-taba-demo`.

> El primer deploy fue a la rama `main`, que en este proyecto es *preview*. La
> rama de producción del proyecto de staging se llama `staging`; el deploy se
> repitió ahí y `taba2-staging.pages.dev` sirve la RC integrada.

## 7. Compra Mercado Pago TEST desde el storefront integrado

Recorrido real, desde un contexto WebKit con forma de iPhone, contra
`https://taba2-staging.pages.dev`.

El recorrido certificado de punta a punta es **`LT-0079`**.

1. **Cliente** — perfil y dirección propios (`QA Combo RC`, `Calle QA Combo 850, Neuquen`).
2. **Combo** — la góndola publicó los 3 combos cobrables; la ficha ofreció
   **"Agregar combo · $ 10.500"**.
3. **$ correcto** — carrito: subtotal $ 23.400 de lista → **combo $ 10.500** →
   resumen `Subtotal $ 11.700 · Combo del local −$ 1.200 · Envío $ 150 · **Total $ 10.650**`.
4. **Pago fake** — Checkout Pro, tarjeta de prueba, **aprobado por $ 10.650
   exactos**, operación `172454685930`. La pantalla de Mercado Pago mostró
   *"Cuatro para arrancar"*, no cuatro latas sueltas.
5. **Cierre automático** — la pantalla de retorno llegó sola a
   **"Pedido confirmado"**, sin ningún paso manual y sin webhook: la finalización
   la dispara `mercadopago-checkout-status`, que lee el pago del proveedor y lo
   pasa por la misma verificación que usa el worker.
6. **Pedido único** — **`LT-0079`**, `received`, `payment_method mercadopago`,
   `origin production`, dirección completa.
7. **Panel** — lo vio en su bandeja y lo movió `accepted → preparing → ready`;
   una revisión atrasada fue rechazada.
8. **Rider** — lo vio en la cola, lo tomó (segundo claim = no-op idempotente),
   registró retiro, salida y llegada.
9. **Entrega** — el cliente obtuvo su código; un código incorrecto **no** cerró el
   pedido; el correcto lo dejó `delivered`.

**`LT-0078`** es la compra anterior, con el mismo recorrido y el mismo total.
Es la que destapó la invariante `orders_total_matches_parts`: su pago quedó
aprobado y verificado mientras la finalización fallaba, y una vez corregida la
invariante el mismo checkout finalizó sin duplicar nada. También llegó a
`delivered` por el circuito completo.

### Verificación

| | |
| --- | --- |
| Cero duplicados | 1 pedido por huella de intención |
| Stock correcto | 4 unidades descontadas; reservas `converted`; **0 reservas huérfanas** al cerrar |
| QA separado | `LT-0079` nace `origin=production`; LT-0033/34/35 siguen `qa` |
| `payment_method` válido | `mercadopago` con intent `completed` y `paid_amount = 10650` |
| Outbox | sin pendientes |
| Dirección completa | `Calle QA Combo 850, Neuquen` con columnas `delivery_*` |
| LT-0030 | intacto: `arrived`, revisión 11, $ 550 |
| ARCA y producción | sin actividad |
| Dinero | subtotal 11.700 · descuento 1.200 · total 10.650, sin moverse en todo el circuito |

**21 comprobaciones del pedido + 17 del circuito operativo, todas verdes.**
Reproducibles con `npm run certify:circuit:staging -- LT-00XX`.

`LT-0078` y `LT-0079` quedan `origin=production` y `delivered`. Es el mismo
criterio que Operaciones ya había aplicado a sus tres pedidos terminales: **un
pedido entregado no es operable**, así que llamarlo QA no protege nada y sí
borra el hecho de que la clasificación automática **no** se disparó sobre
catálogo comercial real —que es justamente lo que había que demostrar—. La
bandeja del Panel quedó vacía al cerrar.

## 8. Pruebas

| Gate | Resultado |
| --- | --- |
| `npm test` | **1086/1086** |
| `npm run test:e2e` | **206/206** (Chromium + Firefox) |
| `npm run test:webhook` | **12/12** |
| `npm run check` | pasa |
| `npm run secrets:scan` | limpio |
| `npm run migrations:validate` | aprobado |
| `npm run certify:orders:staging` | **47/47** contra la base real, después de las migraciones de combos |
| Auditor de superficie · Chromium | **72/72 vistas, 0 hallazgos** a 320/375/390/414/432/desktop |
| Auditor de superficie · WebKit | **72/72 vistas, 0 hallazgos** a los mismos anchos |
| Retornos de Mercado Pago | cubiertos por el auditor y por la compra real |
| `git diff --check` | sin errores de whitespace |
| Git | limpio |

## 9. Riesgos que quedan

1. **El negocio no tiene habilitada la venta de alcohol en staging.**
   `alcohol_sales_enabled = false` y sin política ni horario. Ningún producto ni
   combo alcohólico se puede comprar hoy: el checkout responde *"politica o
   confirmacion de edad incompleta"*. Es previo a esta integración y no se tocó,
   porque es una decisión de negocio. **Dos de los tres combos cobrables de
   staging son +18**, así que hay que resolverlo antes del piloto.

2. **Los combos se cobran sólo por Mercado Pago.** La ruta directa de pedidos
   (efectivo / a coordinar) no deriva el precio de un combo, así que rechaza un
   carrito con combos en vez de expandirlo en silencio —que lo cobraría a precio
   de lista—. El carrito lo dice explícitamente. Habilitar el combo por esas vías
   es trabajo pendiente sobre `create_order_with_items`.

3. **Sólo 3 de los 7 combos son cobrables en staging** porque faltan sus
   componentes en el catálogo. No es un defecto del contrato: es el catálogo de
   staging. En un catálogo completo, los siete resuelven.

4. **`orders.discount_total` es nuevo.** Cualquier lector de `orders` que calcule
   el total como `subtotal + delivery_fee` va a equivocarse en un pedido con
   combo. Las dos invariantes de la tabla ya lo contemplan.

5. **La taxonomía de visualización y la de importación siguen sin coincidir.**
   La góndola publica `mixers`; el vocabulario del importador no lo tiene. La
   traducción está explícita en `IMPORT_CATEGORY` y falla ruidosamente ante un
   rubro sin equivalente, pero unificar las dos taxonomías sigue pendiente.

6. **Mercado Pago sirve más de una variante del formulario de tarjeta.** La que
   llega directo, sin el paso "¿Qué querés pagar?", no se llenaba por
   emparejamiento de índice y dejaba la compra trabada en "Continuar". Se resolvió
   llenando por etiqueta visible, que es lo único estable entre variantes; con eso
   la corrida completa cerró. Es la automatización, no el producto, pero conviene
   saberlo antes de armar el próximo E2E.

7. **Otra sesión corrió la certificación de Operaciones contra staging mientras
   este trabajo tenía el lock tomado.** Se detectó por su pedido
   `cert_real_…` apareciendo en la bandeja del Panel a mitad de la verificación.
   No corrompió ninguna medición —los pedidos de esta RC se verifican por su
   propio código— pero **el lock compartido sólo sirve si todos lo leen antes de
   tocar la base**.

8. **Los actores de certificación se acumulan.** Cada corrida crea un staff y un
   rider que quedan desactivados y baneados, no borrados: son sujeto de eventos de
   auditoría y borrarlos destruiría evidencia.

9. **Al cliente del pedido se le asignaron credenciales.** Para pedirle el código
   de entrega como lo haría su app hizo falta autenticarse como él;
   `finalize_paid_checkout_session` guarda sólo el hash del token de seguimiento.
   Es un usuario anónimo de staging y el contrato usado —
   `recover_order_tracking_access`— es el que el producto ya expone.

## 10. Lo que no se tocó

Producción, ARCA (`services/arca-fiscal-bridge` sin cambios), `la-taba-demo`,
`styles/business.css`, `styles/rider.css`, `js/business.js`, `js/delivery.js`,
`js/pos/**`, secretos. LT-0030, LT-0033, LT-0034 y LT-0035 se conservan como QA,
sin borrar.

---

TABA2_PILOT_RC_INTEGRATED_AND_E2E_CERTIFIED
