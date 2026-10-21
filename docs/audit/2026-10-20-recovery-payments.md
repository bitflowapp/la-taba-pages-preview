# La Taba: recuperación de Supabase y auditoría de pagos

Fecha local: 20/10/2026, Argentina. Las evidencias UTC comienzan el 21/10/2026.
Base revisada: `bitflowapp/la-taba-pages-preview`, `origin/main` en
`ff55f4cf6fea8f7f09b01c6eb58b33b4de971966`.
Rama local: `audit/supabase-payments-recovery-20261020`.

**Veredicto: La Taba NO está preparada para recibir pagos online.** El frontend
público responde, pero los tres backends identificados no están disponibles.
Las correcciones de esta auditoría son locales y no se publicaron. No se
habilitaron pagos, crearon preferencias remotas, ejecutaron cobros ni reembolsos
reales, ni se crearon proyectos o recursos facturables.

## 1. Qué ocurrió con Supabase

Se contrastaron los archivos servidos por Cloudflare, el código, la API de
administración de Supabase y la resolución DNS. La credencial del CLI y el
conector MCP no dieron acceso a los proyectos de La Taba. La consulta directa
autenticada devolvió HTTP 404 con `Resource has been removed` para los tres refs.

| Entorno | Sitio | Supabase esperado | Resultado actual |
|---|---|---|---|
| Producción | https://la-taba.pages.dev | `wwcpogltfgzgkrlilbcd` | DNS ENOTFOUND; Management API 404 |
| Staging | https://taba2-staging.pages.dev | `ucbtjcurawxjwjdvvcvj` | DNS ENOTFOUND; Management API 404 |
| Piloto / producción controlada | https://la-taba-commercial-pilot.pages.dev | `tkanbadcglszlcyfjvpv` | DNS ENOTFOUND; Management API 404 |

El ref histórico de staging `ukxqbgswjlibmnjemrzd` tampoco resuelve por DNS.
El sitio productivo sirve el commit `cd26834b25909a3fbf6b5133af7b70c39a35fc2d`
y runtime `la-taba-runtime-v144-mp-production-verification`, construido el
07/10/2026. No sirve el `main` remoto revisado en esta auditoría. Su configuración
sigue apuntando al ref original: no se encontró una URL de reemplazo en el
runtime público.

La evidencia es compatible con proyectos eliminados; no permite determinar
quién los eliminó, cuándo ni la causa administrativa. No se dispone de un
registro de auditoría de la organización original. Tampoco permite descartar
un traslado/restricción de acceso sin información del propietario. **No es un
diagnóstico de pausa por inactividad**: no se encontró un proyecto pausado de
La Taba que se pudiera reanudar. No se llamó a restore sobre un ref inexistente.

