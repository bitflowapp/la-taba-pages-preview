# Devolución real controlada y conciliación

Complementa [`PROCEDIMIENTO-COMPRA-REAL.md`](PROCEDIMIENTO-COMPRA-REAL.md). **Estado:** el reembolso por API nunca se certificó contra Mercado Pago real: en el entorno de prueba responde `401 Unauthorized use of live credentials` (código 7), incluso sobre un pago rechazado ([`REEMBOLSO-401.md`](../mercadopago-final-20261023/lanzamiento/REEMBOLSO-401.md)). Eso es un límite del entorno de prueba de Mercado Pago, no de lo que arma La Taba, y no se sabe si también aplica a cuentas reales. **La primera devolución real es la prueba.** Si la API vuelve a fallar, la devolución sigue siendo posible desde la cuenta del vendedor y La Taba la concilia una sola vez (probado en QA con `LT-0087`).

> Ningún asiento puede decir que se devolvió dinero sin evidencia del proveedor. Lo exige la base (una devolución sólo pasa a «ejecutada» con identificador, importe exacto y estado aprobado leídos del proveedor; una nota nunca libera una incertidumbre) y lo comprueba `verificar-devolucion`.

## 1. Autorización de la devolución (antes de tocar nada)

La devolución de control ya figura en el documento de autorización de la compra (`devolucion.*`). Además, **justo antes de ejecutarla**, el titular confirma por escrito **la operación y el importe**: «Autorizo devolver ARS *X* de la operación n.º *N*». El operador lo guarda en la carpeta de evidencia (`devolucion-autorizada.txt`). Sin esa confirmación no se ejecuta; la herramienta de verificación pide el mismo número de operación (`--operacion`) y rechaza otro.

## 2. Comprobaciones previas (sólo lectura)

| Qué | Cómo | Esperado |
|---|---|---|
| La compra verificó bien | `piloto-pago-real.mjs verificar …` | todas `PASS` |
| Identidad y credencial del vendedor | Panel → Mercado Pago → «Verificar conexión» | «La cuenta funciona»; vendedor = el autorizado |
| Permisos | scopes de la aplicación: `read`, `write`, `offline_access` (los únicos que Mercado Pago documenta) | los tres |
| Saldo | el titular mira en la app de Mercado Pago que el saldo (disponible o a liberar) cubre el importe | cubre. La documentación exige «saldo suficiente»; **no confirma** si el dinero todavía «a liberar» de una cuenta nueva alcanza (ver [`PROVEEDOR-REGLAS.md`](PROVEEDOR-REGLAS.md)) |
| Ventana | menos de 180 días desde la aprobación | sí |
| Pendientes | ninguna devolución anterior ambigua ni discrepancia abierta | ninguna |

## 3. Ejecución (una sola vez)

**Camino A, por API (el que se quiere certificar).** El titular, en el Panel: Pagos → el pago → «Devolver el dinero» → importe vacío (= total) o el importe autorizado → motivo → escribir `DEVOLVER` → confirmar. El Panel genera la clave de idempotencia y la conserva mientras la devolución no tenga una respuesta definitiva (`supabase_order_repository.js`, `requestMercadoPagoRefund`): reintentar tras una respuesta perdida no crea una segunda devolución. Aun así, **no se hace clic de nuevo ante la duda**: se mira el estado.

**Camino B, desde la cuenta del vendedor (respaldo autorizado).** El titular, en la app de Mercado Pago: Actividad → el cobro → «Devolver dinero». Después se espera el aviso del proveedor o el barrido (`taba-checkout-provider-truth-sweep`, cada pocos minutos); La Taba lo registra como `origin: external`, una sola vez.

## 4. Qué hacer según la respuesta

| Respuesta | Significado | Acción |
|---|---|---|
| `200`, devolución aprobada | el proveedor la ejecutó | verificar (§5) |
| `REFUND_REJECTED` (por ejemplo 401 código 7) | el proveedor la rechazó de forma definitiva; **no se movió dinero** | **no reintentar por API**; registrar el request id; pasar al camino B |
| Falla de red, 5xx o tiempo agotado | **resultado ambiguo**: puede haberse ejecutado | **no pedir otra**. El sistema la deja `ambiguous`, bloquea nuevas devoluciones y el worker lee la lista de devoluciones del proveedor: si la encuentra, la adopta; si la lista completa está vacía pasados 15 minutos, la cierra como «no ejecutada» (`settle_ambiguous_refund_from_provider`, v170) y recién entonces el titular puede autorizar un nuevo intento. Mientras tanto, el caso queda abierto en el Panel; el dueño puede pedir «verificar de nuevo» (`request_refund_reverification`) |
| Devolución aprobada por Mercado Pago pero La Taba la ve «ambigua» | el aviso no llegó | esperar el barrido; nunca registrarla a mano sin identificador del proveedor |

## 5. Verificación y conciliación

```bash
node scripts/mercadopago/piloto-pago-real.mjs verificar-devolucion --target production \
  --autorizacion <id> --importe <ARS> --operacion <n.º de pago> --evidencia <carpeta fuera del repo> [--entregado]
```

Comprueba, y falla ante cualquier contradicción: la operación devuelta es la autorizada; la solicitud lleva clave de idempotencia; ninguna devolución quedó ambigua o sin resolver; cada devolución aprobada trae el identificador del proveedor; la suma devuelta es **exactamente** el importe autorizado; el pago, leído de nuevo al proveedor, muestra la devolución (`refunded`, importe igual); la intención de pago coincide; cero discrepancias abiertas; el origen (`api` o `external`) queda registrado; el pedido quedó cancelado y, si el producto no se entregó, el stock volvió a su valor previo.

Después, a mano: la alerta «Pedido con el pago devuelto que sigue abierto» se cierra al **cancelar el pedido con motivo** (Panel → Pedidos); el titular ve la devolución en su cuenta de Mercado Pago; se registra request id del proveedor, importe, estado final del pago, pedido y stock.

## 6. Qué no se hace

- No se declara «devuelto» sin identificador del proveedor, aunque la pantalla de Mercado Pago del titular lo muestre: primero lo lee el backend.
- No se repite un pedido de devolución ante un resultado ambiguo.
- No se edita una migración ni un asiento para que cierre: se corrige con evidencia o con una migración nueva.
- Si la API falla también en producción, no se declara certificada: queda como límite conocido y el camino B como procedimiento vigente.
