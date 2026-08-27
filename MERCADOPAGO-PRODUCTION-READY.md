# Mercado Pago — listo para cobrar, apagado a propósito

Rama: `feature/taba2-mercadopago-production-ready` (desde `main` `8dc6c11`)
Fecha de la medición: 2026-08-26

---

## Lo primero, porque cambia el resto del documento

**Checkout Pro ya estaba implementado de punta a punta en este repositorio.** No
había que escribirlo: 7 Edge Functions, 19 migraciones, la validación de firma
con el SDK oficial, la cola durable con reintentos, las tres páginas de retorno y
la recuperación del checkout estaban en `main` desde principios de agosto, y
están CERTIFICADAS en staging con credenciales de prueba.

Lo que esta misión encontró fue otra cosa: **el circuito no existe en
producción**, y **la pantalla mentía sobre qué medio de pago estaba eligiendo la
persona**. Lo primero es una compuerta operativa que ahora tiene un gate que la
mide. Lo segundo era un defecto real, que se midió y se corrigió.

---

## 1. Qué se midió en producción

Medido el 2026-08-26 contra `wwcpogltfgzgkrlilbcd` (`la-taba.pages.dev`):

| Capa | Estado | Cómo se midió |
|---|---|---|
| Esquema de Checkout Pro | **APLICADO** | las RPC `create_checkout_session`, `prepare_mercadopago_preference` y `get_mercadopago_checkout_availability` responden `42501` (existen, sin permiso para `anon`), no `PGRST202` |
| Edge Functions | **0 desplegadas** | `supabase functions list --project-ref wwcpogltfgzgkrlilbcd` → `{"functions":[]}` |
| Secretos del proyecto | **0 definidos** | `supabase secrets list --project-ref wwcpogltfgzgkrlilbcd` → `{"secrets":[]}` |
| Veredicto | **DISABLED** | `npm run mp:config:produccion` |

En staging (`ukxqbgswjlibmnjemrzd`), para contraste: 5 de 5 funciones requeridas
activas, 6 de 6 secretos puestos, entorno `test`, veredicto **TEST**.

La conclusión operativa es que **producción falla cerrado por construcción, no
por suerte**: aunque alguien encendiera la fila del comercio, no hay función que
atender ni token con el cual hablarle a Mercado Pago.

---

## 2. El defecto que sí había: el botón no decía lo que hacía

`renderCheckoutPaymentFields()` (`js/ui.js`) empezaba así:

```js
const note = $('[data-payment-note]');
if (!note) return;
```

`[data-payment-note]` **no existe en el checkout actual**. Existió en una
versión vieja del markup y se fue; la función se quedó colgando de él. Resultado:
la función salía por ese `return` en TODOS los renders, y todo lo que venía
después —la etiqueta del botón y la nota— nunca se ejecutaba.

Lo medible, con Mercado Pago elegido en el selector:

```
Expected pattern: /Pagar con Mercado Pago/
Received string:  "Confirmar pedido"
```

y la nota de abajo seguía diciendo *«El medio de pago se coordina con el
local»*. La pantalla afirmaba que el pago se arreglaba con el negocio y acto
seguido redirigía a Mercado Pago. Es exactamente el «"A coordinar" fingiendo que
es Mercado Pago» que la misión prohíbe, sólo que al revés.

Había una segunda cara del mismo defecto, en dos lugares más:

- **Al volver de Mercado Pago**, `rearmarCheckoutAlVolver()` escribía a mano
  `«Confirmar pedido»` aunque el selector siguiera en Mercado Pago. Tocar ese
  botón redirigía otra vez.
- **Al retirarse Mercado Pago** (`setMercadoPagoCheckoutAvailability({available:
  false})`), el selector caía solo a «A coordinar» y el botón se quedaba
  ofreciendo un pago que ya no existía.

### Cómo quedó

