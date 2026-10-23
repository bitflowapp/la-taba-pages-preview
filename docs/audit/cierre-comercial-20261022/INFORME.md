# La Taba — cierre técnico y preparación comercial, 22/10/2026

**NO-GO técnico para habilitar cobros comerciales; NO-GO comercial.** El código queda preparado para aplicar
una corrección de esquema revisable y completar la ronda auténtica de prueba cuando se restablezca el acceso
autorizado y los titulares autoricen sus pasos interactivos. No se realizaron pagos, reembolsos, vinculaciones,
merge, despliegue productivo ni cambios en la cuenta de Walter. No se crearon proyectos ni servicios pagos.

## 1. Proyecto recuperado y alcance comprobado

- Repositorio y [PR 148](https://github.com/bitflowapp/la-taba-pages-preview/pull/148), abierto y en borrador;
  base `main` en `ff55f4cf`; HEAD remoto confirmado dos veces en `4254705a431642482fe11f530ab54521da937e49`.
- Checkout completo, 4.242 archivos originales, separado del trabajo anterior; se conservaron los cambios ajenos.
  No se incorporaron como borrados los archivos omitidos en otros checkouts.
- Se leyeron los informes final y Astra2. El informe `2026-10-22-limpieza-qa-y-preparacion-lanzamiento.md`
  no existe en el árbol remoto consultado. Se encontró una continuidad local anterior a este cierre,
  que describe v156; no se la tomó como evidencia actual de la limpieza de Haiku.
- Las cifras anteriores de 134 PostgreSQL / 3106 JavaScript y las operaciones alojadas del informe de Sonnet
  se trataron como antecedentes. Las verificaciones propias se enumeran abajo.
- El disco de sistema llegó a 0 bytes libres durante la sesión. Se continuó en el volumen de datos,
  sin borrar archivos ajenos ni respaldos. Hay que recuperar espacio antes de usar esta PC como puesto operativo.

## 2. Defectos y código corregidos

### Esquema: verificador de habilitación comercial

`businesses.ordering_verified_by` tenía FK `ON DELETE SET NULL`, pero
`businesses_ordering_verified_configuration` exige verificador y fecha cuando `ordering_verified=true`.
La eliminación de un usuario intentaba producir un estado comercial inválido y fallaba con CHECK `23514`.
Se reprodujo en PostgreSQL real sobre las 169 migraciones anteriores.

`20261022233526_retain_ordering_verifier_reference.sql` instala y valida primero una FK `ON DELETE RESTRICT`,
reemplaza la FK anterior dentro de un bloque atómico y agrega índice parcial para esa referencia.
Conserva los CHECK de verificación y habilitación, grants y RLS; no reescribe negocios ni baja ventas.
Un timeout de bloqueo revierte el cambio. La migración es compatible con la transacción y ledgers del runner existente.

Decisión: conservar la atribución y el estado comercial; exigir revocación o reasignación explícita antes de borrar
al verificador. El flujo existente `platform_revoke_business_ordering` exige actor, slug y motivo y registra auditoría.
Una revocación silenciosa por trigger cambiaría disponibilidad comercial al borrar una identidad; relajar el CHECK
dejaría comercios habilitados sin atribución. Se evitaron ambas opciones.

Se investigaron las referencias análogas: `products.verified_by` tenía la misma contradicción en productos
`commercial`. Se reprodujo el CHECK `products_verified_master_data` al eliminar un verificador distinto al del
negocio. La misma migración lo cambia a `ON DELETE RESTRICT`, con índice parcial, sin modificar los CHECK de
catálogo ni publicar/despublicar productos. Su prueba exige mantener publicación y atribución y permite borrar
al verificador sólo después de retirar explícitamente la verificación. WhatsApp ya tiene un trigger que revoca
su verificación al vaciar el verificador: no presenta esta contradicción y no se modificó.

Prueba roja → verde: eliminación del verificador ahora produce FK `23503`, conserva la configuración y el usuario;
vaciar sólo el verificador sigue prohibido; revocar explícitamente o reasignar permite retirar al usuario anterior.
**La migración no se aplicó al QA alojado**: su consulta fue denegada por el conector.

### Simulacros y recuperación de una interrupción

Los dos runners usaban IDs fijos, dependían de que nadie hubiera ejecutado antes el escenario y dejaban datos
financieros sintéticos al terminar. Además, imprimían resultados sin exigir que se hubieran recuperado realmente.

Ahora crean datos propios por UUID; todas las identidades, slug, email, preferencia y recursos pertenecen al run.
El negocio está marcado QA, con ventana de 15 minutos, sin vendedor conectado. Un recibo fuera del repositorio
se guarda antes de escribir. Las aserciones fallan ante recuperación, conciliación, stock o backoff incorrectos.
La limpieza transaccional corre también al fallar; valida propiedad y ambiente y rechaza OAuth, cambios de identidad
o dependencias inesperadas. Conserva auditorías de plataforma y revierte si no puede limpiar de forma segura.

El modo `--local` crea una base propia desde una plantilla aislada; comprueba marca de propiedad antes de
eliminarla. `--cleanup-only` recupera una interrupción y es repetible. Nunca acepta `taba_restore_*` como destino.
Se probó recuperación desde recibo, rechazo de base sin marca, dos ejecuciones independientes, repetición,
limpieza tras error y eliminación de pedidos/pagos/reservas finalizados sin tocar otra ejecución.
No se ejecutaron estos runners contra QA alojado en esta sesión.

### Evidencia financiera e inspector de MP

El inspector leía sólo `payment_intents.provider_payment_id`: omitía otros pagos de una misma compra y sus webhooks.
También convertía errores de consulta en arrays vacíos. Ahora inventaría todas las identidades en
`payment_provider_payments`, sus receipts, hallazgos y posición del ledger, con alcance explícito al negocio QA.
Una lectura financiera fallida aborta; un intent productivo o de otro negocio se rechaza. La herramienta se fija
al proyecto QA exacto. `forged-webhooks` también devuelve error de proceso si no obtiene 401 en todos los casos.

### Restauración y exportación cifrada

El comparador de restauración aceptaba como iguales dos secciones ausentes (`undefined === undefined`).
Una prueba reprodujo el falso positivo. Ahora rechaza secciones ausentes o malformadas e inventario de tablas vacío;
permite `null` sólo donde un agregado vacío legítimo lo produce.

Se agregó empaquetado offline de dump y roles ya cifrados, con hashes y manifiesto mínimo, sin rutas locales,
configuración Auth, texto plano ni clave. Detecta corrupción, archivos extra y sobrescrituras.
Se ejecutó sobre el snapshot local existente de QA del 22/10 y se verificó el paquete. **No se subió fuera de la PC.**
Su manifiesto mantiene `restoreTestCompleted=false`; no se lo convirtió en certificado de DR completo.

La verificación de apertura también descubrió que al adaptador local de pgTAP le faltaba `throws_like`.
Se implementó la semántica SQL LIKE y se probó que error distinto o ausencia de error fallen.
Se conservaron todas las aserciones de la suite comercial.

### Comprobación Deno y catálogo

Se ejecutó Deno 2.6.1, la versión ya fijada por el runner de webhooks. El lockfile no cubría imports existentes;
se completó su cierre transitivo sin cambiar versiones declaradas. Las 13 funciones pasan ahora con lock congelado
y `--node-modules-dir=none`; el comando repetible queda en `npm run check:edge`.
El gestor de imágenes tenía 67 errores de inferencia por `ReturnType<typeof createClient>` genérico y por tipos
JS incompletos. Usa el tipo exportado del SDK y contratos explícitos; no se agregó `any` ni se apagaron comprobaciones.
Una reanudación podía declarar éxito con `cleanup_status=complete` y asset nulo; ahora falla cerrado,
con prueba del código real. Pasaron 57 pruebas de imágenes. Este cambio requiere desplegar
`catalog-image-manager` en QA cuando vuelva a existir acceso; no se modificaron cuerpos financieros de Edge.

La corrida Deno encontró 9 fallos en dos fixtures anteriores a los contratos actuales: lease de 90 s donde el worker
usa 60 s con heartbeat; ausencia de mocks de ledger/heartbeat; el mismo job reaparecía infinitamente aunque fallara;
jobs sin negocio; y expectativa de reintento en vez del parking durable de un refund sin identidad.
Se corrigieron esos modelos con evidencia del worker y de las pruebas PostgreSQL F09/C1, conservando los asserts
de no POST y no liquidar/adivinar identidades. Se agregó el control de evidencia y parking sin asignar un ID.
No se cambió el worker para satisfacer los fixtures.

## 3. Validación propia

| Control | Resultado y alcance |
|---|---|
| Construcción desde migraciones | 170 migraciones en PostgreSQL 17.10 local, loopback; cron/net/Vault con los stubs existentes |
| Regresión financiera PostgreSQL | 141/141; incluye concurrencia, idempotencia, ledger, stock, respaldo y cortes del worker. La extensión final de la FK de productos se volvió a verificar en la corrida focalizada de 12/12, sin repetir los escenarios financieros sin cambios |
| Focalizadas nuevas de esquema y limpieza | 9/9; verificadores de comercio/producto, recibos, interrupción, aislamiento y eliminación segura |
| Efectivo por RPC reales | 2/2: checkout → cobro idempotente → preparación → entrega; devolución manual → cancelación repetida con una sola reposición |
| Adaptador local `throws_like` | 1/1, con controles negativos |
| Cierre focalizado PostgreSQL final | 12/12 (4 de verificadores, 5 de limpieza, 2 de efectivo y 1 del adaptador); incluye la FK adicional de productos y la negativa a limpiar compras de otra identidad |
| SQL del repositorio | aislamiento de medios 5/5; apertura 84/84; roles back office 28/28; desconexión MP 18/18; rechazo/reintento aprobado (guion SQL) |
| JavaScript focalizado final | 321/321, 0 omitidas: pagos, OAuth/webhooks simulados, efectivo, disponibilidad, recuperación, inspector, respaldo y catálogo |
| Catálogo e imágenes (incluido en 321) | 57/57, con reanudación inválida y publicación repetida |
| Tipos Deno | 13/13 entradas, lock congelado, sin materializar node_modules |
| Webhooks/runtime Deno | 258/258 (52 + 206), sin red; además 12/12 Node del runner, ya incluidas en las 321 |
| Migraciones / `npm run check` | 170 en orden; sintaxis, config, precache, identidad, higiene, codificación y escaneo de secretos aprobados |
| Preview remoto | 375/375 archivos idénticos al artefacto; 16/16 controles de puerta, identidad y revalidación |

No se repitieron las 3106 pruebas JavaScript ni la matriz completa de Playwright: no cambió el frontend.
Las pruebas de MP usan proveedor simulado; las de SQL son PostgreSQL real. Los stubs no certifican servicios alojados.
El re-baseline de compatibilidad de producción sigue pendiente: requiere el HEAD final y la revisión del release.

## 4. GitHub y preview

Se conserva el historial y el [PR 148](https://github.com/bitflowapp/la-taba-pages-preview/pull/148) como revisión
de toda la candidata. Los commits de este cierre llevan `[CF-Pages-Skip] [skip ci]` para evitar despliegues implícitos.
Se revisó el diff contra `4254705a` y contra la base del PR. Sin respaldos, credenciales ni datos privados en el commit.
Sin merge a `main`.

El [preview QA](https://recovery-20261020.taba2-staging.pages.dev) sirve el commit `1c8d0635`, runtime
`la-taba-runtime-v159-panel-first-login`, build `2026-10-22T22:59:29.091Z`, igual al recibo anterior.
Se comprobó la puerta con acceso anónimo, credencial inválida y sesión firmada; las tres identidades PWA coinciden.
Este cierre cambia esquema/herramientas y el gestor de imágenes: no requirió publicar otro frontend.

## 5. Supabase QA: límite verificable

La llamada del conector `get_project(ixewllzzuzpqrkxzmfzx)` devolvió
`You do not have permission to perform this action`. No se intentó otro canal para sortear esa denegación.
No hay lectura actual propia de tablas, cron, asesores, funciones ni credenciales alojadas; no se aplicaron migraciones.
Los 169 registros, 13 funciones activas, cinco cron, HMAC y ausencia de firma webhook son **antecedentes documentados**,
no certificaciones actuales de esta sesión. Ver procedimiento de aplicación y verificación en [RUNBOOK.md](RUNBOOK.md).
La base `taba_restore_20261022_ad3d29a2` se conservó: no se consultó, modificó ni intentó eliminar.

## 6. Mercado Pago: preparación y pendientes auténticos

La integración existente usa Checkout Pro con preferencias y lectura de Payments API. Se revisaron PKCE/OAuth,
credenciales fuera del cliente, HTTPS, external_reference, idempotencia, retorno validado en servidor, HMAC con
SDK oficial sobre `data.id` de la query, comparación query/body y ventana de frescura. La confirmación durable
precede al acuse del webhook; el worker relee al proveedor. `sandbox_init_point` se conserva por compatibilidad,
pero el redirect elige `init_point` y no el host obsoleto. No se introdujo una migración a otro producto de MP.

La ronda de [compras oficiales con preferencias](https://www.mercadopago.com.ar/developers/en/docs/checkout-pro-preferences/integration-test/test-purchases)
y la [validación oficial de webhooks](https://www.mercadopago.com.ar/developers/en/docs/zero-dollar-auth/additional-content/your-integrations/notifications/webhooks)
se prepararon en el runbook con casos y criterios: OAuth de vendedor de prueba, aprobado, rechazado/reintentado,
pendiente, tardío, parcial/total, cancelación, conciliación sin webhook, corte del worker, pagos múltiples y stock.
No hay evidencia nueva de transacciones auténticas, de calidad por payment_id real ni de homologación oficial.
Cada caso debe compararse con el recurso de MP; una simulación aprobada no sustituye esa evidencia.

## 7. Cobertura real del respaldo y recuperación

| Elemento | Cobertura / brecha |
|---|---|
| Pedidos, pagos, refunds, reservas, stock | Dump PostgreSQL cifrado; prueba local de restauración financiera y conciliación incluida en la regresión |
| Usuarios y autorización | Auth/tabla y RLS/ACL/políticas en herramientas existentes; ownership y servicios Auth administrados requieren ensayo separado |
| Roles | Archivo cifrado separado, sin passwords; contraseñas de roles y accesos deben reaprovisionarse |
| Workers | Código versionado; cron/net/Vault administrados y configuración deben inventariarse y reconstruirse, no se certificó restore integral |
| Tokens OAuth | Los valores protegidos en DB necesitan también `MERCADOPAGO_TOKEN_ENCRYPTION_KEY`; sin esa clave el dump no recupera acceso al vendedor |
| Secretos | Edge, app client secret, firma webhook, HMAC del worker, claves JWT/SMTP y configuración Cloudflare necesitan custodia y recuperación separadas |
| Storage | Metadatos en DB; bytes de objetos no incluidos por PostgreSQL |
| Copia externa / clave | Paquete local preparado y comprobado; destino externo, recibo, custodio y ensayo desde otra máquina pendientes |

La [documentación de Supabase](https://supabase.com/docs/guides/platform/backups) recomienda copias externas para
Free y aclara la exclusión de bytes de Storage. El runbook propone usar capacidad existente, sin nuevos servicios,
retención y RPO/RTO para acordar. No hay un SLA ni una tarea programada activados por esta sesión.

## 8. Intervención del propietario y autorización de Walter

**Propietario técnico:** restablecer acceso al QA exacto; revisar/aplicar migración con respaldo y cron controlado;
autorizar la ronda MP de prueba; titular de la app configura la firma y realiza login/MFA sin compartir claves;
elegir destino privado de copia externa, custodio independiente y RPO/RTO; revisión financiera independiente del HEAD final.
Liberar espacio en el sistema de esta PC. No hace falta borrar la base de restauración denegada para continuar.

**Walter:** validar catálogo real, precios, stock, fotos/derechos y procedimiento de caja/entregas/devoluciones;
acordar riesgo de recuperación. Se requiere su autorización explícita para vincular su vendedor de producción,
habilitar cobros y realizar cualquier compra o devolución real. Los pasos de QA no autorizan esas acciones.

## 9. Veredicto y acciones restantes para abrir

El cambio de esquema y las herramientas están preparados para revisión y pruebas controladas.
**No se concede GO técnico de producción** mientras falten aplicación/verificación QA y evidencia financiera auténtica,
recuperación integral y revisión independiente. **No se concede GO comercial** sin validación y autorizaciones de Walter.
Efectivo conserva su circuito independiente; que ese circuito pase localmente no valida toda la operación comercial.

1. Restablecer QA y aplicar/verificar la migración con backup, ledgers y cron controlados.
2. Autorizar y completar la matriz auténtica MP en cuentas de prueba; resolver cualquier discrepancia antes de avanzar.
3. Demostrar copia externa, custodia separada y restauración integral con RPO/RTO acordados.
4. Walter valida catálogo y operación; revisión financiera independiente y compatibilidad del release final.
5. Con autorización expresa de ambos titulares: despliegue productivo controlado, OAuth de Walter y validación real
   de monto mínimo; abrir a pocos clientes sólo tras aprobar esos resultados.
