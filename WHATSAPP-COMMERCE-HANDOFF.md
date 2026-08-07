# TABA2 · Canal oficial de pedidos por WhatsApp

**Declaración:** `TABA2_WHATSAPP_COMMERCE_TEST_FLOW_CERTIFIED`

Rama `feature/taba2-whatsapp-commerce`, sobre `release/taba2-first-physical-e2e` (`044344c`),
que era la RC de backend más reciente al empezar.

---

## 1. Qué se construyó

Un cliente puede comprar por WhatsApp y el pedido que sale es **exactamente el mismo tipo de
pedido que sale de la web**: mismo catálogo, mismos precios, mismo stock, mismos combos, misma
política +18, mismo envío, misma reserva, mismo checkout, misma sesión de Mercado Pago, mismo
pedido en el Panel y en la cola del Rider.

WhatsApp es **otro frontend**. No es un comercio nuevo ni un canal paralelo.

```
WhatsApp Cloud API (Meta)
        │  X-Hub-Signature-256
        ▼
whatsapp-webhook (Edge Function, Deno)
        │  service_role
        ▼
whatsapp_* (identidad, conversación, idempotencia, lecturas del catálogo)
        │
        ▼
create_checkout_session ─ prepare_mercadopago_preference ─ createPreference()
        │                                                   (el módulo del checkout web)
        ▼
Mercado Pago  →  mercadopago-webhook  →  payment_outbox  →  finalize_paid_checkout_session
        │
        ▼
orders  →  Panel del negocio  →  Rider
        │
        ▼
whatsapp_outbound_messages → whatsapp-dispatcher → «Tu pedido LT-0101 está confirmado»
```

**Sólo Cloud API oficial de Meta.** No hay automatización de WhatsApp Web, ni Selenium sobre
chats personales, ni APIs no oficiales. La única superficie hacia Meta es
`https://graph.facebook.com/<version>/<phone_number_id>/messages`.

---

## 2. La regla que ordena todo el diseño

> El bot entiende. El backend decide.

El carrito de una conversación es una lista de **identificadores y cantidades**. Nada más. No
es una convención: la base lo impide.

```sql
constraint whatsapp_conversations_cart_check check (public.whatsapp_cart_is_valid(cart))
```

Guardar `{"product_id": "...", "quantity": 1, "unit_price": 3200}` en el carrito de un chat
falla el `UPDATE`. El E2E lo intenta a propósito y verifica que la base lo rechace.

Todo lo demás —precio, stock, descuento de combo, mínimo de envío, +18, total, estado del
pago— se le pregunta al comercio cada vez:

| Lo que el chat muestra | De dónde sale |
| --- | --- |
| Categorías del menú | `whatsapp_catalog_shelves` sobre el catálogo vivo; un estante sin stock no se ofrece |
| Precio de un producto | `products.price` con `price_status = 'confirmed'` |
| Precio de un combo | derivado: `combo_promotional_price(list, descuento, redondeo)` sobre precios vivos |
| Total del carrito | `whatsapp_quote_cart` |
| Total que se cobra | `create_checkout_session`, con los renglones **bloqueados** |
| Enlace de pago | `prepare_mercadopago_preference` + `createPreference()` de `_shared/mercadopago.ts` |
| Confirmación del pedido | disparador sobre `checkout_sessions` cuando nace el pedido |

### La cotización es una proyección, y está atada con un test

`whatsapp_quote_cart` existe porque un chat necesita decir «van $ 19.800» **antes** de pagar.
Lee los mismos renglones y aplica la misma aritmética que el checkout, pero no reserva y no
decide nada. Que las dos no puedan separarse no es una promesa: el E2E corre el mismo carrito
por las dos y compara subtotal, descuento, envío y total.

**Ese test ya encontró un defecto real durante esta rama.** La primera versión de la cotización
sumaba la línea del combo *ya rebajada* y encima restaba el descuento, así que anunciaba
$ 6.200 donde el checkout cobraba $ 19.800. Está corregido: el subtotal se arma sobre las
unidades consolidadas a precio de lista, exactamente como lo arma `create_checkout_session`.

---

