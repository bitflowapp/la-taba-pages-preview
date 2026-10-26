# Primera compra real controlada: procedimiento

Una compra, un importe, un comprador, una cuenta que recibe, una devolución. Nada de esto se ejecutó contra producción: el proyecto de producción no existe todavía (`deploy/environments.json`: `not_provisioned`). Todo está ensayado de punta a punta en el banco Docker (`pilot_gate`, entornos de prueba y de ensayo de producción) y en QA con dinero ficticio.

> **Quién decide qué.** El titular decide el importe, el producto o concepto, la cuenta compradora, quién asume las comisiones y cuándo se devuelve. Ingeniería ejecuta las herramientas y verifica; **no elige ninguno de esos valores** y la plantilla los deja en blanco. Nadie comparte contraseñas ni tokens por chat: el titular se conecta por OAuth en su dispositivo.

## 0. Las siete respuestas que hacen falta antes de mover un peso

Todas van en el documento de autorización (`piloto-pago-real.mjs plantilla`). La herramienta no avanza si falta una.

| # | Pregunta | Campo | Quién responde |
|---|---|---|---|
| 1 | ¿Quién recibe el dinero? Titular y número de cuenta de Mercado Pago | `vendedor.collector_id`, `vendedor.titular` | Walter (titular) |
| 2 | ¿Quién paga? Cuenta compradora **distinta** de la vendedora y su cliente de La Taba | `comprador.*` | quien compra (Marco u otra persona) |
| 3 | ¿Qué se compra? Un producto o concepto de prueba, con retiro en el local | `compra.concepto`, `compra.items` | Walter |
| 4 | ¿Cuánto? Importe exacto en ARS, con hasta dos decimales | `compra.importe_ars` | Walter |
| 5 | ¿Quién asume las comisiones? | `comisiones.*` | Walter |
| 6 | ¿Cómo se devuelve y quién lo ejecuta? | `devolucion.*` | Walter |
| 7 | ¿Cuándo se aborta? Condiciones concretas | `abortar_si` | Walter y quien compra |

Más: nombre, cargo y fecha de quien autoriza, y cuatro declaraciones (`dinero_real`, `una_sola_compra`, `devolucion_incluida`, `importe_elegido_por_el_titular`).

Qué decide la plataforma sola, y por qué no es una elección comercial: el tope de ARS 50.000 del piloto (atrapa un cero de más; no fija precios), la vigencia máxima de 24 h, y que la compra sea con retiro y sin descuentos ni combos (para que el importe sea exactamente la suma del catálogo).

## 1. Precondiciones (una sola vez)

Los pasos 1 a 7 de [`ACTIVACION-COMERCIAL.md`](../payments-final-20261025/ACTIVACION-COMERCIAL.md): proyecto de producción, secretos, sitio publicado, ensayo y **Walter vinculó su cuenta** (el Panel dice «Mercado Pago confirmó la cuenta»). En producción el comercio queda en **piloto cerrado por defecto**: sin una autorización vigente la base rechaza cualquier pago real, aunque la llave final y el interruptor estén encendidos.

## 2. Secuencia

| Paso | Quién | Comando / acción | Resultado esperado |
|---|---|---|---|
| 1 | Titular | `node scripts/mercadopago/piloto-pago-real.mjs plantilla --destino production --salida <archivo FUERA del repositorio>` y completarla | sin `__COMPLETAR__` |
| 2 | Titular + operador | `piloto-pago-real.mjs validar --archivo <archivo>` | resumen en castellano: cuánto, quién recibe, quién paga, comisiones, devolución, aborto, y la **huella** |
| 3 | Titular y comprador | leer el resumen en voz alta y confirmar | acuerdo explícito |
| 4 | Operador | `piloto-pago-real.mjs preflight --target production --business <uuid> --archivo <archivo> --con-red` | `sin bloqueos` (más las comprobaciones manuales que imprime) |
| 5 | Operador | cargar `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved` y **la llave final**, y `cobro-negocio.mjs encender --target=production --business=<uuid> --confirmar=<slug> --revision-aprobada` (en ese orden) | el comercio ofrece Mercado Pago; **al público sigue cerrado** (candado del piloto) |
| 6 | Titular | firma el documento; el operador repite a mano importe y huella: `piloto-pago-real.mjs autorizar --target production --archivo <archivo> --evidencia <carpeta fuera del repo> --confirmo-importe <ARS> --confirmo-sha <12 hex> --confirmo-dinero-real` | `AUTORIZADA <id>: vence …`; queda la línea base de stock y el documento en la carpeta de evidencia |
| 7 | Comprador | compra **exactamente** lo autorizado, con retiro, desde su cuenta de cliente. En la pantalla de Mercado Pago comprueba importe y nombre del vendedor **antes de pagar**; si no coinciden, aborta | pago aprobado |
| 8 | Comprador | variante recomendada, sin gastar nada más: cerrar la pestaña apenas Mercado Pago muestra «aprobado», antes de volver a La Taba | el pedido aparece igual (el servidor no depende del retorno) |
| 9 | Operador | `piloto-pago-real.mjs verificar --target production --autorizacion <id> --evidencia <carpeta>` | todas `PASS`, dos `MANUAL` |
| 10 | Comprador y titular | las dos comprobaciones manuales: el comprador ve su pedido como recibido y pagado; el titular ve el cobro en la app de Mercado Pago (n.º de operación, importe, fecha de liberación) | confirmadas por escrito |
| 11 | Operador | `ops-pulse.mjs --target production --hours 2` | sin avisos |