Supabase documenta que una eliminación es permanente, incluidos los backups
alojados en el proyecto. Si se confirma la eliminación, hace falta un respaldo
externo; no alcanza con reemplazar la clave del frontend.
[Documentación de eliminación](https://supabase.com/docs/guides/platform/delete-project).

Se listaron los proyectos accesibles únicamente para identificar el destino.
No se ejecutaron SQL, migraciones, despliegues ni modificaciones en
`bitflow-production`, `estela-pilot` ni `apex-agent-demo-sintetico`.

### Código y despliegues relacionados

| Recurso | Relación comprobada |
|---|---|
| `bitflowapp/la-taba-pages-preview` | Frontend, backend SQL, Edge Functions y scripts de operación |
| `bitflowapp/la-taba-rider-android` | Repositorio privado del Rider, identificado en GitHub y handoff |
| `bitflowapp/taba-fiscal` | Repositorio privado relacionado, identificado en GitHub; no modificado |
| Caja Clara | Integración POS presente en migraciones/pruebas y worktrees locales; no modificada |
| GitHub Pages del repositorio | Preview; `runtime-config.js` vacío, no es producción |
| Cloudflare Pages | Hosting efectivo de producción, staging y piloto, corroborado mediante runtime/version |

La copia original en `C:/Users/marco/dev/la-taba-pages-preview` tiene cambios
locales anteriores. Se conservaron y se creó un worktree separado desde
`origin/main`; no se integraron ramas históricas ni se hizo push/merge.

### Respaldo encontrado y alcance recuperable

Archivo privado existente: `production-pre-cutover-wwcpogltfgzgkrlilbcd-1789704665402.json`.
Registro interno: `2026-09-18T04:11:03.993Z`. Tamaño: 1.360.504 bytes.
SHA-256: `6983957294de53c7cb3c59ba7aefcc605d2bfb2673b0c5288b6568322b231219`.

| Contenido | Evidencia | Alcance |
|---|---|---|
| Migraciones del respaldo | 122 versiones | Inventario histórico |
| Definiciones | 1.198 columnas, 718 constraints, 291 funciones, 88 entradas de triggers | Útil para comparar; no es un dump ejecutable completo |
| Negocio | 1 fila | Datos históricos parciales |
| Productos | 72 filas/proyecciones | No certifica catálogo, precios ni stock actuales |
| Pedidos | 3 filas agregadas de `orders_summary` | No contiene los pedidos ni sus ítems |
| Configuración de pagos | 0 filas | No recupera activación ni cuentas de vendedores |
| Auth, memberships, pagos, reservas, tokens OAuth y Storage | No incluidos en este JSON | Sin recuperación demostrada |
| `pre-cutover-schema-wwcpogltfgzgkrlilbcd.sql` | 0 bytes | No es utilizable para restaurar |

Se inspeccionó el JSON sin imprimir filas, PII, secretos ni definiciones con
valores. No se importó stock antiguo ni se sustituyó el catálogo actual por
estos 72 productos. No se encontró un dump completo en los directorios acotados
inspeccionados. Un barrido más amplio de copias locales se interrumpió al no
producir resultados y degradarse el entorno; **no se afirma que no existan
otras copias**.

Hay 159 archivos de migración y 13 Edge Functions en el `main` revisado.
Se inició reconstrucción del esquema en PostgreSQL desechable con Auth y
Storage de prueba. El arnés aplicó 122 migraciones base y verificó la expansión
V5, permisos RPC, compatibilidad y concurrencia financiera. El daemon Docker
dejó de responder después de agotarse el disco C. No finalizó la aplicación
completa de las 159 migraciones, pgTAP ni el ensayo dump/restore.

**Recuperado:** acceso al código, inventario de configuración pública y evidencia
del respaldo parcial; reconstrucción y comprobaciones parciales del esquema en
un entorno sintético. **No recuperado:** servicio Supabase alojado, datos
operativos completos, identidades, objetos de Storage y secretos originales.

| Componente | Estado de recuperación |
|---|---|
| Tablas, relaciones, funciones y RLS | Fuentes conservadas; pruebas locales parciales; no restauradas remotamente |
| Auth | Esquema/configuración en código; usuarios y sesiones originales no recuperados |
| Storage | Políticas y definiciones en código; no se encontraron objetos respaldados |
| Realtime | Migraciones conservadas; sin servicio alojado disponible para probar suscripciones |
| Edge Functions | Fuentes conservadas y pruebas locales ejecutadas; endpoints remotos inaccesibles |
| Catálogo, pedidos, stock, panel | Navegador probado con fixtures; operación alojada bloqueada |

Los backups de base no incluyen los archivos de Storage, sólo su metadata.
[Backups de Supabase](https://supabase.com/docs/guides/platform/backups).

## 2. Mercado Pago: implementación y defectos comprobados

El producto es **Checkout Pro**, con preferencias `/checkout/preferences`,
OAuth por vendedor y lecturas de `/v1/payments`, merchant orders y refunds.
Usar preferencias en Checkout Pro es correcto; estas lecturas no justifican
migrarlo a Orders API. La API oficial mantiene este flujo de preferencias.
[Referencia de Checkout Pro](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/overview).

La cuenta y las credenciales actuales no pudieron verificarse porque se
perdió el acceso al backend. La documentación de octubre describía una cuenta
OAuth conectada y cobros apagados, además de una exposición previa del client
secret integrador. Ese documento es evidencia histórica: **no certifica una
rotación, conexión o activación actual**. La rotación sigue sin verificar.

### Correcciones implementadas

| ID | Defecto reproducido | Corrección y regresión |
|---|---|---|
| MP-01 | La creación de preferencias convertía HTTP 408/409/425/429 en rechazo definitivo | Reutiliza `isFinalProviderRejection`; devuelve 202 y registra incertidumbre, sin reintentar el POST. Pruebas de 11 respuestas HTTP sobre el handler real |
| MP-02 | Cancelación aceptaba un 2xx con ID de otro pago o sin ID | Exige coincidencia con el pago preparado; de lo contrario concilia y no registra cancelación. Dos regresiones fallaban antes y pasan después |
| MP-03 | Una cancelación ya preparada con la misma clave volvía a enviar PUT, incluso concurrente o previamente rechazada | Consulta el registro ligado al intento y a la clave; devuelve el resultado terminal o 202 sin nueva mutación. Dos regresiones fallaban antes y pasan después |
| SEC-01 | `.gitignore` cubría `.env`, pero no `.env.production` / `.env.local` y otras variantes | Ignora variantes en cualquier nivel, conservando los ejemplos; prueba con `git check-ignore` |
| REC-01 | Faltaba inventario reproducible del incidente sin exponer secretos | Nuevo `scripts/audit-la-taba-recovery.mjs`: GET público, DNS y Management GET opcional; resumen de backup sin filas ni claves; tres pruebas |

Las regresiones usan los handlers reales con transporte programado y
`--deny-net`. No son pagos de prueba de Mercado Pago ni compras productivas.

### Controles revisados

| Área | Evidencia local y límite |
|---|---|
| Precios, moneda, ítems y stock | Checkout envía IDs/cantidades; la RPC calcula y reserva. No se modificaron precios |
| Autenticación | Edge valida usuario con Auth; RPC de cliente prueba ownership; operaciones del comercio requieren roles de servidor |
| OAuth | Tokens cifrados y asociados a proyecto/entorno/app/negocio; renovación con control de concurrencia y autorización actual antes de entregar URL |
| Webhooks | Firma HMAC mediante SDK oficial, comparación de recurso, frescura y HTTPS; recibo durable y deduplicación |
| Autoridad del pago | Consulta al proveedor y validación del snapshot antes de finalizar pedido; el redirect no aprueba pagos |
| Vendedores | Routing comprueba conexión, collector, aplicación, entorno y referencia contra el pago leído con token del vendedor |
| Reintentos | Preferencias ambiguas se buscan antes de otro POST; cola con leases, reintentos y control de duplicados |
| Reembolsos | Confirmación explícita, importe preparado por DB, clave persistente, identidad de refund y conciliación ante timeout |
| Cancelaciones | Confirmación explícita y claves persistentes; corregidos identidad y replay en esta auditoría |
| Estados | Pruebas de pendientes, aprobados, rechazados, cancelados, expiración, incertidumbre y revisión manual |
| Logs y errores | Respuestas públicas sanitizadas, hashes de datos sensibles; scanner actual sin credenciales asignadas detectadas |
| Activación real | Compuertas de revisión/entorno/ejecución presentes en código; estado remoto actual no verificable; no se tocaron |

### Checklist de seguridad del skill Mercado Pago (9 controles)

Esta tabla evalúa el código revisado. No certifica configuración desplegada.

| # | Control | Estado | Evidencia |
|---|---|---|---|
| 1 | Tokens en servidor/entorno | Implementado | `_shared/mercadopago.ts`, `seller-oauth.ts`; scanner sin hallazgos actuales |
| 2 | `.env` ignorado y ejemplos versionables | Implementado, corregido | `.gitignore`, `tests/payment-env-files.test.mjs` |
| 3 | Firma de webhook HMAC | Implementado | `mercadopago-webhook/index.ts`, `mercadopago-webhook-signature.ts` y Deno |
| 4 | URLs HTTPS | Implementado | `checkoutBaseUrl`, `webhookUrl`, `request-protocol.ts` |
| 5 | Consulta del pago al volver | Implementado | `mercadopago-checkout-status/index.ts`, worker y snapshot SQL |
| 6 | Idempotencia de operaciones | Implementado con correcciones | `X-Idempotency-Key`, RPCs y regresiones nuevas |
| 7 | Referencia externa | Implementado | `preferenceRequest`, búsqueda y validación SQL |
| 8 | Credenciales de prueba separadas del despliegue | No verificado remotamente | Fixtures locales sintéticos; secretos alojados inaccesibles |
| 9 | Ausencia de uso de `sandbox_init_point` | Parcial | No se usa para navegar; persiste como dato histórico compatible. Se devuelve `init_point` |

No se eliminó el campo histórico `sandbox_init_point` de migraciones existentes.
Los tests de redirección comprueban que no se utilice como destino.

## 3. Checklist oficial consultado

Se llamó a `quality_checklist` para la aplicación documentada
`7677852968049976`, en esta sesión del 20/10/2026. Se revisan todos los ítems
devueltos. Es un checklist general, no una evaluación del pago ni certificación
de la cuenta. Los faltantes de calidad comercial no se añadieron inventando
datos del comprador o del vendedor.

### Requisitos devueltos (14)

| # | Campo | Estado en código | Evidencia |
|---|---|---|---|
| 1 | Cantidad | Implementado (proveedor lo rotula N/A) | `mercadopago.ts: preferenceRequest`, items.quantity |
| 2 | Precio unitario | Implementado (N/A en checklist) | items.unit_price del snapshot servidor |
| 3 | Descriptor del resumen | Falta | No se envía statement_descriptor |
| 4 | URLs de retorno | Implementado | back_urls y checkoutReturnUrl |
| 5 | Webhooks | Parcial | notification_url y handler presentes; entrega alojada no comprobable |
| 6 | Referencia externa | Implementado | external_reference |
| 7 | Email del comprador | Falta en preferencia | No hay payer.email en preferenceRequest |
| 8 | Nombre del comprador | No requerido por respuesta N/A; no enviado | preferenceRequest no incluye payer |
| 9 | Apellido del comprador | Falta | No hay payer.last_name |
| 10 | Categoría del ítem | Falta | No hay category_id |
| 11 | Descripción del ítem | Parcial | description opcional; recargo de envío sin descripción |
| 12 | ID del ítem | Implementado | items.id |
| 13 | Título del ítem | Implementado (N/A en checklist) | items.title |
| 14 | SDK backend | Falta para llamadas REST | fetch directo; SDK oficial usado para firma, no para crear preferencias |

### Buenas prácticas devueltas (22)

| # | Práctica | Estado en código | Evidencia |
|---|---|---|---|
| 1 | Respuesta binaria configurable | Falta | No se envía binary_mode; se permiten pendientes |
| 2 | Vencimiento de pagos offline | Parcial | Preferencia expira; no date_of_expiration específico |
| 3 | Integración publicitaria | Falta | Sin payload marketing_information en preferencias |
| 4 | Vigencia de preferencia | Implementado | expires, expiration_date_from/to |
| 5 | Máximo de cuotas | Implementado | installments_limit -> payment_methods.installments |
| 6 | Apertura modal | Falta | Redirección externa, verificada en navegador |
| 7 | Logo oficial | Parcial | Método visible con iconografía; conformidad de marca no certificada |
| 8 | Mensajes de respuesta | Implementado | paymentStatusPresentation, retorno y errores; navegador |
| 9 | Exclusión de medios específicos | Falta | No excluded_payment_methods |
| 10 | Exclusión de tipos de pago | Implementado | excluded_payment_types ticket según configuración |
| 11 | Monto de envío | Parcial | Se incluye como ítem de recargo; no shipments.cost |
| 12 | Consulta del pago notificado | Implementado | fetchPayment, worker y checkout-status |
| 13 | Contracargos | Parcial | fetchChargeback y cola existen; routing OAuth sólo suscribe payment |
| 14 | Cancelaciones | Implementado en código | Handler, RPC y regresiones; sin validación contra cuenta real |
| 15 | Devoluciones | Implementado en código | Refund handler, identidad y conciliación; fixtures |
| 16 | Reporte de liquidaciones de MP | Falta | No hay consumo de API de reportes de liquidación |
| 17 | Reporte de todas las transacciones de MP | Falta | Consola interna no equivale al reporte oficial |
| 18 | Dirección enviada a MP | Falta | Dirección queda en checkout; no payer.address en preferencia |
| 19 | Identificación del comprador | No requerido por N/A; no enviado | Sin payer.identification |
| 20 | Teléfono del comprador | No requerido por N/A; no enviado a MP | Contacto interno no se envía en payer.phone |
| 21 | Identificación específica MLM | No aplica a Argentina; N/A | Checkout ARS/MLA |
| 22 | SDK frontend Pro | Falta | Entrega init_point y navega; sin SDK frontend Pro |

`quality_evaluation`: no ejecutada, no hay un payment_id de prueba proporcionado
ni generado. No se solicitó homologación ni activación productiva.

## 4. Pruebas efectivamente realizadas

| Ejecución | Resultado | Alcance real |
|---|---|---|
| npm ci con lockfile, sin scripts de instalación | PASS | 97 paquetes; versiones conservadas |
| npm test | 2.929 PASS, 0 fallas | Suite de Node de la base; los 4 tests nuevos se ejecutaron aparte |
| Tests nuevos de inventario/archivos env | 4 PASS | Tres de inventario y uno de exclusión de credenciales |
| test:payments inicial y tras los fixes | 205 PASS en cada corrida | Subconjunto incluido en Node; no sumar las repeticiones |
| npm run test:webhook final | 46 + 183 Deno PASS; 12 Node PASS | 229 Deno con --deny-net, y Node repetidos del repo |
| Regresiones antes del fix | 6 fallas + 2 fallas de replay reproducidas | Fallas esperadas que demostraron los tres defectos financieros |
| Nueve controles de npm run check, ejecutados directamente | PASS después de los fixes | Sintaxis/config/assets/precache/identidad/ubicación/encoding/scanner; la escritura de su JSON local falló por ENOSPC después de imprimir los nueve resultados |
| Navegador, Chrome instalado | 28 PASS, 0 fallas | Carrito, handoff, retorno y panel, backend/MP simulados |
| Primera tentativa Chromium/WebKit fijados | 56 fallas de infraestructura | Faltaban ejecutables; instalación bloqueada por disco lleno. No son resultados funcionales |
| PostgreSQL aislado sin red | PARCIAL | 122 migraciones base y matriz V5 parcialmente verificadas; sin veredicto final |
| Supabase remoto y pago de prueba real | BLOQUEADO / NO EJECUTADO | Backends ausentes; sin credenciales de prueba utilizables |

La suite Node larga comenzó antes de añadir los cuatro tests nuevos. Las suites
de Edge se repitieron después de los cambios financieros. No se suman suites
superpuestas para inflar un total.

### Fronteras del circuito

| Frontera | Evidencia | Estado |
|---|---|---|
| Catálogo -> carrito -> checkout | Chrome; fixtures verificados de catálogo | PASS local |
| Checkout -> creación de preferencia | Handler real, autenticación/autoridad simuladas, respuestas adversarias | PASS local |
| Navegación -> retorno | Chrome, doble clic y red degradada | PASS local |
| Notificación -> consulta autoritativa | Deno, firma, routing y worker con red denegada | PASS local |
| Pago -> pedido y stock | Ciclo financiero SQL base y verificaciones V5 parciales | PARCIAL; falta completar esquema final |
| Pedido/pago -> panel | Chrome, roles y estados simulados | PASS local |
| Cliente -> MP de prueba -> Supabase alojado -> pedido -> panel -> stock | No hay backend disponible | NO VERIFICADO |

La matriz local también cubre respuestas inciertas, reintentos, stock insuficiente,
sesión vencida, abandono del navegador, rechazo/cancelación/pendiente y retorno
que afirma aprobado. No se confía en parámetros de redirect para crear pedidos.

## 5. Bloqueos, continuidad y orden de recuperación

1. Confirmar con el propietario si hubo eliminación/traslado y recuperar acceso
   a la organización original. La pregunta quedó pendiente en esta sesión.
   No se atribuye la eliminación a una persona sin audit log.
2. Buscar un backup completo posterior a septiembre: datos, roles, Auth y
   memberships, pagos/pedidos/ítems/reservas, objetos de Storage y configuración.
   Preservar su original y comprobar hashes/restauración antes de usarlo.
3. Liberar espacio local. C llegó a 0 bytes libres durante la instalación de
   navegadores; Docker dejó de responder incluso a `docker info` (timeout 5 s).
   Se interrumpió el arnés propio. La limpieza del contenedor desechable
   `taba-a1-a4-local-v5-14448-0c500695` también agotó el timeout: puede quedar
   pendiente hasta recuperar Docker. No tiene red ni puertos publicados.
4. Completar las 159 migraciones, pgTAP y dump/restore en un destino aislado.
   Si el original fue eliminado, preparar un proyecto de reemplazo sólo después
   de acordar destino y cualquier costo; no reutilizar otro proyecto del usuario.
5. Restaurar/verificar Auth, relaciones, RLS/grants, objetos/políticas de Storage,
   Realtime, las 13 funciones y sus secretos. Reconfigurar referencias hardcodeadas
   y bindings OAuth mediante cambios revisados si el destino tiene otro ref.
   Un cambio de URL aislado no basta: el código financiero rechaza refs desconocidos.
6. Mantener deshabilitados cobros y cron/egreso durante la restauración. No
   reactivar trabajos financieros históricos sin conciliar con MP pedidos, pagos,
   devoluciones y stock; evitar repetir operaciones posteriores al backup.
7. Verificar/rotar el client secret expuesto históricamente y reautorizar al
   vendedor si se perdió la clave de cifrado o los tokens. No inventar conexión
   OAuth a partir del JSON parcial. Separar credenciales/cuentas de prueba.
8. Ejecutar el circuito alojado con cuentas/tarjetas de prueba autorizadas y
   `init_point`, incluida notificación firmada, consulta autoritativa, efecto
   único sobre pedido/stock, expiraciones, reintentos y reembolsos de prueba.
9. Preparar un cambio revisable de frontend/backend y el plan de publicación.
   La publicación productiva y los cobros reales requieren autorización expresa
   posterior. Diseño y precios quedan fuera de esta intervención.

### Evidencias y reproducción

El resumen sin secretos está en `2026-10-20-recovery-evidence.json`, junto a este
informe. Logs locales: `.local/recovery-audit/`; contienen fixtures y resultados,
no respaldos de usuarios. Los logs anteriores se comprimieron para reducir
espacio. No se copiaron al repositorio secretos ni el JSON privado completo.

Inventario repetible de sólo lectura:

```powershell
node scripts/audit-la-taba-recovery.mjs --management --backup <ruta-privada-al-json> --output <archivo-nuevo.json>
node --test tests/recovery-inventory.test.mjs tests/payment-env-files.test.mjs
npm run test:payments
npm run test:webhook
```

El inventario no obtiene API keys, no ejecuta SQL ni restaura o crea proyectos.
`--management` usa la credencial existente del CLI sólo en memoria.

Guías aplicadas: `supabase:supabase`, `mercadopago:mp-review`, inspección de
despliegues y verificación del circuito. No se enviaron mensajes externos.

La revisión automática rechazó eliminar la carpeta del navegador descargado
en esta sesión (`chromium-1223`), indicando únicamente `blocked by policy`.
La carpeta quedó intacta. Se usó Chrome instalado para las 28 pruebas que pasan.
