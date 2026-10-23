# La Taba - recuperación alojada en Supabase Free

Fecha local: 21/10/2026, Argentina. Este informe actualiza el diagnóstico del 20/10; los informes anteriores son evidencia histórica.

## Resultado

**Infraestructura de recuperación creada y verificada. Lanzamiento comercial: NO-GO.**

- Organización: **La Taba**, `tpdpuvnasszkcpdanxpk`, plan **Free** comprobado por API.
- Proyecto exclusivo: **la-taba-recovery-test**, `ixewllzzuzpqrkxzmfzx`, región **sa-east-1**, estado **ACTIVE_HEALTHY**.
- La creación respondió **HTTP 201**. El cupo Free permitió crear el proyecto tras la pausa de Estela. No hubo rechazo de cuota en este intento.
- Costo adicional de infraestructura contratado: **USD 0**. No se solicitaron suscripciones, ampliaciones de instancia, addons, IPv4 pago ni PITR. La propuesta Pro de USD 10 está marcada como **rechazada**; el ejecutor de recuperación acepta exclusivamente La Taba Free.
- APEX y Bitflow siguen ACTIVE_HEALTHY; Estela sigue INACTIVE. Sólo se consultaron sus estados. No se pausaron, migraron ni modificaron estos proyectos.
- Backend de pruebas: https://ixewllzzuzpqrkxzmfzx.supabase.co . Es una API, no la tienda.
- La URL frontend propuesta es https://recovery-20261020.taba2-staging.pages.dev . **Todavía no está desplegada ni verificada**: sesión Cloudflare vencida, consulta HTTP 403. No presentar esa URL como operativa.

## Recuperación y datos

Se ejecutaron **las 159 migraciones originales sin alterar sus bytes**, en orden, con transacción por versión, SHA-256, bloqueo y dos registros de migraciones concordantes. Luego se agregó y aplicó una migración de seguridad: **160 versiones aplicadas en total**. No se ejecutó seed.sql.

El comercio inicial procede de la primera migración del repositorio; no se presenta como un registro comercial recuperado. Quedó paused, ordering_enabled=false y ordering_verified=false. No hay configuración de pagos habilitada. Los cinco cron taba-* están desactivados durante la recuperación.

El respaldo parcial de 18/09/2026 tiene SHA-256 `6983957294de53c7cb3c59ba7aefcc605d2bfb2673b0c5288b6568322b231219`. Se conservaron **76 proyecciones** en `private.la_taba_recovery_source_rows`:

| Contenido | Filas | Alcance |
|---|---:|---|
| Productos | 72 | Identidades y campos históricos disponibles, con hash por fila |
| Comercio | 1 | Proyección parcial original |
| Resúmenes de pedidos | 3 | Agregados; no son pedidos reconstruibles |

RLS está habilitado en esa tabla y se revocó acceso a anon, authenticated y service_role. No se importaron productos al catálogo público ni precios o stock antiguos al circuito comercial. La comprobación final registra **0 usuarios Auth, 0 productos públicos, 0 pedidos y 0 payment_intents**, luego de eliminar las identidades sintéticas de las pruebas API. No se inventó historia comercial.

No se pueden recuperar del respaldo: usuarios/contraseñas y sesiones Auth, pedidos completos e ítems, transacciones de Mercado Pago, consentimiento OAuth ni objetos originales de Storage. El archivo SQL de cero bytes no sirve como respaldo. Supabase documenta que eliminar un proyecto elimina permanentemente sus datos y respaldos: https://supabase.com/docs/guides/platform/backups . No hay una restauración del proyecto eliminado demostrada.

Se generó una versión actualizada de la planilla para Walter, guardada localmente fuera del repositorio público; la anterior se preservó. Contiene los 72 productos y etiqueta los valores históricos como vencidos. Los campos actuales de costo, precio, precio regular, stock y disponibilidad quedan vacíos. La planilla calcula ganancia, margen, recargo y descuento, y trae una hoja de instrucciones. No fue importada ni publicada. Walter debe confirmar presentación, categoría, fotos y derechos en el Panel antes de publicar.

## Componentes comprobados

