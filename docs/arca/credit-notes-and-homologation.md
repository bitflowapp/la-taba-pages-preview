# Notas de crédito, política contable y homologación

## Política fiscal versionada

La plataforma no deriva `CbteTipo` por heurística ni usa el valor cero. `fiscal_accounting_policies` fija, por negocio y ambiente, versión, vigencia, condición del emisor y receptor, concepto, tipo de factura, tipo de nota, documento del receptor, habilitación y aprobación contable.

Una política sólo puede estar habilitada si `accountant_review_status = approved`, `approved_by` y `approved_at` están presentes. Antes de crear una factura o una nota, el servidor valida que los tipos configurados siguen presentes en snapshots recientes de las tablas oficiales sincronizadas. Si no existe coincidencia, vence la vigencia, faltan parámetros o falta aprobación, devuelve `fiscal_policy_review_required`. Los fixtures de prueba están identificados como sintéticos y no son una aprobación comercial.

## Flujo de nota de crédito

La solicitud exige owner/admin, motivo de 5 a 300 caracteres, idempotency key y una factura autorizada del mismo negocio. El servidor bloquea la factura original, resuelve la política, crea la nota en `queued`, guarda snapshots, vínculo del comprobante asociado y encola `fiscal_outbox`.

Se admiten explícitamente:

- Total: acredita sólo el saldo restante de cada ítem.
- Parcial: exige ítems originales y cantidades con precisión de tres decimales.
- Ajuste comercial: exige política que permita el ajuste y neto/IVA explícitos.

`fiscal_credit_allocations` reserva cantidad e importes antes de ARCA. Las reservas de dos operadores se serializan mediante el lock de la factura original; no pueden superar cantidad, neto, IVA ni total acreditable. Un replay de la misma clave devuelve la misma nota. Si ARCA rechaza o la política impide continuar, las reservas pendientes se liberan. La factura original permanece autorizada e inmutable.

El worker reserva numeración de forma serializada y emite mediante `FECAESolicitar` sólo cuando tiene tipo fiscal válido, snapshots completos y comprobante asociado. Una nota autorizada obtiene CAE, número, fecha, QR y PDF propios; nunca reutiliza los de la factura.

## Ambigüedad y reconciliación

Un timeout, una conexión cortada o una respuesta perdida se clasifica como `ambiguous`. Antes de cualquier reintento, el worker consulta `FECompConsultar` con el número reservado y compara número, fecha, punto de venta, tipo y total. Si coincide, recupera el CAE. Si no coincide, marca `ARCA_RECONCILIATION_MISMATCH`, detiene el outbox y exige revisión; no reemite a ciegas.

La misma disciplina aplica a facturas y notas. No se generan dos CAE, dos números ni dos eventos por una duplicación de mensajes o workers.

## PDF, QR y evidencia

Una vez autorizado, la nota sigue el mismo circuito de evidencia privada: QR armado después del CAE, PDF A4 determinista con fuente segura, hash SHA-256, metadatos y versión del generador. El PDF incluye la referencia al tipo, punto de venta, número y fecha del comprobante asociado. Un fallo de PDF no revierte la autorización ARCA y queda como `artifact_failed` con detalle sanitizado.

## Homologación controlada

Nunca ejecutar producción desde el panel. Para homologación real deben estar disponibles la confirmación exacta `I_UNDERSTAND_THIS_USES_ARCA_HOMOLOGATION`, certificado, clave, CUIT, punto de venta y relación autorizada. Con esos insumos se ejecuta, en homologación, una factura sintética y una nota asociada, se consultan ambas, se valida CAE/QR/PDF persistido, se descarga con URL efímera y se prueba el spool local.

Si falta cualquier insumo o permiso, registrar `ARCA_HOMOLOGATION_BLOCKED`. No interpretar fixtures, CAE de fixture ni pruebas unitarias como homologación externa aprobada. Producción sigue `ARCA_PRODUCTION_DISABLED_BY_DESIGN` hasta que controles independientes autoricen el ambiente.

## Seguridad y soporte

Certificado, clave privada, WSAA token/sign y service role viven sólo en procesos privados y rutas montadas. Eventos, errores y logs excluyen tokens, certificados, rutas de Storage, nombres de impresora y URLs firmadas. Para investigar un error, conservar el ID de documento, ID de outbox, código sanitizado, hash y timestamps; no copiar secretos ni PDFs a tickets públicos.

Ante `fiscal_policy_review_required`, involucrar al responsable contable para publicar una versión aprobada. Ante ambigüedad o desajuste de consulta, bloquear nuevas emisiones relacionadas y conciliar primero con ARCA. Ante un PDF faltante, revisar artefacto/outbox y regenerar sólo con permisos, sin tocar el CAE ni la factura original.