La copia base la declara el modo de la app (`rememberCheckoutBaseCopy`), y el
medio de pago seleccionado la sobrescribe y la restaura, **simétricamente**. Las
tres superficies ahora dicen lo mismo que va a pasar.

### Cómo se comprobó

Dos pruebas E2E nuevas en `tests/e2e/checkout-payment-handoff.spec.mjs`, y se
midió que **fallan sin el arreglo** reintroduciendo el `return` a mano: el
mensaje de arriba es de esa corrida, no de un razonamiento.

---

## 3. Contra la documentación oficial vigente

Se verificó el contrato contra la documentación de Mercado Pago, no contra
tutoriales:

| Punto | Documentación | Este repositorio |
|---|---|---|
| `data.id` para la firma | viene del **query string** (`req.query['data.id']`) | sí; `webhookResourceId(url)`, y el `data.id` del cuerpo sólo se usa para RECHAZAR si difiere |
| manifiesto HMAC | `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` | delegado al `WebhookSignatureValidator` del SDK oficial `mercadopago@3.2.1` |
| respuesta del webhook | `200` o `201`, dentro de **22 s** | `201` inmediato; el trabajo real lo hace la cola durable |
| `auto_return` | válido; exige `back_urls.success` definida | las dos viajan juntas, con prueba que lo fija |
| secreto del webhook | del panel, *Webhooks > Configurar notificación* | `MERCADOPAGO_WEBHOOK_SECRET`, sólo del lado del servidor |

### Un endurecimiento que salió de esa lectura

La documentación muestra el ejemplo `ts=1704908010` —diez dígitos, **segundos**—
y en otra página describe el mismo campo como *«timestamp (in milliseconds)»*.

La ventana de frescura de 5 minutos es **nuestra**, no del proveedor: el HMAC se
calcula sobre el `ts` literal y no le importa la unidad. Pero si Mercado Pago
firmara en milisegundos, ese número sería mil veces más grande, caería fuera de
la tolerancia futura y **rechazaríamos todos los webhooks legítimos** — fallando
cerrado hacia el peor lado posible: pedidos pagos que nunca se finalizan.

`signatureTimestampSeconds()` ahora normaliza las dos unidades. Tres pruebas Deno
fijan que las dos pasan y que **una firma vencida en milisegundos sigue
vencida**: la unidad nueva no es una puerta para revivir una firma vieja.

---

## 4. Lo que se agregó

### `scripts/mercadopago/verificar-configuracion.mjs`

Contesta «¿este proyecto puede cobrar, y en qué modo?» **sin ver ningún
secreto**, y falla cerrado.

```
npm run mp:config:staging
npm run mp:config:produccion
npm run mp:gate:produccion-sin-cobro     # afirma que producción NO puede cobrar
```

La idea que lo hace posible: `supabase secrets list` no devuelve valores,
devuelve el **SHA-256** de cada uno. Eso permite dos cosas distintas, y la
asimetría es la característica:

- un secreto de **alta entropía** (el access token, el webhook secret) queda
  opaco: sólo se aprende que está puesto, que es lo que hace falta saber;
- un valor **enumerable** (`test`/`production`, `approved`, una URL pública)
  tiene un puñado de candidatos: se digiere cada uno y se compara. Queda
  identificado sin que el valor viaje nunca.

`sha256("test") = 9f86d081…f00a08` es la huella que hoy tiene
`MERCADOPAGO_ENVIRONMENT` en staging. Por eso el gate puede afirmar «staging
está en modo test» con evidencia, y no puede afirmar nada sobre el token.

Un test (`tests/mercadopago-configuracion-gate.test.mjs`) fija esa frontera:
falla si alguien agrega candidatos para un secreto de verdad, porque eso
convertiría la herramienta en un ataque de diccionario contra el propio
proyecto. Otro test compara la lista de secretos requeridos contra los
`getRequiredEnv()` que las funciones realmente declaran, para que la compuerta
no se quede atrás del código.