| Componente | Evidencia y límite |
|---|---|
| Base de datos | 159 versiones preservadas + 1 corrección; registro con hashes y reanudación |
| Auth | Alta anónima real, renovación de sesión, cierre y eliminación de la identidad QA; no valida entrega de correo ni SMTP comercial |
| RLS | Ninguna tabla de public/private/catalog_admin sin RLS; consultas de invitado a pagos, conexiones y estados OAuth respondieron 403 |
| Vistas | Consulta de vistas públicas sin security_invoker devolvió cero filas |
| Storage | 4 buckets configurados; carga de objeto sintético con servicio, rechazo de lectura pública del bucket privado y eliminación verificados |
| Realtime | 10 tablas en publicación; suscripción y recepción de UPDATE real verificadas. La primera prueba con una actualización sin cambio observable no recibió evento; el reintento con updated_at distinto sí |
| Edge Functions | Las 13 desplegadas y ACTIVE con código del manifiesto; rechazo de solicitudes no autorizadas o malformadas comprobado. Eso no certifica cada operación de negocio |
| Worker | Solicitud HMAC válida: HTTP 200, claimed=0, completed=0, retried=0. No se ejecutó trabajo financiero ni se activaron cron |
| Frontend | Artefacto existente preparado en D:, sin rediseño ni publicación; falta preview accesible y recorrido de navegador contra éste |

## Mercado Pago

Se conservaron las tres correcciones de la auditoría anterior:

1. Respuestas inciertas/transitorias al crear una preferencia no se convierten en fallo definitivo.
2. Una cancelación sólo registra éxito si la respuesta corresponde al ID de pago esperado.
3. Un reintento de cancelación reutiliza la operación persistida y evita un segundo PUT al proveedor.

Sólo se utilizó la app **TABA2 Staging 2691240967769590**. Se configuraron entorno test, modo OAuth y vínculo al proyecto nuevo; los secretos se guardaron en servidor y se comprobaron sus hashes. La credencial de prueba se había autenticado ante /users/me como usuario test de Argentina. Se recuperaron mediante la herramienta las cuentas QA de vendedor 3594962708 y comprador 3594962710; sus contraseñas quedaron en Windows Credential Manager. La herramienta informó que ambas ya existían. No se cargaron fondos ni se crearon usuarios comerciales.

La herramienta de Mercado Pago confirmó el callback **de prueba** del webhook en el proyecto nuevo. Conservó el campo de producción de la app de staging. No se modificó la app comercial 7677852968049976.

**Bloqueo actual:** el conector sólo devuelve siete caracteres de la firma del webhook. Falta cargar la firma completa como MERCADOPAGO_OAUTH_WEBHOOK_SECRET. Las solicitudes al webhook responden 503 PAYMENT_UNAVAILABLE mientras falta; el sistema no acepta confirmaciones no verificadas. Ese rechazo **no es una prueba de HMAC auténtico**.

También se solicitó registrar el redirect OAuth nuevo en la app de staging. No se demostró todavía consentimiento del vendedor contra este proyecto, intercambio/renovación de tokens reales de prueba, checkout alojado de MP, notificación auténtica, cancelación ni reembolso remoto de prueba. No se reemplazó ese consentimiento por un token insertado manualmente.

## Pruebas y correcciones nuevas

- Cinco suites ejecutadas contra **PostgreSQL alojado**: lifecycle de checkout/pagos; OAuth; disponibilidad del vendedor; interruptor de pagos; alertas de reconexión. Las cuatro suites TAP suman **49 aserciones**; lifecycle usa excepciones/asserts SQL. Todas las fixtures se revierten con ROLLBACK. Las respuestas del proveedor en estas suites son **simuladas**.
- Lifecycle verifica reserva y restitución de stock, idempotencia, rechazo de totales suministrados por el cliente, confirmación, pedido único, reintentos y asociación/idempotencia de reembolsos. No ejecuta pagos en Mercado Pago.
- Se corrigió una fixture antigua que asociaba al producto rutas y hashes distintos del asset de catálogo. Se preservó el primer error; tras corregir la fixture pasó la suite alojada.
- **18 comprobaciones API alojadas aprobadas**, con limpieza de la identidad y archivo QA.
- Cuatro funciones tenían search_path modificable por el llamante. Se fijó pg_catalog,public,pg_temp mediante migración nueva, conservando su lógica y permisos. Se verificó proconfig en el servidor.
- Advisor SQL final: **0 errores, 235 advertencias y 52 avisos informativos**. Las advertencias restantes son 3 search_path de funciones privadas de control legado, 8 RPC SECURITY DEFINER ejecutables por anon, 161 ejecutables por authenticated y 63 observaciones por acceso anónimo Auth. No se consideran todas defectos confirmados ni se eliminaron permisos necesarios a ciegas; requieren revisión de autorización y de monitoreo antes del GO. Los avisos RLS sin políticas incluyen tablas privadas cerradas de forma deliberada.
- Las pruebas locales de Node de Mercado Pago/recuperación tienen log separado. Los resultados locales anteriores de Deno y navegador no equivalen a E2E del nuevo proyecto.
- Un intento de redespliegue se detuvo por ConnectTimeout antes de escribir. Un segundo intento con resolución IPv4 completó las 13 funciones. Se preservan los recibos.