La autorización **se consume con la primera compra**, salga bien o mal. Si el comprador abandona, hay que escribir otra: el costo de reintentar es una firma más, nunca una puerta abierta.

## 3. Qué se verifica y con qué evidencia

El orden del recorrido que pidió el responsable, con la comprobación que lo cubre (`verificar`):

1. El cliente inicia una compra real controlada → `comprador_correcto`, `autorizacion_consumida`.
2. La Taba calcula el importe → `importe_calculado_por_el_servidor` (sesión = intención = autorizado).
3. Se genera una única preferencia → `una_unica_preferencia`.
4. El comprador accede a Mercado Pago y 5. se procesa el pago auténtico → `pago_autentico_aprobado`, `entorno_correcto` (`live_mode`).
6. El backend verifica con el proveedor, no con el navegador → `verificado_directamente_con_el_proveedor`.
7. Se recibe o recupera la notificación → `aviso_de_pago` (firma válida y procesada, o recuperado por el barrido).
8. Un único pedido → `un_solo_pedido`, `sin_duplicados`.
9. El stock se actualiza una sola vez → `stock_una_sola_vez` (contra la línea base).
10. El comprador ve el estado real → manual.
11. La cuenta que recibió el dinero → `cobrador_correcto` (cobrador = autorizado, configurado y distinto de la integradora) + manual en la app del titular.
12. Conciliación → `conciliacion_limpia` (cola vacía, ninguna discrepancia abierta).

Nunca se confirma una compra por los parámetros de la URL de retorno: la pantalla de retorno pregunta al servidor, que relee el pago al proveedor (probado: URL «aprobada» contra backend pendiente no confirma).

## 4. Qué pasa si…

| Situación | Qué hace el sistema | Qué hace la persona |
|---|---|---|
| El comprador cierra el navegador antes del retorno | el webhook (o el barrido del proveedor) arma el pedido igual | nada; verificar |
| Llega el mismo webhook dos veces | el segundo se registra como duplicado; un pedido, un descuento de stock | nada |
| Se pierde la conexión del comprador | la pantalla reintenta; el servidor no depende de ella | esperar |
| El pago queda `in_process` / pendiente | sin pedido, sin cancelar la reserva a ciegas; el proveedor decide después | **no** repetir el pago ni cancelar; esperar el estado final (en QA un OTHE `in_process` terminó `rejected` ~9 h después) |
| Mercado Pago rechaza el pago | sin pedido, stock repuesto | la autorización ya se consumió: escribir otra si se quiere reintentar |
| El importe o el vendedor en Mercado Pago no son los autorizados | — | **abortar antes de pagar** y `abortar --autorizacion <id> --motivo …` |
| Pago aprobado a una cuenta equivocada | `cobrador_correcto` falla | **apagado inmediato** (nivel 1 de reversión), devolver desde esa cuenta, no seguir |
| Webhook responde 503 | el pago no se pierde (barrido del proveedor) | apagar el cobro y no abrir hasta corregirlo |

Condiciones de aborto del sistema, siempre: pago sin pedido que no se puede rearmar; pedido sin pago; cobro o devolución duplicados; firma inválida aceptada; stock corrupto; credencial expuesta; binding incorrecto. Ante cualquiera: [`asistente-activacion.mjs reversion`](../payments-final-20261025/ACTIVACION-COMERCIAL.md).

## 5. Después

La devolución de control: [`PROCEDIMIENTO-DEVOLUCION.md`](PROCEDIMIENTO-DEVOLUCION.md). Abrir al público es una decisión **aparte**, posterior y firmada: `set_live_payment_scope(..., 'public', …, 'I_AUTHORIZE_PUBLIC_REAL_PAYMENTS')` no figura en ningún comando de esta herramienta a propósito.
