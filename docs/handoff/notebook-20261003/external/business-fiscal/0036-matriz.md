# Matriz de certificación sintética del panel

Jornada completa ejecutada contra un backend en memoria que reproduce las invariantes del
servidor (idempotencia, revisión esperada, un pedido por pago, ledger de stock). **No se tocó
producción, Mercado Pago real ni ARCA externo.** Todos los datos llevan etiqueta QA:
`NEGOCIO QA`, `CLIENTE QA`, `RIDER QA`, `NO COBRAR`, `NO FACTURAR`, `NO ENTREGAR`.

Ejecutada: 2026-08-04T22:24:29.437Z

| # | Escenario | Comprobaciones | Resultado |
|---|---|---|---|
| 1 | Apertura | 8/8 | PASS |
| 2 | Pedido normal | 7/7 | PASS |
| 3 | Pagos | 11/11 | PASS |
| 4 | Scanner y alta de producto | 15/15 | PASS |
| 5 | Packing e impresión | 11/11 | PASS |
| 6 | Fiscal | 9/9 | PASS |
| 7 | Rider | 6/6 | PASS |
| 8 | Cierre diario | 10/10 | PASS |
| P | Permisos | 5/5 | PASS |
| — | **Total** | **82/82** | **PASS** |

## Detalle

### 1. Apertura

- [x] la apertura revisa backend, pagos, fiscal, Rider, colas, lector, impresoras e internet
- [x] veredicto "todo listo" con backend, pagos, fiscal, Rider y colas en orden
- [x] veredicto "venta permitida con fiscal pendiente"
- [x] veredicto "cobros bloqueados" cuando falla algo esencial
- [x] el scanner y la impresora sin probar quedan "sin verificar", no "listo"
- [x] el scanner simulado y la impresora virtual quedan verificados al probarlos
- [x] el ARCA fixture se lee como activo sin salir a ARCA externo
- [x] la pantalla de apertura no usa jerga técnica

### 2. Pedido normal

- [x] el pedido sintético está etiquetado como QA
- [x] el pedido recorre nuevo → aceptado → preparando → listo → asignado → terminal
- [x] no se puede saltear un estado
- [x] reintentar el mismo avance no duplica el pedido ni sus eventos
- [x] el stock bajó exactamente lo vendido, una sola vez
- [x] el equipo navega el panel del día sin pantallas rotas
- [x] los mensajes del pedido están en castellano llano

### 3. Pagos

- [x] los seis fixtures se clasifican en el estado esperado
- [x] un aprobado sin pedido frena la entrega
- [x] la inconsistencia de importe queda en revisión y no se entrega
- [x] recuperar un pago aprobado sin pedido crea un solo pedido (exactly-once)
- [x] reintentar la recuperación no descuenta stock dos veces
- [x] el ledger de stock no tiene movimientos repetidos por la misma clave
- [x] el equipo no recibe conciliar ni devolver
- [x] owner recibe conciliar y devolver con confirmación escrita
- [x] no se puede devolver más de lo cobrado
- [x] el diagnóstico para soporte no arrastra datos del cliente ni jerga
- [x] el asistente de cobros declara listo sin salir a Mercado Pago real

### 4. Scanner y alta de producto

- [x] la entrada HID reconoce los cuatro formatos con su dígito verificador
- [x] los ceros iniciales se conservan
- [x] un código conocido resuelve al producto QA
- [x] un pack informa su factor de unidades
- [x] una lectura duplicada inmediata se ignora
- [x] un dígito verificador inválido se rechaza y se explica
- [x] un largo no soportado se rechaza sin inventar un formato
- [x] un código desconocido propone borrador y nunca publica
- [x] el borrador nace en "Falta completar" y no crea producto visible
- [x] el alta valida los datos obligatorios antes de publicar
- [x] la vista previa muestra la ficha antes de publicar
- [x] con precio pendiente el producto se ve en el catálogo pero no se puede comprar
- [x] con el precio confirmado pasa a comprable
- [x] cada alta queda auditada con su acción
- [x] un código ya asignado no se puede reutilizar

### 5. Packing e impresión