## 3. La conversación

```
HOLA
 └─ menú (lista interactiva): Combos · Cervezas · Fernet · Gaseosas · … · Ver carrito
     ├─ Combos      → combos armables hoy, con precio promocional y ahorro derivados
     ├─ Cervezas    → productos con precio y presentación, paginados de a 8
     ├─ Fernet      → estante por subcategoría dentro de «Whisky y destilados»
     └─ Gaseosas    → …
producto
 └─ nombre · presentación · precio · stock si es bajo · +18 si corresponde
     └─ botones: Agregar 1 · Agregar 6 · Ver carrito
carrito
 └─ líneas · subtotal · descuento de combos · envío · TOTAL · avisos
     └─ botones: Finalizar compra · Seguir comprando · Vaciar
checkout (un paso por vez, siempre en el mismo orden)
 └─ modalidad → nombre → dirección → ciudad → +18 → resumen → Pagar
     └─ enlace de Mercado Pago + total
pago acreditado
 └─ «Mercado Pago confirmó tu pago ✅ Tu pedido es LT-0101 por $ 19.800.»
```

Los estantes del menú **son configuración del comercio**, no lógica del bot: viven en la tabla
`whatsapp_catalog_shelves`. Agregar, sacar o renombrar un estante es una fila, no un despliegue.
«Fernet» está definido como subcategoría dentro de «Whisky y destilados» porque en este catálogo
es un estante que la gente busca por su nombre.

### Entendimiento libre

«quiero un fernet con coca» se resuelve así:

1. se limpia la frase (se caen «quiero», «por favor», artículos) y se extrae la cantidad
   (`dos`, `6`, `media docena`);
2. se parte en términos por `y`, `con`, `+`, `,`;
3. **cada término se busca en el catálogo del backend**;
4. se contesta con una lista de candidatos reales, una sección por término.

La IA no elige el SKU, no fija el precio, no decide si hay stock y no aplica descuentos. Propone
lo que el catálogo devolvió y espera que la persona toque. El E2E verifica que después de una
búsqueda el carrito guardado **no cambió**.

### Ubicación

Si la persona manda su ubicación 📍, el punto viaja hasta el pedido con
`delivery_address_source = 'gps'`. Es la misma cadena de coordenadas que la RC base terminó de
cerrar para la app del Rider (`20260807160000`), alimentada ahora también desde WhatsApp.

---

## 4. Idempotencia, reintentos, deduplicación

Meta reintenta hasta recibir 200. Mercado Pago también reintenta. El canal está armado para que
eso nunca produzca dos carritos, dos pagos ni dos pedidos.

| Riesgo | Dónde se corta |
| --- | --- |
| Meta reenvía un mensaje ya procesado | `whatsapp_inbound_events`, único por `(business_id, provider_message_id)` |
| El proceso se cortó a mitad y Meta reintenta | el mensaje se reprocesa, pero cada respuesta se reserva por `reply:<mensaje>:<n>`: las que ya salieron se saltean |
| Dos mensajes del mismo cliente se cruzan | `whatsapp_save_conversation` compara `revision`; el que llega viejo no contesta |
| Tocar «Pagar» dos veces | `client_request_id` determinístico por carrito + dirección + modalidad: la misma sesión de checkout, la misma reserva |
| Mercado Pago repite la notificación | `record_mercadopago_webhook_receipt` (ya existía) |
| Finalizar dos veces | `finalize_paid_checkout_session` (ya existía) |
| El aviso de confirmación falla al salir | cola durable con lease, 8 intentos con espera creciente y carta muerta |

Los errores de envío se clasifican: 429 y 5xx se reintentan respetando `Retry-After`; un 4xx que
no sea 429 no se reintenta, se registra su código y se cierra.

---

## 5. Seguridad y PII

- **Firma.** Cada POST se valida con HMAC-SHA256 del **cuerpo crudo** contra el App Secret. Sin
  firma válida no se toca la base: no se crea contacto, ni conversación, ni recibo. La
  verificación GET compara el token en tiempo constante y sólo devuelve un challenge con forma
  de challenge.