### `supabase/functions/_shared/mercadopago-preference.deno.ts`

**El importe que viaja a Mercado Pago no tenía ni una prueba.**
`preferenceRequest()` decide cuánto se le cobra a una persona, y ya había
fallado una vez: `items` llevaba sólo los productos, así que el envío no llegaba
—se cobraba el subtotal mientras el `payment_intent` esperaba el total—.

Nueve pruebas fijan las dos direcciones del error:

- el envío viaja como línea propia y la suma da **exactamente** el total del servidor;
- un carrito cuyas líneas superan ese total **no se puede cobrar** (en vez de cobrarse de más);
- entorno equivocado, total cero o negativo, sesión vencida: rechazados;
- producción sin la autorización explícita de pago real: rechazada;
- `external_reference`, `notification_url` y las tres `back_urls` son las del servidor;
- toda línea se cobra en ARS.

Corre en el gate (`npm run test:webhook`), en su propio paso con `--allow-env`.

---

## 5. Verificación

| Suite | Resultado |
|---|---|
| `npm run check` (sintaxis, precache, identidad de release, secretos) | verde |
| `npm test` | **2233 / 2233** |
| `npm run test:webhook` (25 Deno firma + 9 Deno importe + 12 Node) | **46 / 46** |
| `npm run test:payments:local-db` | verde — 116 migraciones desde cero + simulacro de restauración, con las aserciones de duplicado, doble toque y reserva exactamente-una-vez |
| `npm run secrets:scan` | verde |
| `npm run mp:gate:produccion-sin-cobro` | **DISABLED**, como corresponde |

El E2E completo: **508 de 509**. El de handoff (10 pruebas) pasa entero,
incluidas las dos nuevas.

### La que falla, y por qué no es de esta rama

`service-worker-degraded-recovery.spec.mjs:224` — «el carrito sobrevive intacto a
una recarga con el borde caído» — pierde una unidad (`:2` → `:1`) al recargar en
WebKit. Se midió, no se supuso:

| Corrida | CACHE_NAME | Resultado |
|---|---|---|
| la prueba sola, `--repeat-each=3` | v90 (esta rama) | 3/3 verde |
| el archivo entero, `--repeat-each=3` | v90 (esta rama) | falla en `repeat2` |
| el archivo entero, `--repeat-each=3` | **v89 (main)** | **falla en `repeat2`** |

Con el CACHE_NAME de `main` falla **la misma prueba en la misma repetición**, así
que el bump de esta rama no la causa. El mecanismo lo confirma: Playwright le da
a cada prueba un contexto limpio, así que no hay caché vieja de la que migrar —el
nombre es sólo una clave sobre un almacén vacío—. Es una flake preexistente de
durabilidad de `localStorage` en WebKit, que aparece bajo la carga del archivo
completo. CI corre con `retries: 1`.

No se arregla acá a propósito: es un defecto real pero de otro dominio (el
carrito), y meterlo en una rama de pagos lo escondería.

**El alcohol no se tocó.** Cero migraciones modificadas, cero archivos de
alcohol en el diff: `alcohol_sales_enabled=false` y sus compuertas siguen
exactamente como estaban.

---

## 6. Lo que falta, separado por quién lo puede hacer

### LISTO AHORA (no necesita a nadie)

- El código de Checkout Pro, completo y probado.
- El gate de configuración y el del importe.
- El checkout que dice la verdad sobre el medio de pago.
- Producción, fail-closed y medida.

### NECESITA A WALTER

1. **Aplicación de Mercado Pago a nombre del negocio.** Creada en su cuenta, en
   *Tus integraciones*. Nadie más puede crearla: es la cuenta que va a recibir
   la plata.
2. **Credenciales productivas** de esa aplicación: `Access Token` y `Public
   Key`. **No las mande por chat.** Van con `supabase secrets set` contra
   `wwcpogltfgzgkrlilbcd`, y sólo ahí.