- [x] una lectura correcta se registra
- [x] la misma lectura repetida no se cuenta dos veces
- [x] un código ajeno al pedido se rechaza
- [x] con faltantes, confirmar sin motivo queda bloqueado
- [x] una sustitución o intervención se puede deshacer
- [x] el packing incompleto se cierra sólo con excepción explicada
- [x] la impresora sin papel se informa como tal
- [x] un trabajo aceptado por el spooler NO se declara impreso
- [x] un resultado no verificable se declara no verificable
- [x] la reimpresión vuelve a quedar como enviada, nunca como impresa
- [x] ninguna impresión sintética afirma salida física

### 6. Fiscal

- [x] con ARCA disponible el comprobante queda autorizado con su CAE
- [x] con ARCA caído no se inventa CAE y queda recuperable
- [x] un certificado vencido bloquea y se explica en castellano
- [x] una respuesta ambigua no vuelve a emitir a ciegas
- [x] un comprobante pendiente queda en cola recuperable
- [x] un PDF fallido no toca la autorización ya obtenida
- [x] la venta y el pago siguen confirmados aunque falle lo fiscal
- [x] la producción fiscal sigue deshabilitada en todos los fixtures
- [x] no se filtra clave privada, ticket ni intercambio técnico

### 7. Rider

- [x] el pedido llega a listo antes de asignar
- [x] la asignación al RIDER QA deja el pedido asignado
- [x] un segundo claim sobre el mismo pedido no prospera
- [x] una incidencia se registra sin inventar posición
- [x] el cierre sintético lleva el pedido a terminal una sola vez
- [x] el RIDER QA no recibe ninguna pantalla de administración

### 8. Cierre diario

- [x] el cierre explica cada diferencia en su propia sección
- [x] la diferencia de caja se muestra y bloquea sin explicación
- [x] los problemas críticos bloquean el cierre
- [x] la devolución de Mercado Pago aparece como diferencia del día
- [x] el pedido abierto se cuenta sin cerrarlo por su cuenta
- [x] los movimientos de stock del día quedan informados
- [x] los comprobantes pendientes se informan sin darlos por emitidos
- [x] CERRAR IGUAL se exige sólo cuando hay problemas críticos
- [x] con la diferencia explicada el cierre se firma y queda auditado
- [x] volver a cerrar el mismo día no genera un segundo cierre

### P. Permisos

- [x] el equipo opera el día pero no toca dinero, precios ni fiscal
- [x] owner y admin tienen las mismas atribuciones
- [x] el Rider no recibe ninguna pantalla del panel
- [x] el cliente no recibe ninguna pantalla del panel
- [x] el equipo no ve las pantallas de publicación, fiscal ni cierre

## Alcance y límites

Esta certificación prueba **el panel**, no la base de datos. El backend sintético existe para
poder recorrer una jornada completa; las invariantes que aparecen abajo las garantiza el
servidor y aquí sólo se reproducen para verificar que el panel se comporta bien frente a ellas.

| Invariante | Dónde se garantiza de verdad | Qué certifica esta corrida |
|---|---|---|
| Un pago aprobado produce un solo pedido | `finalize_paid_checkout_session` | Que reintentar la recuperación desde el panel no duplica el pedido |
| El stock no se descuenta dos veces | `apply_inventory_movement` y su ledger inmutable | Que el panel no dispara un segundo descuento al reintentar |
| La revisión esperada evita pisar cambios ajenos | `transition_order`, `start_packing_session` | Que el panel manda la revisión y traduce el conflicto sin jerga |
| Una lectura de packing pertenece al pedido | `record_packing_scan` | Que el panel no cuenta un producto ajeno ni confirma con faltantes |
| Publicar producto exige owner/admin | `publish_catalog_product_draft` | Que el panel no ofrece la acción al equipo |
| Homologación exige la frase exacta | `authorize_arca_homologation` | Que el panel no la deja pasar con otro texto |

Lo que **no** cubre esta corrida:

- La aplicación real de esas reglas contra PostgreSQL. Ese gate se declara por separado y no
  se da por aprobado si no se ejecutó.
- Impresión física: ninguna comprobación afirma que haya salido papel. El escenario 5 verifica
  justamente lo contrario, que un trabajo aceptado por el spooler se reporte como enviado.
- GPS real del repartidor: el escenario 7 recorre la asignación y el cierre sin posición física.

La facturación permanece en homologación en todos los fixtures; no hay ruta de producción.
