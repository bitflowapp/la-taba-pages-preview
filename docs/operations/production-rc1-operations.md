# Operación diaria del release candidate TABA2

## Estado y alcance

Este runbook corresponde a `release/taba2-production-rc1`. Describe controles
locales y procedimientos de staging/piloto; no autoriza producción. PostgreSQL
y el Storage privado son la fuente de verdad remota. SQLite e IndexedDB son
colas y cachés acotadas, nunca una autoridad alternativa de pagos, stock, CAE
o documentos fiscales.

La operación queda separada en cuatro autoridades:

| Dominio | Autoridad | Réplica o cola local | Regla de confirmación |
| --- | --- | --- | --- |
| Catálogo, precio y stock | PostgreSQL | catálogo ya sincronizado | no vender precio pendiente ni confirmar stock no reservado |
| Pago Mercado Pago | API de Mercado Pago verificada por backend y PostgreSQL | ninguna aprobación local | el navegador nunca marca un pago aprobado |
| Pedido, packing y entrega | PostgreSQL | outbox SQLite/IndexedDB y manifiesto de packing sanitizado | éxito sólo después de CAS persistido |
| Fiscal | PostgreSQL, ARCA y Storage privado | fiscal outbox y spool de PDF autorizado | no inventar CAE ni considerar listo un PDF ausente |

## Inicio de jornada

1. Confirmar versión, HEAD y canal de actualización firmado en Diagnóstico.
2. Revisar integridad SQLite, cantidad de comandos pendientes y último backup
   local verificado. Si `quick_check` no es `ok`, detener nuevas operaciones
   locales y seguir el runbook de recuperación.
3. Abrir Centro de operación y refrescar. Un snapshot viejo o una sesión
   vencida no habilita acciones.
4. Resolver primero alertas `CRITICAL`, luego `ACTION_REQUIRED` y `WARNING`.
5. Verificar conectividad de Supabase, Mercado Pago, Rider, ARCA, Storage y
   spooler. Ausencia de señal debe mostrarse como ausencia, no como salud.
6. Confirmar catálogo comercial aprobado, precios vigentes, stock inicial y
   política de medios de pago. El validador debe bloquear cualquier precio
   pendiente.
7. Realizar una lectura de control del scanner y una impresión no fiscal de
   diagnóstico sólo si el hardware ya fue certificado para ese equipo.

## Centro de operación

El Centro de operación concentra las excepciones normales. El operador no
necesita abrir una consola para identificar:

- pedidos nuevos o demorados;
- pagos pendientes o en revisión;
- pedidos sin stock y packing incompleto;
- entregas activas y Riders sin señal;
- documentos fiscales y PDFs pendientes;
- impresiones fallidas;
- notas de crédito pendientes;
- outboxes sin progreso;
- reconciliaciones requeridas.

Cada alerta incluye severidad, código estable, resumen sanitizado, acción
requerida y un ID de correlación abreviado. Reconocer una alerta registra el
actor y no corrige la causa. Una condición todavía vigente puede reaparecer al
refrescar.

| Nivel | Uso | Acción del operador |
| --- | --- | --- |
| `INFO` | evento útil sin intervención inmediata | revisar durante el cierre |
| `WARNING` | degradación o demora recuperable | corregir en la jornada y vigilar progreso |
| `ACTION_REQUIRED` | operación detenida que exige decisión | asignar responsable y resolver antes del cierre |
| `CRITICAL` | integridad, dinero, stock, entrega o fiscal en riesgo | detener el tramo afectado, preservar evidencia y escalar |

Son críticas, entre otras, las combinaciones pago aprobado sin pedido, pedido
duplicado, stock negativo, CAE ambiguo, pedido entregado sin cierre, webhook
inválido repetido, outbox sin progreso, backup fallido y certificado fiscal
próximo a vencer. La respuesta concreta figura en `required_action`; no se
debe cerrar la alerta sólo para despejar la pantalla.

## Invariantes exactamente-una-vez

| Tramo | Clave o serialización | Recuperación |
| --- | --- | --- |
| checkout | request/idempotency key y snapshot de precio server-side | repetir la misma clave sólo con el mismo payload |
| reserva y pedido | transacción, constraints y CAS de revisión | recargar ante revisión obsoleta; nunca forzar estado |
| preferencia Mercado Pago | referencia externa estable e idempotency key | consultar autoridad antes de crear otra preferencia |
| webhook | firma, deduplicación y consulta autoritativa del pago | reentrega segura; evento único |
| Rider | claim/transiciones CAS, negocio y actor vinculados | reconciliar snapshot antes de reintentar |
| fiscal | fiscal outbox, lease y numeración serializada | en ambigüedad usar `FECompConsultar`, no reemitir |
| artefacto | token de generación, SHA-256 y único actual por tipo | regeneración crea supersesión auditada |
| impresión | `fiscal_print_jobs` y spool durable local | reinicio deja resultado `unknown`; no reimprime solo |

