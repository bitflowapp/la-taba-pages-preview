# Demo para Walter — La Taba, canal propio de pedidos

Recorrido de **5 minutos máximo** en un celular: el cliente pide, el negocio
administra, el repartidor entrega con código y el cliente vuelve a comprar.
Sin jerga técnica: se muestra el producto funcionando.

> Nota: `docs/presentacion-walter.md` y `docs/checklist-demo-walter.md`
> describen una versión anterior (pedido por WhatsApp). Este guión corresponde
> al flujo actual: pedido confirmado en la app, con seguimiento y entrega.

## 1 · Preparación (antes de que llegue Walter)

- Levantar la app en esta compu:
  `python -m http.server 8080 --directory C:\1212\la-taba-pages`
- **URL de la demo:** `http://127.0.0.1:8080/?reset=1&pitch=1`
  - `reset=1` borra pedidos de prueba viejos y deja la demo limpia.
  - `pitch=1` abre la presentación comercial de entrada.
- Si algo queda sucio a mitad de la demo: panel del negocio →
  **Guía para presentar la demo → Reiniciar demo**, o recargar con la URL de arriba.
- PIN del comercio (demo): `1234`.
- Opcional (dos celulares en la misma Wi-Fi):
  `npm run realtime:demo` y abrir `http://IP-DE-LA-COMPU:8787/?relay=http://IP-DE-LA-COMPU:8787&room=walter`.
  En el panel del rider → Opciones avanzadas están los botones
  **Copiar link cliente / Copiar link rider**.

## 2 · Orden exacto de pantallas y qué decir

| # | Pantalla | Qué decir |
|---|----------|-----------|
| 1 | Presentación (`pitch`) | "Esto es La Taba online: tu propio canal de pedidos, con tu marca. Sin comisiones de plataformas ni audios sueltos." Tocar **Probar la demo**. |
| 2 | Home | "El cliente ve si estás abierto, la zona de entrega y las ofertas del día." |
| 3 | Catálogo + detalle | "Elige un corte, ve precio y presentación." Abrir un producto, **Agregar al pedido**. |
| 4 | Carrito + checkout | "El pedido llega escrito y completo: nada de interpretar audios." Completar nombre, teléfono, dirección, forma de pago. Marcar **Recordar mis datos**. **Confirmar pedido**. |
| 5 | Seguimiento | "El cliente ve el estado real y un **código de entrega** de 4 dígitos. No inventamos minutos ni GPS: lo que se ve es lo que pasa." |
| 6 | Panel del negocio (PIN 1234) | "Así te llega a vos: pedido nuevo arriba, con total, pago y dirección. Lo aceptás y avisás cuánto tarda." **Aceptar pedido** (elegir minutos) → **Marcar como listo**. Mostrar **Copiar ticket** ("esto va directo a la cocina"). |
| 7 | Vista del repartidor | "El repartidor ve dirección, referencia y cuánto cobrar." **Salí del local** → **Llegué al domicilio**. |
| 8 | Código de entrega | "Le pide el código al cliente: la entrega queda validada, sin discusiones de 'nunca me llegó'." Ingresar el código que se ve en Seguimiento → **Confirmar código** → **Pedido entregado**. |
| 9 | Seguimiento (cliente) | "El cliente ve entregado y el código confirmado." |
| 10 | Home → Pedir de nuevo | "La próxima vez, repite su pedido en un toque. Y el sistema le marca el avance a cliente frecuente." **Repetir pedido** (mostrar, no hace falta confirmarlo). |
| 11 | Panel del negocio → Caja | "Cerrás el día con ventas, efectivo vs transferencia y entregas validadas." |

## 3 · Los tres flujos, en una frase cada uno

- **Cliente:** elige → confirma → sigue el pedido → recibe con código → repite.
- **Negocio:** pedido nuevo arriba → aceptar con tiempo → listo → reparto → caja del día.
- **Repartidor:** dirección y cobro claros → salida → llegada → código → entregado.

## 4 · Recompra y clientes frecuentes

- Con **Recordar mis datos**, el pedido queda en el historial local del cliente.
- En Home aparece **Pedir de nuevo** con su último pedido y la dirección usada;
  si un precio cambió, se recalcula con valores actuales y se avisa.
- La señal de fidelización ("Llevás X de 5 pedidos") la ve el cliente, y el
  negocio ve "cliente recurrente / pedidos previos" en cada pedido entrante.

## 5 · Qué NO prometer (honestidad de la demo)

- No procesa pagos: el pago se coordina con el local (efectivo/transferencia).
- No muestra GPS salvo que el repartidor comparta ubicación real.
- No calcula rutas ni tiempos mágicos: los minutos los pone el negocio.
- No hay precios de servicio definidos: no inventar costos ni comisiones.

## 6 · Pregunta de cierre

> **"¿Te serviría que los pedidos propios de La Taba entren así, ordenados,
> con seguimiento y sin depender de audios sueltos?"**

Si la respuesta es sí: acordar próximo paso concreto (cargar el catálogo real
del local y probarlo una semana con pedidos reales del mostrador).