## Backups, restauración y límites Free

La infraestructura original se reprodujo a partir de migraciones y del respaldo parcial; eso **no constituye una prueba de restauración de un backup completo del nuevo proyecto**. Debe programarse y ensayarse antes de vender. Supabase recomienda exportaciones externas para Free; los respaldos de base no incluyen los objetos de Storage. Ver el runbook adyacente.

Free permite las 13 funciones: el límite documentado es 100. El wall clock es 150 segundos; el worker de recuperación limita cada ejecución a una reclamación de trabajo y una renovación, con lease de 90 segundos. Falta validar tiempos bajo carga, reintentos y eventual acumulación. Fuente: https://supabase.com/docs/guides/functions/limits . No se identificó una imposibilidad técnica que requiera pasar a Pro para continuar con pruebas.

No se contrató respaldo pago, monitoreo pago, SMTP pago ni se descargaron imágenes Docker o navegadores. Todos los temporales, artefactos y nuevos objetos de commits de esta etapa están en D:. Se usí el código existente en C: y sus dependencias ya instaladas.

## Pasos humanos y pendientes para lanzamiento

1. Copiar la firma íntegra de TABA2 Staging directamente en Supabase Functions Secrets, sin enviarla por chat. Registrar https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback como redirect permitido de esa app.
2. Renovar acceso a Cloudflare para publicar sólo la rama preview recovery-20261020 del proyecto taba2-staging. La solicitud está pendiente. La sesión vencida no sirve para publicar.
3. Ejecutar OAuth con el vendedor QA y el circuito real de prueba: checkout alojado, pago aprobado/rechazado, webhook firmado, pedido único, stock, cancelación, reembolso, interrupción y reconciliación.
4. Validar precios, costos, existencias, fotos, presentaciones, entregas y datos comerciales con Walter; importar sólo los datos aprobados. Asignar su identidad administrativa por un procedimiento verificado.
5. Revisar advertencias de autorización, correo Auth, monitoreo externo, notificaciones al comercio y backup/restauración. Activar los schedulers sólo en el entorno de prueba cuando su configuración y secretos están completos.
6. Preparar un despliegue comercial separado y obtener aprobación explícita antes de vincular cuentas comerciales, publicar producción o habilitar cobros reales.

**GO para continuar QA técnico en Free. NO-GO para ventas o cobros reales.**

## Ubicación de evidencia y código

- Evidencia sin secretos: docs/audit/2026-10-21-hosted-free-evidence/.
- Manifiesto inicial: docs/audit/2026-10-21-hosted-recovery-plan.json. Candidato actual: docs/audit/2026-10-21-hosted-recovery-plan-20261021-final.json.
- Recibo del destino: deploy/recovery-free-hosted.json.
- Scripts reproducibles: scripts/recovery/{bootstrap-hosted,deploy-functions,verify-hosted-sql,verify-hosted-api,verify-functions,prepare-preview}.mjs.
- Evidencia extendida y fallos iniciales: directorio local privado, fuera del repositorio.
- Rama de revisión: recovery/la-taba-free-hosted-20261020. Usa objetos previos del repositorio original mediante alternates; no es una copia de respaldo independiente.

Local Node verification: 232 passed, 0 failed. See free-hosted-node-tests-final.log.
