# Threat model y controles del release candidate

## Activos y límites de confianza

Los activos críticos son dinero, stock, pedidos, identidad/sesiones, ubicación
Rider, CAE, certificados y claves fiscales, PDFs fiscales, Access Token y
webhook secret Mercado Pago, service role, outboxes, backups, updater y
artefactos firmados.

Los límites son navegador público, WebView/Tauri de usuario actual, Android,
Supabase Auth/PostgREST/Realtime/Storage, Edge Functions, worker ARCA privado,
API Mercado Pago, servicios ARCA, spooler Windows y CI. Un límite nunca hereda
la confianza de otro: cliente, staff y Rider envían intención; el servidor
recalcula y autoriza.

## Amenazas y controles

| Amenaza | Control del RC | Evidencia que falta fuera del host |
| --- | --- | --- |
| cliente altera precio/total | checkout recibe IDs/cantidades y calcula server-side; catálogo pendiente bloqueado | prueba staging con roles y catálogo aprobado |
| navegador marca pago | webhook firmado más consulta autoritativa; Access Token sólo backend | flujo Mercado Pago de prueba |
| webhook duplicado/desordenado | deduplicación, idempotencia, eventos únicos y reconciliación | caída/reentrega contra staging |
| staff administra pagos | RPC/grants por rol y operaciones sensibles backend | matriz RLS/grants aplicada en staging |
| Rider cruza negocios | membership, asignación y CAS server-side; tracking mínimo | Moto G15 multiusuario físico |
| service role llega al cliente | validación de runtime, secret scan y separación worker/Edge | inspección de bundles firmados finales |
| CAE duplicado o inventado | fiscal outbox, número serializado y consulta ante ambigüedad | homologación autorizada |
| PDF fiscal público/manipulado | bucket privado, URL efímera, SHA-256, path no predecible y metadata RLS | Storage aislado y expiración real |
| reimpresión silenciosa | permiso, confirmación, job remoto y spool durable local | impresoras físicas |
| replay de outbox | idempotency key más hash de payload/revisión CAS | dos workers contra PostgreSQL real |
| exfiltración por diagnóstico | esquema sanitizado y acotado; sin rutas, payloads ni datos completos | revisión de un export real de cada build |
| actualización maliciosa | firma Tauri, Authenticode, timestamp y workflow protegido | certificado aprobado y ejecución CI |
| pérdida o robo de equipo | sesión revocable, datos locales mínimos y runbook de dispositivo | MDM/cifrado/política del negocio |

## Controles por capa

### Base y API

Todas las tablas expuestas del RC deben tener RLS y grants mínimos; funciones
`security definer` fijan `search_path`. Constraints, índices, unique keys y
locks protegen idempotencia y concurrencia. Realtime sólo publica tablas y
filas necesarias. La validación definitiva incluye aplicar desde cero y sobre
copia de staging, ejecutar pgTAP y revisar Supabase Security Advisor, SSL,
restricciones de red, MFA, backups/PITR, logs y límites.

### Web y sesiones

El runtime sólo admite HTTPS, publishable key y UUID de negocio. No acepta
service role. Auth y memberships activas protegen panel y Rider; un inicio
offline en frío no reutiliza el cache para saltar sesión. Deben verificarse CSP,
TLS, revocación, expiración, entrada de usuario, rate limits y ausencia de PII
en URL, analytics y logs en el artefacto desplegado.

### Pagos

Token y webhook secret viven sólo en Edge secrets. La firma se valida antes de
procesar; después se consulta la API. Importes y referencia salen del servidor.
Producción falla cerrado sin `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`, y
crear una preferencia productiva exige además el consentimiento temporal de
pago real. Refund total/parcial y contracargo conservan eventos y conciliación.

### Fiscal

Certificado, clave privada, WSAA token/sign y service role viven en el worker.
XML se construye sin aceptar entidades externas ni plantillas remotas. Logs
usan códigos y correlaciones sanitizados. Una nota exige política contable
versionada aprobada; si no resuelve tipo, queda en revisión y nunca usa tipo
cero. Timeout pasa a `ambiguous` y consulta antes de reemitir.

### Desktop y Android

SQLite usa WAL, límites y comandos tipados. Caché packing excluye datos del
cliente. El spool vive en el directorio permitido y no demuestra papel impreso.
El updater y releases distribuidos exigen firma aprobada. Android no tiene
debug-signing fallback para producción, no contiene service role y exporta
crashes sanitizados sin excepción ni stack completo.

## Auditorías y rotación

En cada promoción ejecutar secret scan, dependency audit, RLS/grants/roles,
rate limits, CSP/TLS, validación de input/XML, sanitización de logs, revocación
de sesiones y revisión de accesos. Rotar de manera independiente credenciales
Supabase, Mercado Pago, ARCA, firma Windows/Android y CI; registrar actor, fecha,
alcance y prueba posterior sin conservar valores secretos.

En este host se ejecutan análisis locales y de dependencias. Security Advisor,
configuración organizacional Supabase, MFA, red, TLS desplegado, secrets
remotos, firma aprobada y rotación real permanecen `NOT_RUN` hasta contar con
entorno y responsables autorizados.

