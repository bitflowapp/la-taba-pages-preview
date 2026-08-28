# Activación de Mercado Pago en producción

De **«Walter ya creó la aplicación»** a **«primera compra real aprobada»**, sin
adivinar nada.

Auditado contra producción el **2026-08-27**. Nada de lo que sigue está tomado de
documentación anterior: cada estado se midió, y lo que no se pudo verificar no
está escrito.

---

## 0 · Dónde estamos hoy

| | medido |
|---|---|
| Veredicto de Mercado Pago | **DISABLED** |
| Funciones Edge desplegadas en producción | **7 de 7**, todas `ACTIVE` |
| Secretos productivos cargados | **0 de 7** |
| Filas en `business_payment_settings` | **0** |
| `alcohol_sales_enabled` | `false`, con 0 alcohólicos comprables |
| Productos comprables | 33 de 72 |
| `commercial:gate` | **TECHNICALLY READY** |

Las funciones ya están desplegadas y **eso no habilita cobrar nada**: fallan
cerrado sin secretos. Comprobado contra el endpoint público:

```
POST /functions/v1/mercadopago-webhook  →  HTTP 503
{"ok":false,"code":"PAYMENT_UNAVAILABLE", ...}
```

Para volver a medirlo:

```bash
npm run commercial:gate
npm run mp:config:produccion
```

---

## 1 · Lo que tiene que aportar Walter

### Credenciales

| dato | dónde lo saca |
|---|---|
| **Access Token productivo** | Sus integraciones → la aplicación → Credenciales de producción |
| **Webhook secret** | Sus integraciones → la aplicación → Webhooks → Firma secreta |
| **`collector_id`** | Su cuenta → número de usuario (`user_id`) |
| **`application_id`** | Sus integraciones → la aplicación → número de aplicación |

**La Public Key NO hace falta.** Se auditó el código y no aparece en ningún lado.
Esta integración es Checkout Pro por **redirección a `init_point`**: el navegador
nunca carga el SDK de Mercado Pago, así que no hay dónde configurarla. Pedirla
sería inventar un requisito.

### Decisiones comerciales

Ninguna la puede tomar el software:

1. **Cuotas.** ¿Se aceptan? ¿Hasta cuántas? Sin decisión, se cobra sin cuotas.
2. **Pago en efectivo por cupón** (`ticket`: Rapipago, Pago Fácil). Se cobra días
   después y el pedido queda pendiente mientras tanto. Por defecto, **excluido**.
3. **Política de devoluciones**: ¿la aprueba el dueño (`owner_approval`) o alcanza
   con revisión (`manual_review`)?
4. **Autorización explícita** para encender el cobro y para la primera compra real.

---

## 2 · Los cuatro estados, y por qué son cuatro

`commercial:gate` no contesta «listo / no listo», porque eso escondía un abrazo
mortal: encender el proveedor exigía haber probado, probar exigía el proveedor
encendido, y la compuerta pedía el proveedor encendido para dar verde.

| estado | qué significa | quién lo destraba |
|---|---|---|
| `COMMERCIAL NOT READY` | algo roto, o falta infraestructura desplegable hoy | este equipo, programando |
| `TECHNICALLY READY` | código e infraestructura listos; faltan datos de una persona | Walter |
| `READY TO ENABLE PAYMENT` | **todo** cargado y verificado, interruptor apagado a propósito | una autorización |
| `READY FOR REAL PAYMENT` | proveedor encendido y todas las compuertas satisfechas | — |

El tercero es el que rompe el círculo: el sistema puede declararse enteramente
listo **sin haber creado ninguna forma de cobrar**.

### La secuencia

```
inputs de Walter
  → secretos y configuración
  → funciones Edge desplegadas            ← YA HECHO (7 de 7)
  → business_payment_settings con enabled = FALSE
  → webhook registrado
  → gate dice READY TO ENABLE PAYMENT
  → AUTORIZACIÓN EXPLÍCITA de Walter
  → enabled = true
  → primera compra real
  → confirmar que la pagó el webhook y no la vuelta del navegador
  → gate dice READY FOR REAL PAYMENT
```

