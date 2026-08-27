# Activación de Mercado Pago en producción

De **«Walter ya creó la aplicación»** a **«primera compra real aprobada»**, sin
adivinar nada.

Auditado contra producción el **2026-08-27**. Nada de lo que sigue está tomado
de documentación anterior: cada estado se midió.

---

## 0 · Dónde estamos hoy

| | medido |
|---|---|
| Veredicto de Mercado Pago | **DISABLED** |
| Funciones Edge en el repositorio | 7 |
| Funciones Edge desplegadas en producción | **0** |
| Filas en `business_payment_settings` | **0** |
| Secretos productivos de Mercado Pago cargados | **0 de 7** |
| `alcohol_sales_enabled` | `false` |
| Productos comprables | 33 de 72 |
| `commercial:gate` | **TECHNICALLY READY** |

El software está entero. Lo que falta no se programa.

Para volver a medirlo en cualquier momento:

```bash
npm run commercial:gate
npm run mp:config:produccion
```

---

## 1 · Lo que tiene que aportar Walter

Sin esto no se puede avanzar, y **nada de esto se puede inventar ni deducir**.

### Credenciales (de su cuenta de Mercado Pago, aplicación ya creada)

| dato | dónde lo saca | qué es |
|---|---|---|
| **Access Token productivo** | Sus integraciones → la aplicación → Credenciales de producción | La llave que cobra. Es el secreto más sensible del sistema. |
| **Public Key productiva** | mismo lugar | Identifica la aplicación ante el navegador. No es secreta, pero se trata igual. |
| **Webhook secret** | Sus integraciones → la aplicación → Webhooks → Firma secreta | Con esto se valida que una notificación es auténtica. |
| **`collector_id`** | Su cuenta → número de usuario (`user_id`) | Quién cobra. Se guarda en `business_payment_settings`. |
| **`application_id`** | Sus integraciones → la aplicación → número de aplicación | Qué aplicación cobra. Se guarda en la misma fila. |

### Decisiones comerciales

Ninguna la puede tomar el software:

1. **Cuotas.** ¿Se aceptan? ¿Hasta cuántas? Sin decisión, se cobra sin cuotas.
2. **Pago en efectivo por cupón** (`ticket`: Rapipago, Pago Fácil). Se cobra
   días después y el pedido queda pendiente mientras tanto. Por defecto está
   **excluido**.
3. **Política de devoluciones.** ¿Una devolución la aprueba el dueño
   (`owner_approval`) o alcanza con revisión (`manual_review`)?
4. **Autorización explícita de la primera compra real**, con plata de verdad.

---

## 2 · Reglas que no se negocian

- **El Access Token no se escribe en ningún archivo del repositorio**, ni en un
  `.env`, ni se pega en un chat, ni se pasa como argumento visible de shell. Va
  directo al gestor de secretos de Supabase y no sale nunca de ahí.
- **No se imprime ningún valor de secreto en ningún log.** Todo lo que verifica
  este procedimiento se contesta por presencia o por huella SHA-256.
- **No se pide la contraseña de Walter de nada.** Las credenciales las genera él
  en su panel y las carga él, o las dicta por un canal fuera de banda para que
  se carguen sin quedar escritas.
- **Fail-closed.** Falta una pieza, no se cobra. Es el comportamiento actual y no
  se cambia para acelerar la activación.
- **Alcohol sigue en `false`.** Activar cobros no habilita alcohol: son dos
  compuertas distintas y la de alcohol necesita la habilitación de expendio
  acreditada del local.

---

## 3 · El procedimiento, en orden

### Paso 1 · Cargar los secretos en Supabase producción

Seis de los siete obligatorios. Se cargan de a uno, de forma interactiva, para
que el valor no quede en el historial del shell:

```bash
supabase secrets set MERCADOPAGO_ACCESS_TOKEN   --project-ref wwcpogltfgzgkrlilbcd
supabase secrets set MERCADOPAGO_ENVIRONMENT    --project-ref wwcpogltfgzgkrlilbcd   # valor: production
supabase secrets set MERCADOPAGO_WEBHOOK_SECRET --project-ref wwcpogltfgzgkrlilbcd
supabase secrets set PAYMENT_LOG_HASH_SALT      --project-ref wwcpogltfgzgkrlilbcd
supabase secrets set PAYMENT_WORKER_SECRET      --project-ref wwcpogltfgzgkrlilbcd
supabase secrets set TABA_CHECKOUT_BASE_URL     --project-ref wwcpogltfgzgkrlilbcd   # valor: https://la-taba.pages.dev
```

Y uno más, que **también es obligatorio** aunque no sea una credencial:

```bash
supabase secrets set MERCADOPAGO_PRODUCTION_REVIEW_STATUS --project-ref wwcpogltfgzgkrlilbcd   # valor: approved
```