- **Secretos.** `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` y `WHATSAPP_ACCESS_TOKEN` se leen
  únicamente en `_shared/whatsapp-runtime.ts`. Un test verifica que ninguno de los siete módulos
  del canal mencione `Deno.env` ni `process.env`.
- **PII mínima.** Se guarda el `wa_id` —sin él no hay a quién contestarle— y el nombre de perfil.
  **No se guarda el texto de ningún mensaje:** de cada uno queda su identificador (para
  deduplicar) y un hash del payload. Para logs y métricas está `wa_id_hash`, con sal de servidor.
- **Superficie.** Las cinco tablas del canal tienen RLS y `revoke all ... from public, anon,
  authenticated`. Ninguna función `whatsapp_*` es ejecutable por `anon` ni por `authenticated`.
  El E2E lo verifica sobre la base real, y también que `anon` reciba `permission denied`.
- **Identidad.** Un teléfono que ya compró por la web es el **mismo** cliente:
  `whatsapp_find_customer_by_phone` lo busca antes de dar de alta uno nuevo, así el historial no
  se parte en dos cuentas.
- **Costo declarado:** como el contenido de las respuestas no se guarda, una respuesta que falló
  al salir no se puede reintentar desde la cola. Se registra como `dead_letter` con su código de
  error y la persona puede volver a escribir. Es la contrapartida deliberada de no archivar
  conversaciones.

---

## 6. Qué se probó, y contra qué

### E2E sintético — 83/83 en verde

```
npm run test:whatsapp:e2e     # requiere TABA_LOCAL_WHATSAPP_E2E=1 y Docker
```

**Real:** PostgreSQL 17.6 en un contenedor propio y efímero, con las **57 migraciones aplicadas
desde cero**; el motor comercial real (`whatsapp_quote_cart`, `create_checkout_session`,
`prepare_mercadopago_preference`, `record_mercadopago_webhook_receipt`,
`record_mercadopago_payment_snapshot`, `finalize_paid_checkout_session`,
`list_operational_pipeline`); y los mismos módulos del canal que ejecuta la función de borde.

**Simulado, y declarado:** la Graph API de Meta y la API HTTP de Mercado Pago. En este entorno no
hay credenciales de un número de prueba de WhatsApp ni de una cuenta de prueba de Mercado Pago, y
**no se tocó ningún número productivo**. El enlace de pago se prepara y se persiste con las RPC
reales; lo único fabricado es la respuesta HTTP del proveedor, y antes de fabricarla se comprueba
la misma invariante que aplica `_shared/mercadopago.ts`: la suma de los ítems más el envío es
exactamente el total autoritativo, nunca más.

El circuito certificado, sobre un pedido:

- combo «Noche larga» (4 Heineken +18 y 2 Red Bull) + 2 Coca-Cola;
- lista 13.600 → promocional 11.900 → ahorro 1.700, todo derivado del catálogo vivo;
- subtotal 20.000 − descuento 1.700 + envío 1.500 = **total 19.800**;
- **el mismo carrito comprado desde la web cobra 19.800**, verificado en la misma corrida;
- reserva exacta: Heineken 96→92, Red Bull 60→58, Coca 80→78, fernet intacto;
- pago aprobado → **un** pedido, con líneas de producto y de combo, dirección, coordenadas de la
  ubicación de WhatsApp y `delivery_address_source = 'gps'`;
- reenviar el mensaje, reenviar el recibo y finalizar de nuevo: sigue habiendo **un** pedido y
  **una** respuesta;
- el Panel del negocio lo ve con su total y su modalidad;
- la confirmación sale por el mismo chat con el número de pedido, y no sale dos veces.

También se verifica lo que **no** debe pasar: sin confirmación de edad el backend no crea el
checkout y no reserva stock; la búsqueda libre no agrega nada sola; el carrito no admite precios;
`anon` recibe `permission denied` sobre las conversaciones; y el canal completo funciona como
`service_role`, que es como corre en producción y no como corría el resto de la corrida.

