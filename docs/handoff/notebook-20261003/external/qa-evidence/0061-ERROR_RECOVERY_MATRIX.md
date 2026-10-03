# La Taba — Matriz de errores y recuperación

Regla general: el mensaje principal debe responder `qué pasó`, `si es seguro
continuar`, `qué hago ahora`, `quién puede hacerlo` y `cómo sé que terminó`.

| Actor | Situación | Riesgo | Mensaje operativo recomendado | Acción segura | Cierre / escalamiento |
|---|---|---|---|---|---|
| Cliente | Pago vuelve aprobado pero no aparece pedido | Cobrar/preparar dos veces | “El pago figura aprobado, pero todavía no confirmamos el pedido. No vuelvas a pagar. Estamos verificando.” | esperar estado; conservar sesión/carrito | si no se resuelve, owner revisa por ID; no repetir POST |
| Cliente | Timeout al volver de Mercado Pago | Pedido duplicado | “No sabemos todavía el resultado. No creamos otro pedido. Podés volver más tarde.” | consultar la misma sesión | escalamiento por checkout/payment/order ID |
| Cliente | Sin conexión en checkout | Pérdida de intención | “Sin conexión. Conservamos tu carrito; reintentá cuando vuelva internet.” | no tocar varias veces | si continúa, soporte |
| Cliente | Producto se quedó sin stock | Promesa inválida | “Este producto ya no tiene stock suficiente. Ajustá la cantidad o elegí otra opción.” | editar carrito | confirmar nuevo total |
| Cliente | Pago pendiente / en proceso | Interpretar como rechazo o éxito | “El pago todavía está en revisión. No repitas el pago.” | esperar reconciliación | owner ve alerta si excede SLA |
| Walter | Pago aprobado sin pedido operativo | Dinero sin pedido | “Pago recibido sin pedido. No cobrar nuevamente. Reconciliar y finalizar o enviar a revisión.” | abrir incidente con ID; no crear pedido manual paralelo | owner/admin; Marco si la reconciliación no coincide |
| Walter | Pago ambiguo | Doble refund/reintento | “Resultado incierto. Consultá el mismo pago antes de reintentar.” | Reconciliar | cerrar como conciliado o revisión manual |
| Walter | Pedido nuevo no aparece | Venta perdida | “La última sincronización no está confirmada.” | refrescar; revisar outbox y fuente autoritativa | soporte si no cambia |
| Walter | Estado de pedido cambió mientras operaba | Sobrescritura | “El pedido cambió en otro equipo. Actualizá antes de continuar.” | refrescar y releer | no insistir con el mismo botón |
| Walter | Pedido sin stock | Venta incompleta | “Este pedido necesita una decisión: reemplazar, cancelar o esperar reposición.” | registrar motivo y comunicar | owner decide; empleado no inventa stock |
| Walter | Rider sin señal | Cliente desinformado | “La entrega sigue asignada, pero no hay confirmación reciente del Rider.” | contactar al Rider / reasignar según política | resolver cuando llega nueva confirmación |
| Walter | Fiscal pendiente | Confundir venta con CAE | “Venta confirmada; comprobante fiscal pendiente. Podés continuar sólo según política del local.” | no prometer factura autorizada | contador/worker si bloquea |
| Walter | ARCA ambiguo | Doble emisión | “No se confirmó la autorización. No emitas otra vez; hay que consultar antes.” | mantener outbox y conciliar | responsable fiscal |
| Walter | PDF fiscal fallido | Comprobante autorizado sin copia | “El CAE sigue válido, pero falta el PDF. Podés regenerar con permiso.” | no refiscalizar | owner/admin o soporte |
| Empleado | GTIN inválido | Movimiento equivocado | “El código no tiene un formato válido. Revisá la etiqueta o ingresalo de nuevo.” | reescanear / ingreso manual | no ajustar stock |
| Empleado | GTIN desconocido | Producto incorrecto | “No encontramos este producto. Verificá presentación o mandalo a revisión.” | crear borrador; no publicar sin autorización | owner/admin |
| Empleado | Packing offline | Entrega incompleta | “Guardamos la lectura local, pero todavía no está confirmada. No cierres la preparación.” | volver a conectar y reconciliar | confirmar sólo con servidor |
| Empleado | Impresión `sent_to_spooler` | Asumir papel impreso | “Windows aceptó el trabajo; falta verificar el papel.” | revisar impresora física | marcar verificable o reimprimir conscientemente |
| Empleado | Impresión `unknown` | Duplicar comprobante | “No sabemos si imprimió. Revisá cola y papel antes de reintentar.” | inspección física | dejar evidencia del resultado |
| Rider | Sesión vencida | Operar sin autoridad | “Tu sesión venció. Volvé a ingresar para confirmar pedidos.” | login | si falla, soporte |
| Rider | Permiso de ubicación denegado | Salir sin tracking | “La entrega no se inició: habilitá ubicación precisa desde Ajustes.” | Abrir Ajustes y reintentar | no salir hasta estado activo |
| Rider | GPS débil / ubicación vieja | Cliente ve ruta desactualizada | “La ubicación está débil. El pedido sigue activo; buscá señal antes de continuar.” | detenerse en zona segura, revisar ubicación/red | negocio contacta si supera umbral |
| Rider | Sin red | Estado incierto | “No hay conexión. Conservamos la última confirmación; reintentaremos.” | no duplicar acción | reconciliar al recuperar señal |
| Rider | Conflicto de revisión | Acción desactualizada | “El pedido cambió. Actualizalo antes de marcarlo.” | refrescar | continuar con el nuevo estado |
| Rider | Código de entrega incorrecto | Entrega fraudulenta o bloqueada | “Código incorrecto. Pedile el código al cliente y revisá el pedido.” | no insistir; respetar rate limit | incidencia si cliente no lo tiene |
| Rider | Cliente ausente / dirección incorrecta | Pedido sin cierre | “Informá la incidencia; el pedido no se cancela solo.” | reportar motivo y esperar decisión | owner confirma siguiente paso |
| Owner | Diferencia de caja | Cierre falso | “Hay una diferencia de $X. Explicala antes de cerrar.” | contar de nuevo, registrar nota | owner/admin cierra; auditoría conserva diferencia |
| Soporte | Backup/diagnóstico | Exponer secretos/PII | “Exportá sólo diagnóstico sanitizado; no adjuntes tokens, PDFs ni datos de cliente.” | usar acción integrada | escalar con ID/código/hash |

## Taxonomía de estados que debe aparecer siempre

- **Confirmado:** autoridad del servidor confirmó la acción.
- **Pendiente:** la acción existe, pero todavía no terminó.
- **Incierto:** no repetir; primero consultar/reconciliar.
- **Rechazado:** la autoridad negó la acción; explicar alternativa.
- **No autorizado:** el rol o ambiente no permite continuar.
- **Bloqueado:** continuar sería inseguro; mostrar responsable.

