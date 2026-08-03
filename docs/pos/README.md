# Venta de mostrador e impresión

## Flujo

El carrito local es un borrador reanudable. El cliente envía únicamente IDs, cantidades, medio de pago, intención fiscal e idempotency key. PostgreSQL vuelve a leer productos verificados, bloquea stock, calcula precios, crea items/pago/movimientos y confirma la venta en una transacción.

La solicitud fiscal ocurre después. Por eso se distinguen:

- `Venta registrada`: pago, venta y stock confirmados.
- `Comprobante pendiente`: existe una intención fiscal todavía no autorizada.
- `Factura autorizada`: sólo con estado autorizado y CAE de 14 dígitos.
- `Requiere revisión`: la venta permanece confirmada y el problema fiscal queda visible.

Una caída de ARCA, del worker o de la impresora nunca borra ni revierte la venta. Offline sólo se conserva el borrador; no se confirma venta ni se descuenta stock localmente.

## Impresión

Tauri enumera impresoras locales/conectadas de Windows y envía `raw_text` a una impresora térmica común mediante Winspool. Se valida nombre, título, formato y tamaño. Esto no es integración con controlador fiscal.

El servicio privado genera A4/PDF. Antes del CAE sólo puede producir “Comprobante interno no fiscal — autorización pendiente”; después del CAE incorpora autorización y QR. La reimpresión debe partir del documento persistido, nunca volver a fiscalizar ni asignar otro número.

Checklist: instalar el driver del fabricante, seleccionar la impresora, imprimir una prueba no fiscal, desconectarla para verificar el error, reconectarla y reimprimir. Confirmar ancho/papel/codificación en el equipo final. Para PDF, verificar visualmente emisor, receptor aplicable, items, totales, CAE, vencimiento y QR.

## Operación de comprobantes

Los pasos de preview, descarga privada, reimpresión confirmada, solicitud de nota, recuperación y escalamiento están en [Operación POS de comprobantes y notas de crédito](fiscal-document-operations.md).

## Recuperación y rollback

Una venta incompleta se recupera por su idempotency key. No crear otra clave mientras no se haya reconciliado. Una venta confirmada no se elimina para corregir fiscalidad; corresponde el documento rectificativo autorizado que determine la política contable.

El rollback de UI no altera ventas existentes. Ante falla de impresión, conservar el estado fiscal, corregir la impresora y usar reimpresión. Ante rechazo fiscal, mostrar código/mensaje sanitizado y derivar a revisión; no convertirlo en éxito.