Un detalle para leer bien el resultado: el pedido del E2E queda clasificado `origin = 'qa'`
porque el catálogo sintético usa `catalog_origin = 'test_only'`, que es la señal que ya existía en
el backend. No es una propiedad del canal de WhatsApp: con catálogo comercial, un pedido de
WhatsApp nace `production` y entra a la bandeja del negocio como cualquier otro. El E2E verifica
las dos caras —lo ve la bandeja con QA incluida, no lo ve la de producción— justamente para que
un escenario de prueba no pueda ensuciar la operación real.

### Suites de Node y Deno

```
npm run test:whatsapp    # deno check de las dos funciones de borde + 75 tests de Node
npm test                 # 1194/1194
npm run check            # sintaxis (ahora también supabase/functions), assets, higiene
npm run migrations:validate   # sin ERROR
npm run secrets:scan     # limpio
npm run test:webhook     # 12/12 (Deno + Node)
```

Números medidos al cerrar la rama: **1195/1195** en Node, **76/76** en el canal, **12/12** en el
webhook de pagos, **85/85** en el E2E, `deno check` limpio sobre las dos funciones de borde.

`check-syntax` ahora cubre `supabase/functions/**/*.js`: antes, un error de sintaxis en un módulo
de servidor sólo aparecía al desplegar.

### Una puerta que NO se corrió: `npm run test:e2e`

El gate de Playwright (207 tests de la web) **no se ejecutó**. Al terminar esta rama había otras
dos sesiones corriendo Playwright sobre el mismo host, y el propio `playwright.config.mjs`
advierte que la concurrencia convierte saturación en timeouts no deterministas —se verificó de
primera mano: el primer intento murió en «timeout while setting up page» compitiendo por el host.

Lo que sí se puede afirmar sin correrlo: esta rama **no toca un solo archivo de la superficie
web**. Verificable en una línea:

```
git diff --name-only 044344c..HEAD -- js/ index.html styles/ styles.css sw.js tests/e2e/   # vacío
```

Quien integre esta rama debería correr `npm run test:e2e` con el host libre, exportando
`TABA_E2E_HTTP_PORT` y `TABA_E2E_RELAY_PORT` propios si hay otro worktree activo.

---

## 7. Un defecto de la RC base, traído de otra rama

La cadena de migraciones de `release/taba2-first-physical-e2e` **no se podía reproducir desde
cero**: `20260806160000` redefine `get_rider_queue` con `create or replace` cambiando el tipo de
retorno, y PostgreSQL no lo permite. Reconstruir el proyecto —el camino de recuperación ante
desastre— abortaba ahí, y este E2E también.

El arreglo ya existía en `feature/taba2-pilot-ops` (`cd94d38`) y se trajo con `cherry-pick -x`
como primer commit de esta rama. **No es mío**, pero sin él nada de esto se puede verificar desde
cero. En staging la migración ya corrió, así que el archivo editado sólo afecta a proyectos
nuevos. Quien integre esta rama y la de pilot-ops va a ver el mismo cambio dos veces: es el
mismo.

---

## 8. Lo que falta para que esto atienda a una persona real

Nada de esto se hizo acá, y ninguno depende de código:

1. **App de Meta y número de prueba.** Crear la app de WhatsApp Business Platform, tomar el
   número de prueba que Meta provee y anotar `phone_number_id`. **No usar el número productivo
   sin autorización explícita del comercio.**
2. **Secretos de la función de borde** (`supabase secrets set`, nunca en el repo):
   `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (lo elegís vos), `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ID` (el UUID del comercio en `businesses`),
   opcional `WHATSAPP_GRAPH_API_VERSION`. Reutiliza `PAYMENT_LOG_HASH_SALT`,
   `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, que ya están.
3. **Desplegar** `whatsapp-webhook` y `whatsapp-dispatcher`, y aplicar la migración
   `20260807170000_whatsapp_commerce_channel.sql`.
4. **Suscribir el webhook** en Meta a la URL de `whatsapp-webhook` con el campo `messages`. La
   verificación GET la contesta la función sola.
5. **Programar el despachador** con pg_cron, con el mismo patrón que el worker de pagos
   (`20260803120000`), firmado con `PAYMENT_WORKER_SECRET`. Sin esto, el aviso de «pago
   confirmado» se encola pero no sale.
