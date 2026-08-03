# Comprobantes fiscales persistidos en Windows

## Fuente de verdad y almacenamiento

PostgreSQL conserva el estado fiscal, la auditoría y los metadatos del artefacto. El PDF autorizado vive en el bucket privado `fiscal-documents` de Supabase Storage; nunca en una URL pública, `localStorage` ni una ruta temporal del panel.

Cada PDF actual se registra en `fiscal_document_artifacts` con negocio, comprobante, tipo, proveedor, ruta privada, MIME, tamaño, SHA-256, número, fecha, generador y encadenamiento de supersesión. La restricción parcial de artefacto actual impide dos PDFs vigentes del mismo tipo. Una regeneración no reemplaza bytes: conserva el anterior como `artifact_superseded` y deja la nueva generación auditada.

El worker privado reclama `fiscal_artifact_outbox` con lease. Sólo genera después de un CAE válido y carga el objeto con `x-upsert: false`; si una reentrega encuentra la misma ruta, verifica el SHA-256 antes de aceptarla. La ruta incorpora UUID de negocio, documento y token de generación, por lo que no es adivinable ni se expone al panel.

## Estados y recuperación

La venta confirmada y la autorización fiscal son independientes del PDF. El documento puede estar `authorized` con uno de estos estados de artefacto:

- `artifact_pending`: CAE válido, esperando worker.
- `artifact_generating`: existe una lease activa.
- `artifact_ready`: metadata y PDF privado persistidos.
- `artifact_failed`: falló el PDF; el CAE no se revierte.
- `artifact_superseded`: generación histórica no vigente.

Al reiniciar el panel no se pierde el documento: el panel vuelve a consultar PostgreSQL y pide una URL nueva. Al reiniciar el worker expira la lease y otro worker puede reclamar la misma generación. Una entrega duplicada es idempotente por token de generación y hash. Si se borra la caché local, el PDF se descarga de Storage privado otra vez. Si vence una URL firmada, se descarta y se solicita una nueva; no se almacena.

## Vista previa y descarga

La acción de preview, descarga o impresión llama a la Edge Function `fiscal-artifact-access`. Primero ejecuta la autorización SQL con la identidad del operador y registra el evento; después, desde un contexto privado, crea una URL firmada HTTPS de 60 segundos. La respuesta no contiene `storage_path`, secretos ni una URL persistible.

El panel mantiene la URL solamente en memoria para el `iframe` de preview o el enlace de descarga. Para descargar de nuevo debe pedir otro acceso. Owner, admin y staff pueden consultar un artefacto actual de su negocio; sólo owner/admin pueden solicitar regeneración.

## Impresión y reimpresión

Antes de enviar bytes al escritorio, el panel solicita `fiscal_print_jobs` con hash SHA-256 del nombre local de impresora, formato y entre una y cinco copias. Luego pide confirmación explícita al operador. El nombre de la impresora no se envía a PostgreSQL.

Tauri guarda el PDF temporalmente sólo bajo `app_data_dir/fiscal-spool` y registra la cola durable local en SQLite. Se usan escrituras nuevas y rename atómico; una recuperación encuentra un spool huérfano como `unknown`, sin reimprimirlo automáticamente. Un trabajo repetido con el mismo ID no vuelve a despacharse.

Los estados significan:

- `queued`: auditado y esperando spool local.
- `sent_to_spooler`: el driver aceptó el envío, sin comprobación física.
- `completed_when_verifiable`: reservado para una verificación real disponible.
- `failed`: error local o de impresora.
- `unknown`: reinicio o resultado que Windows no puede verificar.

El envío A4 por Shell/driver sólo se informa como `unknown`; una impresora térmica puede quedar `sent_to_spooler`. Ninguno equivale a “impreso” sin evidencia verificable. Reimprimir no emite otra factura, otro CAE ni otra numeración.

## Operación y troubleshooting

1. Abrir Estado fiscal y confirmar CAE, PDF disponible y hash abreviado.
2. Usar Vista previa para validar emisor, receptor, ítems, totales, CAE, vencimiento y QR.
3. Elegir impresora y formato, indicar de una a cinco copias y confirmar.
4. Ante `failed` o `unknown`, revisar papel, driver y cola de Windows; crear una nueva reimpresión sólo después de revisar el resultado físico.
5. Ante `artifact_failed`, conservar el CAE, revisar el mensaje sanitizado y pedir regeneración con owner/admin. No editar el documento autorizado.

La carpeta local abierta por el panel contiene exclusivamente el spool autorizado. No es backup fiscal: el backup primario es PostgreSQL más Storage privado. La retención debe seguir la política contable y legal aprobada; respaldar metadatos y objetos privados de forma consistente, cifrada y con acceso mínimo. No copiar PDFs a ubicaciones públicas ni adjuntarlos a logs.
