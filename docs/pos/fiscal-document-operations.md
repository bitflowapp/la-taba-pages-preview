# Operación POS de comprobantes y notas de crédito

## Lectura de estados

La venta de mostrador se confirma primero. El estado fiscal posterior no modifica precio, stock, packing ni pago confirmado.

- Venta confirmada: la operación comercial existe y puede requerir comprobante.
- Comprobante pendiente: PostgreSQL creó la solicitud fiscal y el worker todavía no devolvió CAE.
- Autorizado / PDF pendiente: el CAE es válido, pero falta generar o recuperar el PDF privado.
- PDF disponible: existe un artefacto actual con hash SHA-256.
- PDF fallido: el CAE sigue vigente; corregir generación o permisos sin refiscalizar.
- Ambiguo: no volver a solicitar emisión; esperar reconciliación con ARCA.

La vista Estado fiscal muestra tipo/número, estado, PDF, hash abreviado, referencia de nota, preview, descarga y reimpresión. No muestra rutas privadas del servidor.

## Descarga e impresión

Antes de entregar un comprobante, abrir la vista previa y validar los datos fiscales. La descarga crea un enlace autenticado de vida corta y no conserva el PDF en el navegador. Si expira, pedir otro enlace desde el mismo comprobante.

Para imprimir o reimprimir:

1. Seleccionar impresora detectada por TABA Windows.
2. Elegir A4 o térmica y una a cinco copias.
3. Confirmar el envío.
4. Leer el estado de la cola y verificar el papel físicamente.

`sent_to_spooler` y `unknown` no son constancia de impresión física. Si Windows se reinicia mientras imprime, el trabajo se marca `unknown`; revisar la cola y crear una nueva reimpresión sólo cuando sea necesario. La carpeta de caché es un spool local autorizado, no el repositorio documental.

## Solicitud de nota de crédito

Desde la factura autorizada, abrir “Solicitar nota de crédito”, indicar motivo y elegir total, parcial o ajuste comercial. Para parcial, informar solamente ítems y cantidades que el comprobante original permite identificar. Para ajuste comercial, los importes neto/IVA deben corresponder a una política aprobada.

El panel no deja elegir un tipo fiscal, CAE ni número. La nota queda pendiente mientras PostgreSQL valida la política, el saldo acreditable y el vínculo asociado. Dos toques, dos operadores o una reconexión no deben duplicarla: la solicitud conserva una idempotency key y el servidor devuelve el mismo resultado cuando corresponde.

Si la UI informa revisión de política, excedente acreditable, error fiscal o ambigüedad, no crear una factura manual paralela ni repetir a ciegas. Conservar el mensaje sanitizado y escalar al owner/admin y al responsable contable.

## Recuperación y escalamiento

Cerrar el panel durante preview, descarga, PDF o impresión no borra la fuente de verdad. Al reabrir, refrescar Estado fiscal. Las acciones recuperables son:

- URL vencida: pedir otra URL firmada.
- Caché local borrada: volver a descargar desde el artefacto privado.
- Worker reiniciado: el outbox retoma tras vencer la lease.
- Error de impresora: revisar driver/papel/cola y reimprimir.
- PDF fallido: owner/admin solicita regeneración auditada.
- Ambigüedad ARCA: esperar `FECompConsultar`; no reemitir.

No usar datos fiscales de personas reales para pruebas. Homologación utiliza datos sintéticos y autorización externa explícita; producción no se habilita desde esta operación POS.