6. **Ventana de alcohol.** El escenario sintético usa día completo para que el test no dependa de
   la hora. En staging la política real es 20:00–06:00 y no se tocó.
7. **Plantillas de Meta.** Fuera de la ventana de 24 h, Meta sólo deja iniciar conversación con
   una plantilla aprobada. Hoy el canal sólo responde y avisa dentro de esa ventana; si el aviso
   de confirmación llegara tarde, hay que registrar una plantilla. Está sin resolver y es lo
   primero que va a aparecer en un piloto real.

### Limitaciones conocidas

- **Un término por vez.** «fernet con coca» muestra las dos secciones, pero se agrega de a uno.
  No se guarda una cola de pendientes: eso exigiría persistir la intención del mensaje, que es
  justamente lo que se decidió no guardar.
- **Sin edición de cantidades desde el carrito.** Se puede agregar, quitar una línea entera y
  vaciar. Cambiar «3» por «2» es volver a agregar.
- **Sin seguimiento del reparto por chat.** El pedido entra a la cola del Rider como cualquier
  otro; el cliente no recibe todavía el enlace de tracking por WhatsApp.
- **Sin ARCA.** No se tocó nada fiscal. Un pedido de WhatsApp sigue exactamente el mismo camino
  fiscal que uno de la web, con las mismas limitaciones ya documentadas.

---

## 9. Lo que esta rama NO tocó

- **Staging: cero mutaciones.** El lock `taba2-staging-mutation.lock` lo tenía
  `TABA2_FIRST_PHYSICAL_E2E` durante toda la rama y no se tomó ni se modificó.
- **Producción: cero.** Ningún despliegue, ningún secreto, ningún número de WhatsApp.
- **ARCA:** ni el puente fiscal, ni `fiscal_documents`, ni credenciales.
- **Rider:** sólo lecturas ya existentes (`list_operational_pipeline`). No se cambió ningún
  contrato del Rider ni la app Android.
- **Frontend web:** ni un archivo de `js/`, `index.html` o `styles/`.
- **Contenedor ajeno:** del stack local `supabase_db_la-taba-pages` sólo se hizo un `pg_dump
  --schema-only` de lectura para copiar los esquemas de plataforma. El E2E levanta y borra su
  propio contenedor.
- **Sin push.** Commits locales, árbol limpio.

---

## 10. Mapa de archivos

| Archivo | Qué es |
| --- | --- |
| `supabase/migrations/20260807170000_whatsapp_commerce_channel.sql` | identidad, conversación, idempotencia, estantes, cotización, cola de salida, disparador de confirmación |
| `supabase/functions/whatsapp-webhook/index.ts` | verificación GET, firma, deduplicación, despacho |
| `supabase/functions/whatsapp-dispatcher/index.ts` | drena la cola de avisos (autorizado como worker) |
| `supabase/functions/_shared/whatsapp-runtime.ts` | secretos, Admin API, enlace de pago con el módulo del checkout web |
| `supabase/functions/_shared/whatsapp/signature.js` | HMAC del cuerpo crudo, token de verificación, hashes |
| `supabase/functions/_shared/whatsapp/inbound.js` | lectura de la notificación de Meta |
| `supabase/functions/_shared/whatsapp/messages.js` | mensajes de la Cloud API con sus límites reales |
| `supabase/functions/_shared/whatsapp/conversation.js` | interpretación y respuestas |
| `supabase/functions/_shared/whatsapp/backend.js` | puerto contra el comercio; arma el payload del checkout |
| `supabase/functions/_shared/whatsapp/graph.js` | envío con reintentos y clasificación de errores |
| `supabase/functions/_shared/whatsapp/channel.js` | orquestación e idempotencia; cola de avisos |
| `supabase/tests/fixtures/whatsapp_commerce_seed.local.sql` | escenario sintético (`catalog_origin = 'test_only'`) |
| `scripts/run-whatsapp-commerce-e2e.mjs` | el E2E |
| `scripts/run-whatsapp-channel-tests.mjs` | `deno check` + suites de Node |
| `tests/whatsapp-*.test.mjs` | 75 tests |