Es la constancia de que alguien revisó y aprobó pasar a producción. Con el
entorno en `production` y este valor en cualquier otra cosa —`not_requested`,
`pending`, `rejected`— el veredicto **vuelve a DISABLED** y no se cobra. Está
puesto a propósito: pasar a producción tiene que ser un acto declarado, no la
consecuencia de haber cargado un token.

`PAYMENT_LOG_HASH_SALT` y `PAYMENT_WORKER_SECRET` **no** son de Walter: son
secretos que genera este proyecto. Cualquier cadena aleatoria larga sirve;
generarla y no volver a mirarla es lo correcto.

**Verificar sin leer nada:**

```bash
npm run mp:config:produccion
```

Tiene que listar los siete como presentes y decir `entorno del proveedor …
production`. El entorno se identifica comparando huellas contra los dos únicos
valores posibles; el token queda opaco porque su huella no se puede revertir.

### Paso 2 · Desplegar las cinco funciones Edge obligatorias

```bash
supabase functions deploy mercadopago-create-checkout-session --project-ref wwcpogltfgzgkrlilbcd
supabase functions deploy mercadopago-create-preference       --project-ref wwcpogltfgzgkrlilbcd
supabase functions deploy mercadopago-checkout-status         --project-ref wwcpogltfgzgkrlilbcd
supabase functions deploy mercadopago-webhook                 --project-ref wwcpogltfgzgkrlilbcd
supabase functions deploy mercadopago-payment-worker          --project-ref wwcpogltfgzgkrlilbcd
```

Y las dos de devoluciones, que cierran el circuito:

```bash
supabase functions deploy mercadopago-refund          --project-ref wwcpogltfgzgkrlilbcd
supabase functions deploy mercadopago-cancel-payment  --project-ref wwcpogltfgzgkrlilbcd
```

Sin estas dos últimas se puede cobrar pero no devolver, que es un lugar
incómodo donde estar con plata real.

### Paso 3 · Registrar el webhook en Mercado Pago

En la aplicación de Walter, configurar la URL de notificaciones:

```
https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-webhook
```

Eventos: **pagos** (`payment`).

La firma que Mercado Pago envíe en `x-signature` se valida contra
`MERCADOPAGO_WEBHOOK_SECRET`. Una notificación sin firma válida se rechaza; una
repetida no cobra dos veces.

### Paso 4 · Crear la fila del comercio

Con los datos de Walter, en `business_payment_settings`:

| columna | valor |
|---|---|
| `business_id` | `00000000-0000-4000-8000-000000000001` |
| `provider` | `mercadopago` |
| `collector_id` | el de Walter |
| `application_id` | el de Walter |
| `enabled` | `true` **sólo al final**, después de la prueba controlada |
| `installments_limit` | según la decisión 1 |
| `allow_offline_payment_methods` | según la decisión 2 |

`enabled` es el interruptor que hace aparecer Mercado Pago en el checkout del
cliente. Se enciende último, a propósito.

### Paso 5 · Comprobar antes de encender

```bash
npm run mp:config:produccion   # tiene que decir VEREDICTO: PRODUCTION
npm run commercial:gate        # tiene que decir READY FOR REAL PAYMENT
```

Si la compuerta no dice `READY FOR REAL PAYMENT`, **no se enciende**. Lo que
falte está listado con nombre y con quién lo cierra.

### Paso 6 · Primera compra real, controlada

La prueba con plata real exige, además, declararla:

```bash
supabase secrets set MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION --project-ref wwcpogltfgzgkrlilbcd
# valor exacto: I_AUTHORIZE_REAL_MERCADOPAGO_PAYMENT_SMOKE
```

Con autorización explícita de Walter, y por el monto más chico posible:

1. Comprar un producto real desde `https://la-taba.pages.dev`.
2. Pagar con un medio real.
3. Verificar en el Panel que el pedido llegó **pagado**, y que el estado lo
   escribió el webhook y no la vuelta del navegador.
4. Verificar en la cuenta de Mercado Pago de Walter que el dinero entró.
5. Devolver el pago con `mercadopago-refund` y verificar que la devolución
   también llega.

El punto 3 es el que importa: **la vuelta del navegador nunca marca un pedido
como pagado**. Ese comportamiento ya está implementado y probado; el paso existe
para confirmarlo con plata real.

---

## 4 · Lo que ya está resuelto y no hay que rehacer

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

## 5 · Cómo volver atrás

Si algo sale mal después de encender:

1. `update business_payment_settings set enabled = false` — el checkout deja de
   ofrecer Mercado Pago de inmediato. Los pedidos en curso siguen su camino.
2. Si hace falta cortar de raíz: borrar `MERCADOPAGO_ACCESS_TOKEN` de los
   secretos. Las funciones fallan cerrado y no cobran.
3. Las devoluciones se hacen con `mercadopago-refund`, nunca a mano en la base:
   un pago devuelto sin registrar deja el pedido y la cuenta contando cosas
   distintas.