Hasta que `enabled` pase a `true`, el checkout del cliente no ofrece Mercado
Pago: no hay forma de cobrar antes de la autorización explícita.

---

## 3 · Reglas que no se negocian

- **El Access Token y el webhook secret no se escriben en ningún archivo del
  repositorio**, ni se pegan en un chat, ni se pasan como argumento de shell.
- **No se imprime ningún valor de secreto en ningún log.** Todo lo que verifica
  este procedimiento se contesta por presencia o por huella SHA-256.
- **No se pide la contraseña de Walter de nada.**
- **Fail-closed.** Falta una pieza, no se cobra.
- **Alcohol sigue en `false`.** Activar cobros no habilita alcohol: son dos
  compuertas distintas, y la de alcohol necesita la habilitación de expendio
  acreditada del local.

---

## 4 · El procedimiento

### Paso 1 · Cargar los secretos

Son siete, y **se cargan de dos maneras distintas**. La diferencia importa.

`supabase secrets set` toma pares `NAME=VALUE` en la línea de comandos —o un
`--env-file`—. **No pregunta el valor de forma interactiva**; verificado con
`supabase secrets set --help` en la CLI 2.113.0. Usarla con un Access Token deja
el token en el historial del shell, que es exactamente lo que hay que evitar.

**Los cuatro sensibles van por el Dashboard**, pegándolos en el navegador:

> Supabase → el proyecto → Edge Functions → **Secrets** → Add new secret

| secreto | de dónde sale |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | Walter |
| `MERCADOPAGO_WEBHOOK_SECRET` | Walter |
| `PAYMENT_LOG_HASH_SALT` | lo genera este proyecto: cadena aleatoria larga |
| `PAYMENT_WORKER_SECRET` | ídem |

Los dos últimos no son de Walter. Generarlos con un generador de contraseñas y no
volver a mirarlos es lo correcto.

**Los tres fijos y no sensibles sí pueden ir por línea de comandos**, porque su
valor es público y enumerable — está escrito en este mismo documento:

```bash
supabase secrets set MERCADOPAGO_ENVIRONMENT=production \
  --project-ref wwcpogltfgzgkrlilbcd
supabase secrets set TABA_CHECKOUT_BASE_URL=https://la-taba.pages.dev \
  --project-ref wwcpogltfgzgkrlilbcd
supabase secrets set MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved \
  --project-ref wwcpogltfgzgkrlilbcd
```

`MERCADOPAGO_PRODUCTION_REVIEW_STATUS` **es obligatorio**. Con el entorno en
`production` y este valor en cualquier otra cosa —`not_requested`, `pending`,
`rejected`— el veredicto **vuelve a DISABLED** y no se cobra. Está puesto a
propósito: pasar a producción tiene que ser un acto declarado, no la consecuencia
de haber cargado un token.

**Verificar sin leer ningún valor:**

```bash
npm run mp:config:produccion
```

Tiene que listar los siete como presentes y decir `entorno del proveedor …
production`. El entorno se identifica comparando huellas contra los dos únicos
valores posibles; el token queda opaco porque su huella no se puede revertir.

### Paso 2 · Funciones Edge — ya está hecho

Las siete están desplegadas y `ACTIVE`. Si alguna vez hay que rehacerlo:

```bash
for f in mercadopago-create-checkout-session mercadopago-create-preference \
         mercadopago-checkout-status mercadopago-webhook \
         mercadopago-payment-worker mercadopago-refund mercadopago-cancel-payment; do
  supabase functions deploy "$f" --project-ref wwcpogltfgzgkrlilbcd
done
```

