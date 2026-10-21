# La Taba: informe de finalización técnica (21/10/2026)

Rama `recovery/la-taba-free-hosted-20261020`. Destino exclusivamente de pruebas: Supabase Free `ixewllzzuzpqrkxzmfzx` y Cloudflare Pages `taba2-staging`. No se tocó producción, la aplicación productiva de Mercado Pago ni ningún cobro real.

## Veredicto: NO-GO comercial

Faltan: firma del webhook, OAuth del vendedor de prueba, pagos de prueba contra Mercado Pago, custodia externa de respaldos, validación de precios/costos/stock de Walter y su autorización de vinculación. Sin esos puntos no hay pago confiable demostrado.

## 1. Mercado Pago (TABA2 Staging, 2691240967769590)

| Ítem | Estado |
|---|---|
| Callback OAuth `…ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback` | **Registrado y persistido** (verificado recargando). Se conservó el callback anterior de otro proyecto |
| PKCE | Habilitado ("Sí") |
| Permisos | read, write, offline_access |
| Webhook, URL de modo prueba | Ya apuntaba al proyecto correcto (73 caracteres) |
| Webhook, eventos | Pagos (legacy), Órdenes comerciales, Vinculación de aplicaciones. El receptor sólo procesa pagos |
| Firma del webhook | **Pendiente.** El clasificador de seguridad bloqueó la extracción por script; un intento posterior por la interfaz chocó con la verificación de identidad por SMS que Mercado Pago pidió. `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` sigue ausente |
| Historial de notificaciones | 1 entrada: `topic_merchant_order_wh`, 502, 17/10 (endpoint anterior) |

Sin la firma, el receptor falla cerrado: rechaza todo lo no firmado (verificado).

## 2. Supabase

- Salud: auth, db, realtime, rest, storage en ACTIVE_HEALTHY.
- Verificación API alojada: 17 de 18 comprobaciones aprobadas en la corrida completa. La fallida fue la de Realtime con la fila del comercio histórico, que no cambia de valor; se reemplazó por pruebas sobre el comercio QA (ver abajo).
- **Aislamiento entre comercios con sesiones reales (dueño A, dueño B, comprador, anónimo): 28/28.** Incluye lecturas, escrituras, apertura, auto-otorgamiento de rol, tablas de pagos (`payment_intents`, `mp_seller_connections`, `mp_oauth_states`, `payment_webhook_receipts`, `payment_outbox`) y `unit_cost`. Evidencia: `2026-10-21-hosted-free-evidence/tenant-isolation-20261021.json`. Para leer como equipo no basta ser miembro: se exige una sesión de panel registrada (`identity_register_session`).
- Ciclo de pedido real (retiro, efectivo): creación, reserva de stock, lectura del panel, cancelación, stock devuelto una sola vez, ventana QA cerrada. 11/11 con el servicio en caliente.
- **Realtime:** en la primera corrida tras inactividad la suscripción llegó a SUBSCRIBED pero no entregó eventos (evidencia `order-realtime-coldstart-miss-20261021.json`). En la corrida siguiente, dueño y comprador recibieron INSERT/UPDATE. Causa probable: arranque en frío de la replicación. Riesgo: `js/repositories/supabase_order_repository.js` detiene el polling al quedar SUBSCRIBED, de modo que el panel podría quedar desactualizado hasta que vuelva el navegador al frente. **Propuesta, sin implementar:** mantener un polling de respaldo lento (30–60 s) aunque el canal esté SUBSCRIBED.
- Advisors de seguridad: 8 funciones `SECURITY DEFINER` ejecutables por `anon` (rutas públicas de tienda: disponibilidad, seguimiento por token, combos, contacto, y las sondas del scheduler); 3 funciones privadas con `search_path` mutable; 52 tablas con RLS sin políticas (acceso sólo por servicio, intencional); 63 avisos por inicio de sesión anónimo permitido. Se revisó `check_scheduler_watchdog`/`scheduler_heartbeat`: son sondas externas por diseño; riesgo bajo (crean alertas deduplicadas). Ninguno se cambió.
- Secretos: presentes los de pagos salvo la firma del webhook. `FISCAL_PANEL_ORIGINS` no figura en la lista.
- Una identidad anónima sintética quedó huérfana por una corrida mía cortada; se eliminó. Usuarios finales: sólo los 3 QA.
- Los 72 productos históricos siguen privados en `private.la_taba_recovery_source_rows`; ninguno en el catálogo público.

## 3. Respaldos

- El plan Free no tiene respaldos automáticos (`backups: []`, sin PITR).
- Existen dos snapshots cifrados manuales (AES-256-GCM) en `D:/work/la-taba-backup-20261021` (142 MB) y la restauración de aplicación se probó en dos bases aisladas.
- **No hay copia externa.** D: tiene unos 70 MB libres y F: es un disco USB exFAT con estado de salud "Warning". La clave vive sólo en Windows Credential Manager de esta PC. La restauración completa de la plataforma administrada (cron, Realtime, Vault) no está demostrada.

## 4. Cloudflare