3. **Secreto del webhook**, del panel de esa aplicación: *Webhooks > Configurar
   notificación*, apuntando a
   `https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-webhook`.
4. **`collector_id` y `application_id`** de esa misma aplicación: sin los dos,
   la base rechaza encender el cobro (es un CHECK, no una convención), y además
   son lo que hace que un pago ajeno no pueda hacerse pasar por uno nuestro.
5. **Autorización explícita para la primera compra real**, con su plata, para
   cerrar la certificación.

### NECESITA DATOS COMERCIALES

6. **Cuotas y medios**: ¿se aceptan cuotas? ¿hasta cuántas? ¿se acepta pago en
   efectivo por cupón (`ticket`)? Hoy el default es sin cuotas declaradas y sin
   cupón; son campos de `business_payment_settings`, no del código.
7. **Política de devoluciones**: `manual_review` (default) o `owner_approval`.

### PRUEBA FINAL DE PRODUCCIÓN

Una vez cargados los secretos, en este orden:

```
supabase functions deploy --project-ref wwcpogltfgzgkrlilbcd \
  mercadopago-create-checkout-session mercadopago-create-preference \
  mercadopago-checkout-status mercadopago-webhook \
  mercadopago-payment-worker mercadopago-refund mercadopago-cancel-payment

npm run mp:config:produccion        # tiene que decir PRODUCTION, no DISABLED
```

Y recién después: encender `business_payment_settings`, y una compra real de
monto chico hasta `approved`, verificando que el webhook llegue firmado y que el
pedido se finalice solo.

**Cómo verificar el webhook sin gastar plata.** El panel de Mercado Pago trae un
*Simulador de notificaciones* en *Webhooks*, y firma con el mismo secreto de la
aplicación. Es la única forma oficial de probar la recepción de punta a punta, y
sólo existe una vez que la aplicación de Walter esté creada. Lo que hay que ver:

```sql
select event_type, resource_id, signature_valid, processing_status, attempt_count
  from public.payment_webhook_receipts
 order by created_at desc limit 5;
```

`signature_valid = true` prueba el HMAC contra el secreto real. Repetir la misma
notificación tiene que dejar `processing_status = 'duplicate'` y **no** un
segundo pedido: eso es la idempotencia, medida contra el proveedor de verdad en
vez de contra la suite.

> Contexto que ahorra una tarde: con credenciales de PRUEBA, Mercado Pago firma
> las notificaciones de Checkout Pro con la clave de la aplicación de prueba que
> auto-provisiona, y el panel no la expone. Por eso en staging la reconciliación
> se hace leyendo el pago con el access token —más fuerte que el HMAC, porque no
> toma nada de quien llama— y no por la firma. Con la aplicación productiva de
> Walter el camino de la firma sí queda comprobable.

> `mercadopago-cancel-payment` **no está desplegada en ningún proyecto**, ni
> siquiera en staging. Existe en el repositorio y el Panel la va a necesitar la
> primera vez que haya que cancelar un pago. El gate ahora la nombra.

---

## 7. Lo que no se pudo medir

**La fila `business_payment_settings` de producción no se leyó.** Los tres
intentos de consultarla —incluido el runner de sólo lectura del propio
repositorio, `scripts/consulta-solo-lectura.mjs`— fueron bloqueados por la
política de permisos de la sesión.

Por el contrato de la base, `enabled = true` es imposible sin `collector_id` y
`application_id` (CHECK `business_payment_settings_enabled_configuration_check`),
y esos son datos de Walter que todavía no existen. Pero eso es **inferencia, no
medición**, y en este proyecto las inferencias sobre producción ya salieron
caras antes. Queda como lo único de este informe que no tiene un número atrás:

```
npm run mp:config:produccion   # esto sí se midió: DISABLED
node scripts/consulta-solo-lectura.mjs --ref=produccion \
  --sql="select enabled, environment, production_review_status from public.business_payment_settings"
```
