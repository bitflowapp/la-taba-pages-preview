# La Taba — Mapa de operación diaria

## Modelo de jornada recomendado

```text
Abrir jornada
  → confirmar que se puede recibir y cobrar
  → tomar pedidos por prioridad
  → preparar y verificar stock
  → entregar / seguir delivery
  → resolver excepciones
  → conciliar dinero y fiscal
  → cerrar jornada
```

La interfaz actual contiene casi todos estos componentes, pero están distribuidos
entre el panel local/demo, el Centro de operación, el monitor de pagos, fiscal,
Windows/Tauri y Rider. El mapa siguiente define el comportamiento que debería
aprender una persona, independientemente de la pantalla que lo implemente.

## Flujo por persona

| Persona / tarea | Inicio | Toques y decisiones | Información imprescindible | Error / recuperación | Acción final | Riesgo / dependencia |
|---|---|---|---|---|---|---|
| Cliente: comprar | Catálogo | elegir producto, cantidad, delivery/retiro | precio vigente, stock, mínimo, costo envío | producto sin stock o mínimo no alcanzado; ajustar carrito o elegir retiro | pedido listo | P1 si el mensaje no explica alternativa |
| Cliente: confirmar | Checkout | nombre, teléfono, dirección, notas, medio de pago | total final, modalidad, qué pasa después de confirmar | timeout, sin conexión, pago pendiente; conservar carrito y no duplicar | confirmación verificable o estado pendiente | P0 por dinero/pedido |
| Cliente: seguir | Tracking | abrir último pedido, leer estado | folio, estado, última confirmación | sin confirmación; volver a consultar, no crear otro pedido | pedido entregado / revisión | P1 si no distingue estado local de autoridad |
| Walter: abrir | Centro operativo | revisar conectividad, pagos, pedidos, stock, impresora, fiscal, rider | una checklist de go/no-go | elemento bloqueado con responsable | jornada abierta | P0; hoy falta una superficie única |
| Walter: atender pedido | Pedidos / Centro | ordenar por nuevo, demorado, dinero y entrega; aceptar → preparar → listo | cliente, dirección, total, pago, stock, notas, deadline | estado cambiado o outbox pendiente; reconciliar antes de repetir | pedido listo o cancelado con motivo | P0 si se pierde un pedido |
| Walter: manejar pago | Pagos / alerta | reconocer, reconciliar, revisar pedido asociado; no volver a cobrar | importe, pedido, estado autoridad, última consulta | aprobado sin pedido, ambiguo, tardío, refund | pago conciliado, revisión manual o refund autorizado | P0; sólo owner/admin en acciones financieras |
| Walter: asignar rider | Pedido listo | elegir rider, confirmar asignación | zona, dirección, tiempo, señal del rider | rider sin señal o conflicto de revisión | entrega asignada y visible | P1; depende de Rider certificado |
| Walter: revisar fiscal | Estado fiscal / config | leer documento, CAE, PDF, QR, print | estado traducido, comprobante, copia, vencimiento | ARCA ambiguo, PDF fallido, política pendiente | fiscal autorizado o incidente escalado | P0/P1 según bloqueo de venta |
| Walter: cerrar | Centro operativo | declarar efectivo, explicar diferencia, revisar alertas, cerrar | esperado, declarado, diferencia, alertas abiertas, hash | diferencia o alerta crítica; documentar y no ocultar | cierre inmutable | P0 por dinero y auditoría |
| Empleado: recibir stock | Scanner / Inventario | escanear GTIN, confirmar presentación/factor, registrar cantidad | producto correcto, unidad/pack, remito, stock autoritativo | código inválido/desconocido; buscar o crear borrador para revisión | movimiento confirmado | P1; el scanner debe evitar silencios |
| Empleado: preparar | Preparación | elegir pedido, iniciar, escanear ítems, resolver faltantes | manifiesto, cantidades, excepciones, estado de sincronización | offline/outbox/conflicto; no confirmar hasta reconciliar | preparación confirmada | P0 si se entrega incompleto |
| Empleado: mostrador | Mostrador | escanear, revisar total, medio de pago, comprobante | total revalorado, stock, medio, fiscal solicitado | venta confirmada con fiscal pendiente; continuar venta sin afirmar CAE | venta confirmada y estado fiscal claro | P0/P1 |
| Rider: entrar | App Rider | iniciar sesión, leer cola, refrescar | rol, negocio, pedidos disponibles/asignados | sesión vencida; volver a ingresar | cola confirmada | P1 |
| Rider: tomar pedido | Pedido disponible | abrir, revisar bultos, cobro, zona, restricciones, reclamar | código, retiro, zona, importe a cobrar, restricciones | conflicto porque otro rider lo tomó; volver a cola | pedido asignado | P1 |
| Rider: iniciar entrega | Pedido asignado | aceptar permisos, activar GPS, iniciar | ubicación precisa, notificación, red, batería | permiso denegado, GPS apagado, red ausente; abrir Ajustes y reintentar | seguimiento activo y servidor confirmado | P0 de piloto; físico `NOT_RUN` |
| Rider: entregar | Entrega activa | retirar, salir, llegar, ingresar código de 4 dígitos | estado de pedido, dirección, cliente, código, señal | código incorrecto/rate limit, cliente ausente, problema; reportar incidencia | entrega confirmada por servidor | P0 si se declara entregado sin confirmación |

## Centro operativo: orden recomendado de lectura

La pantalla actual agrupa métricas de pedidos nuevos, demorados, pagos,
stock, packing, entregas, fiscal, impresión, outbox y conciliaciones. La lectura
novata debería convertirlas a esta secuencia:

1. **Dinero:** pagos pendientes, pagos en revisión, aprobado sin pedido,
   refund/contracargo.
2. **Pedidos:** nuevos, demorados, pedidos sin stock.
3. **Entrega:** packing incompleto, entregas activas, riders sin señal.
4. **Fiscal y papel:** documentos pendientes, CAE/PDF, impresiones fallidas,
   notas de crédito.
5. **Continuidad:** outbox bloqueadas y acciones de soporte.
6. **Cierre:** efectivo esperado, declarado, diferencia y alertas abiertas.

## Dependencias de Marco

Marco no debería ser requerido para una tarea rutinaria. Debe intervenir sólo en:

- activar o revisar gates productivos de Mercado Pago;
- aprobación contable/política ARCA y certificados del worker privado;
- pago aprobado sin pedido o pago ambiguo sin resolución autorizada;
- recuperación de instalación/backup, permisos de equipo o incidente crítico;
- certificación física de impresora y Rider.

La interfaz debe indicar explícitamente “requiere owner/admin”, “requiere contador”
o “requiere soporte técnico”, en lugar de dejar que la persona descubra el permiso
por un error genérico.