- Preview QA publicado: **https://recovery-20261020.taba2-staging.pages.dev** (despliegue `020853ef`, entorno *preview*, rama `recovery-20261020`; la rama de producción del proyecto es `staging` y no se tocó).
- 270 archivos / 7,2 MB: 269 estáticos + `_headers`. Sin variables de entorno en el proyecto. Auditoría de contenido: sin claves de servicio, tokens ni credenciales (sólo la clave publicable). Las imágenes de producto se filtraron por derechos.
- `X-Robots-Tag: noindex, nofollow, noarchive`, `robots.txt` con `Disallow: /`, `X-Frame-Options: DENY`.
- Apunta al comercio QA A (cerrado fuera de ventanas QA): no se ofrecen pedidos reales y no se publicó ninguna tienda comercial.
- **No se aplicó Cloudflare Access** (requiere habilitar Zero Trust). La protección real de datos es RLS de Supabase; el sitio no es indexable pero sí abierto por URL.
- Reversión: borrar el despliegue `020853ef` o la rama de preview no afecta a `staging`.
- Incidente propio: el archivo de sesión de wrangler quedó en 0 bytes (C: sin espacio, escritura in situ). Se reautorizó con el flujo OAuth estándar y la sesión nueva está en `D:/work/taba-cf-session/session.json`, escrita de forma atómica. **Rotar o revocar esa autorización** en el perfil de Cloudflare cuando termine la fase.

## 5. Pruebas de integración de pagos

| Escenario | Estado real |
|---|---|
| Suite local de pagos (`npm run test:payments`) | 205/205, con respuestas del proveedor simuladas |
| Preflight de pagos | Sin cambios: falta la firma; `commercialGuardsIntact: true`; 0 intents/conexiones/ajustes fuera de test |
| Rechazos HTTP sin firma/sesión/origen (checkout, cancelación, reembolso, webhook, OAuth) | Aprobado |
| 1 OAuth del vendedor de prueba, 2 renovación, 3–7 checkout/pago aprobado/rechazado/pendiente, 8–9 webhook auténtico y reintentos, 10 idempotencia remota, 11 cancelación, 12 reembolso, 14 recuperación remota | **No ejecutado. Bloqueado:** requiere la firma del webhook, el login interactivo del vendedor/comprador de prueba en Mercado Pago (que incluye verificación por SMS) y datos de tarjeta de prueba ingresados por una persona. No se simuló ningún resultado |
| 13 Pedido y stock | Aprobado sin proveedor de pago (retiro/efectivo) |
| 15 Pedido visible en el panel del comercio | Lectura del panel aprobada por RPC; el panel visual autenticado no se recorrió |
| `live_mode` | Sin observar. El código comenta que los pagos de usuarios de prueba pueden informar `live_mode=true` en Checkout Pro: confirmar con el primer pago real de prueba antes de afirmar `false` |

## 6. Vinculación comercial de Walter (preparada, no ejecutada)

El flujo es el descrito en `2026-10-21-mercadopago-configuration-handoff.md`: el panel emite la URL con state de un solo uso y PKCE S256; Walter autoriza personalmente en Mercado Pago, sin compartir contraseña ni códigos. Requisitos antes de emitirla: confirmar aplicación y titularidad comercial, un vínculo de despliegue comercial distinto del de pruebas, y no reutilizar credenciales de prueba. Ningún interruptor de cobro comercial se activó.

## 7. Frontend y catálogo

Auditoría móvil (Chrome, 390×844, preview QA, sin enviar pedidos): carga 2,2 s, FCP 0,67 s, sin scroll horizontal, sin imágenes rotas, sin controles sin nombre, meta viewport correcto, 1 objetivo táctil menor a 44 px. Con vendedor no conectado el checkout ofrece sólo "Efectivo al retirar", sin mostrar Mercado Pago (falla cerrada correcta).

Defectos menores observados:
1. El chip de categoría dice "Almacen" sin tilde y el título de la sección "Almacén".
2. Aviso de consola: `cervezas-heineken-band.webp` se precarga y no se usa en este comercio.
3. En el carrito hay un hueco vertical grande entre "Seguir comprando" y "Productos", y el texto "ENVIAR A" se asoma detrás del botón del carrito en el encabezado.
4. El nombre del comercio se trunca en la barra inferior (esperable con el nombre QA; revisar con el nombre real).
5. Las secciones "Destacados" y la de categoría repiten los mismos productos (efecto del catálogo QA de 3 productos).

No se corrigió código del frontend: propongo estos cambios para aprobación, sin rediseño.

Catálogo histórico (respaldo del 18/09; datos de agosto-septiembre, ya vencidos):
- 72 productos, 72 SKU distintos, todos `price_status=confirmed`, verificados, origen comercial, precios de $1.450 a $29.490 (promedio $5.962).
- 34 disponibles y 38 no; 15 con stock 0 y 2 con stock bajo; 854 unidades; 27 alcohólicos (requieren control de mayoría de edad).
- **0 productos con costo**: no se pueden calcular márgenes y no se inventaron. **0 con imagen.**
- Hay marca+presentación repetidas con precios muy distintos (p. ej. Coca-Cola Original $1.800 / $4.990 / $5.900; Quilmes Lager $2.050 / $3.000 / $11.400) porque el campo `presentation` no informa el tamaño. Walter debe validar cada uno.
- Promociones y combos: no hay filas de combos en el respaldo; no se evaluaron.

## 8. Intervenciones pendientes

Marco/Walter: 1. verificar identidad en Mercado Pago y copiar la firma del webhook; 2. iniciar sesión como vendedor y comprador de prueba y completar consentimiento y pagos de prueba; 3. confirmar precios, costos, stock, imágenes y derechos de los 72 productos; 4. decidir custodia externa cifrada y rotación de la clave de respaldo; 5. autorizar expresamente la vinculación comercial y cualquier activación de producción; 6. revocar la autorización OAuth de Cloudflare creada para esta fase.

## 9. Entorno

C: sin espacio libre (un fallo de escritura ya truncó un archivo de configuración); D: casi llena; F: USB lento y con advertencia de salud, y compartido con compilaciones de otras sesiones. Esto retrasó varias pruebas, y debería resolverse antes del lanzamiento porque afecta también a respaldos y herramientas.