Un timeout no equivale a rechazo. El operador consulta el estado autoritativo,
compara el ID de correlación y sólo entonces decide la siguiente acción.

## Operación degradada

| Falla | Se conserva | Se bloquea | Recuperación |
| --- | --- | --- | --- |
| Internet del negocio | datos ya cacheados, packing de manifiesto previamente reconciliado, impresión de PDF ya disponible | pagos remotos, inventar stock, CAE o confirmaciones servidor | outbox durable, reconectar, refrescar autoridad y resolver conflictos |
| Mercado Pago | carrito y sesión de checkout | pedido operativo sin pago autoritativo | consultar pago y reconciliar; otro medio sólo si la política server-side lo habilita |
| ARCA | venta y pago confirmados, documento `pending` | CAE/QR fiscal inventado | fiscal outbox con backoff y consulta ante ambigüedad |
| Supabase | operaciones locales expresamente permitidas y colas existentes | confirmar mutaciones no persistidas o iniciar sesión offline en frío | conservar colas, renovar sesión, releer snapshots y despachar CAS |
| Storage | metadata y autorización fiscal | preview/descarga si el objeto privado no está disponible | regenerar sólo con permiso y auditoría; no cambiar el CAE |
| impresora | documento autorizado y PDF | declarar impresión física completada | revisar driver/papel/cola y crear reimpresión confirmada |

El packing offline sólo admite un manifiesto que ya fue autenticado y
reconciliado. La caché excluye nombre, domicilio, pago y código de entrega. Los
scans y reversiones tienen claves estables; la confirmación final exige red y
que la outbox quede reconciliada. Un inicio en frío sin red no evita Auth ni la
revocación de sesión.

## Conciliación y cierre diario

El cierre agrupa, sin ocultar diferencias:

- pedidos creados, cancelados, entregados y devueltos;
- pagos aprobados, pendientes, rechazados, reembolsados y contracargos;
- efectivo esperado, declarado, diferencias y otros medios;
- inventario por venta, ingreso, merma, ajuste, conteo y diferencia;
- documentos autorizados, pendientes, rechazados, notas y PDF pendiente.

Procedimiento:

1. Preparar la conciliación para la fecha y ventana correctas.
2. Revisar todas las diferencias y alertas abiertas. Ingresar una explicación
   operativa cuando exista diferencia; nunca reemplazar el valor medido.
3. Comparar efectivo declarado por doble control humano.
4. Confirmar que pagos aprobados tengan pedido único y que entregas tengan
   cierre y fiscalización según política.
5. Resolver o asignar responsable a pagos, outboxes, CAE ambiguos, impresiones
   y notas pendientes.
6. Cerrar por la RPC CAS. El cierre registra hash y eventos de auditoría y se
   vuelve inmutable; una corrección posterior se documenta como evento o nueva
   conciliación, no editando el cierre.
7. Exportar diagnóstico sanitizado y registrar su hash junto al acta diaria.

## Soporte de primer nivel

La exportación de soporte incluye versión/build, SO, estado de red, conteos de
colas, códigos de error, timestamps e IDs de correlación. Está acotada y no
incluye tokens, contraseñas, rutas internas, nombres de impresora, payloads,
domicilios, datos completos de clientes, códigos de entrega ni claves.

Ante un incidente, soporte debe registrar: hora observada, versión, código de
alerta, correlación, acción del operador, resultado autoritativo y si quedaron
comandos pendientes. No copiar bases SQLite, PDFs o logs completos por un canal
no aprobado.

## Actualización y rollback

El build distribuible requiere updater de Tauri con endpoint HTTPS y clave
pública, binarios EXE/MSI/NSIS firmados por un certificado aprobado y
timestamp verificable. El pipeline construye una vez, genera hashes, SBOM y
manifest, y no despliega. Una build local sin canal firmado mantiene el updater
deshabilitado y falla cerrado al intentar instalar.

Para rollback:

1. detener la promoción y conservar los artefactos y hashes afectados;
2. reconciliar o respaldar la outbox local antes de cambiar de binario;
3. instalar el artefacto firmado anterior ya aprobado;
4. no revertir migraciones eliminando datos: aplicar una corrección incremental
   forward-only después de ensayarla;
5. renovar leases de workers sólo después de verificar que el proceso anterior
   terminó;
6. reconciliar pagos y fiscales ambiguos antes de reabrir operación;
7. registrar versión anterior/nueva, motivo, ventana e impacto.

## Fin de jornada

La jornada no se considera cerrada hasta conservar el cierre inmutable, sus
diferencias visibles, el backup local verificado y la lista asignada de
excepciones remanentes. El cierre comercial no transforma `unknown` en
`completed`, ni un pago pendiente en aprobado, ni un CAE ambiguo en autorizado.