Desplegarlas sin secretos es seguro y está verificado: fallan cerrado, el
proveedor sigue deshabilitado, y el worker programado cada 30 s no las invoca
porque `payment_outbox` está vacío y la función sale por `return null`.

### Paso 3 · Registrar el webhook

En la aplicación de Walter:

```
https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-webhook
```

Eventos: **pagos** (`payment`).

La firma `x-signature` se valida contra `MERCADOPAGO_WEBHOOK_SECRET`. Una
notificación sin firma válida se rechaza; una repetida no cobra dos veces.

### Paso 4 · La fila del comercio, con el interruptor APAGADO

| columna | valor |
|---|---|
| `business_id` | `00000000-0000-4000-8000-000000000001` |
| `provider` | `mercadopago` |
| `collector_id` | el de Walter |
| `application_id` | el de Walter |
| `enabled` | **`false`** |
| `installments_limit` | según la decisión 1 |
| `allow_offline_payment_methods` | según la decisión 2 |

### Paso 5 · La compuerta tiene que decir READY TO ENABLE PAYMENT

```bash
npm run mp:config:produccion   # VEREDICTO: PRODUCTION
npm run commercial:gate        # READY TO ENABLE PAYMENT
```

Si dice otra cosa, **no se enciende**. Lo que falte está listado con nombre y con
quién lo cierra.

### Paso 6 · Encender, con autorización explícita

Recién acá, y sólo con el sí de Walter:

```sql
update public.business_payment_settings
   set enabled = true
 where business_id = '00000000-0000-4000-8000-000000000001';
```

### Paso 7 · Primera compra real, controlada

La prueba con plata real exige además declararla. Por el Dashboard, igual que los
otros sensibles —aunque el valor sea fijo, escribirlo a mano en una consola es
parte del acto—:

```
MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION = I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE
```

Por el monto más chico posible:

1. Comprar un producto real desde `https://la-taba.pages.dev`.
2. Pagar con un medio real.
3. Verificar en el Panel que el pedido llegó **pagado**, y que ese estado lo
   escribió el webhook y **no** la vuelta del navegador.
4. Verificar en la cuenta de Walter que el dinero entró.
5. Devolver el pago con `mercadopago-refund` y verificar que la devolución llega.
6. `npm run commercial:gate` → **READY FOR REAL PAYMENT**.

El punto 3 es el que importa: la vuelta del navegador nunca marca un pedido como
pagado. Ese comportamiento ya está implementado y probado; el paso existe para
confirmarlo con plata real.

---

## 5 · Lo que ya está resuelto y no hay que rehacer

Verificado con las suites del repositorio el 2026-08-27 (23 casos, 0 fallos):

| propiedad | dónde está probado |
|---|---|
| La vuelta del navegador no marca pagado | `return state is derived from the server checkout never from redirect query parameters` |
| Sólo el backend confirma un pago | `lifecycle enforces authoritative stock monotonic payment state and one paid order` |
| La firma `x-signature` se valida | `webhook uses the official SDK validator and literal data.id query field` |
| Los duplicados son idempotentes | `webhook receipt and worker enforce durable deduplication leases and API reconciliation` |
| El frontend no manda montos | `checkout browser payload contains identifiers and contact only` |
| El envío entra en el total cobrado | `preferenceRequest` agrega la diferencia `total − itemsTotal` como ítem |
| La activación productiva es fail-closed | `production payment activation is fail-closed behind review and explicit confirmation` |

---

## 6 · Cómo volver atrás

1. `update business_payment_settings set enabled = false` — el checkout deja de
   ofrecer Mercado Pago de inmediato. Los pedidos en curso siguen su camino.
2. Para cortar de raíz: borrar `MERCADOPAGO_ACCESS_TOKEN` de los secretos. Las
   funciones vuelven a fallar cerrado y no cobran.
3. Las devoluciones se hacen con `mercadopago-refund`, nunca a mano en la base:
   un pago devuelto sin registrar deja el pedido y la cuenta contando cosas
   distintas.
