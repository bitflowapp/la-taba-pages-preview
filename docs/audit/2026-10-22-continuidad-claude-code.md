# La Taba — continuidad desde Claude Code (22/10/2026)

**Rama revisable:** `recovery/la-taba-free-hosted-20261020`  
**Build del preview:** `1d40194f` · runtime `la-taba-runtime-v156-worker-cache-isolation`  
**Preview QA:** <https://recovery-20261020.taba2-staging.pages.dev> · Pages `taba2-staging`, branch `recovery-20261020`, despliegue `6db70e88-adfa-48b2-84d1-8b8a25110df5` (*preview*). La rama productiva sigue siendo `staging`.  
**Backend QA:** Supabase `ixewllzzuzpqrkxzmfzx`. No se publicó producción ni se hicieron cobros.

## Veredicto: NO-GO comercial

La candidata técnica está publicada en QA. La entrega comercial sigue bloqueada por la firma del webhook, el consentimiento OAuth del vendedor de prueba, un pago auténtico de prueba y la revisión de Walter de los datos de catálogo. La aplicación y el proyecto de Mercado Pago de producción no se tocaron.

## Recuperación del trabajo

- Se preservaron `77aec712`, `ba8a50ed` y `e079f1a2`; al comenzar, la rama local tenía los dos últimos commits que aún no estaban en GitHub. Se inspeccionaron los cambios pendientes sin resetear, limpiar ni sobrescribir archivos.
- Las cuatro áreas delegadas por Claude están presentes: frontend/carrito/checkout; catálogo, costos y márgenes; seguridad y límites de QA; planilla histórica de 72 SKU. Las sesiones de los agentes encontradas en el estado de Claude estaban terminadas.
- El generador de planilla calcula ganancia, margen, recargo y descuentos sin inventar valores. El XLSX de Walter contiene 72 SKU únicos y deja vacíos costo, precio actual, precio regular, stock y disponibilidad hasta confirmación. Está fuera de Git. No se importaron los productos históricos al catálogo público.
- Se preservaron las mejoras de vinculación y estados de Mercado Pago, errores de retorno OAuth, desconexión segura, reintentos de cancelación/devolución e idempotencia de pedidos. La revisión final corrigió además una carrera de navegación en la prueba PWA y el uso de cachés de versiones previas: v156 lee el precache propio para HTML/CSS/JS y sólo acepta cachés anteriores para imágenes de producto inmutables.

## Estado alojado y seguridad

- El ledger estándar de Supabase tiene 164 migraciones; el ledger de recuperación también tiene 164, sin divergencia. Las migraciones `20261021234000_catalog_cost_compare_at.sql` y `20261021235000_security_hardening.sql` se aplicaron sólo a QA. Sus pruebas SQL alojadas aprobaron 47/47 y 55/55.
- Se desplegaron 11 funciones de QA (9 de Mercado Pago y 2 de administración/catálogo); las 28 fuentes remotas comparadas coincidieron con el checkout local. La verificación de API alojada aprobó 18/18 en el segundo intento; aislamiento entre comercios, 28/28.
- Los asesores de Supabase informan 0 errores, 230 advertencias y 52 notas. Hay advertencias de funciones `SECURITY DEFINER`, acceso anónimo y tablas de servicio con RLS sin políticas; siguen sujetas a revisión antes de un lanzamiento comercial.
- La ventana QA se cerró después de la auditoría móvil. Continúan sólo tres productos sintéticos de QA. El job `taba-security-retention-sweep` permanece inactivo.
- El preview incluye `X-Robots-Tag: noindex, nofollow, noarchive` y `robots.txt` con `Disallow: /`, pero no tiene Cloudflare Access. La URL es accesible públicamente y muestra datos de QA; noindex no es control de acceso.
- No hay una copia externa demostrada de los respaldos ni custodia externa de la clave de restauración. El plan actual no habilita backups automáticos/PITR. Esto también queda pendiente antes del uso comercial.
- Espacio al cerrar: C: 1,31 GB libres; D: 22,34 GB. No se usó F: ni se interfirió con APEX.

## Pruebas

- `npm run check`: aprobado; precache de 125 módulos cliente y 64 diferidos, release hygiene, firma v156, revisión de ubicación, codificación SQL y secret scan.
- `npm test`: 3080/3080 aprobados, 0 fallos.
- `npm run migrations:validate`: 164 migraciones en orden, revisión estática sin bloqueos.
- `npm run test:payments`: 222/222 con respuestas del proveedor simuladas.
- `npm run test:webhook`: 206 pruebas Deno y 12 Node con fixtures HMAC; no son notificaciones auténticas de Mercado Pago.
- E2E amplio: 820 aprobados, 7 omitidos y 1 fallo en 828 casos. El fallo era una prueba que no esperaba la recarga de la página al actualizar el service worker. Tras sincronizarla, el archivo de actualización PWA aprobó 6/6 y las pruebas de PWA/recuperación del service worker aprobaron 49/49. La suite completa de 828 casos no se volvió a ejecutar después de esa corrección.
- Auditoría móvil alojada del build v156: catálogo → carrito → checkout pasó sin enviar pedido. 0 desbordes horizontales, 0 controles menores de 44 px, 0 controles sin nombre y 0 imágenes rotas. El 401 de `get_mercadopago_checkout_availability` corresponde a la consulta anónima que, por diseño, no ofrece Mercado Pago antes de guardar la identidad del comprador. El recorrido mostró sólo medios offline porque no hay vendedor de prueba vinculado. Playwright tuvo que forzar el cierre de un worker WebKit que no terminó durante la ejecución amplia.

## Mercado Pago

La firma `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` sigue ausente. Sin ella, el webhook falla cerrado y no acepta eventos no firmados. La aplicación está preparada para leer esa firma desde Supabase usando el helper de portapapeles, pero la consola del navegador de Mercado Pago no se pudo abrir desde esta sesión: la política del entorno rechazó el lanzamiento del navegador y no hay herramienta de navegador/Mercado Pago conectada.

Walter o el titular autorizado debe entrar al panel de desarrolladores, completar SMS/WhatsApp/MFA y obtener la firma directamente en el navegador. No debe pegarla en este chat ni guardarla en el repositorio. Luego se puede usar el helper local para guardarla en Supabase QA y verificar la función. También faltan el OAuth del vendedor de prueba, el login del comprador de prueba, una compra autorizada con tarjeta de prueba y la conciliación auténtica de cancelaciones/devoluciones. No se usaron cuentas comerciales reales ni hubo transacciones.

## Pendientes antes de Walter y del lanzamiento

1. Completar MFA y firma del webhook; verificar que la Edge Function rechace firmas inválidas y procese las válidas.
2. Autorizar el vendedor de prueba por OAuth y completar pagos de prueba reales del proveedor, cancelación, devolución e idempotencia.
3. Walter valida por SKU nombre/presentación, disponibilidad, costo, precio, stock, fotografía y derechos. Hasta entonces los 72 productos quedan privados y fuera del storefront.
4. Preparar el OAuth comercial con otra aplicación/entorno, proteger el preview con Access o equivalente y revisar las advertencias de Supabase.
5. Definir custodia externa cifrada y probar restauración antes de introducir datos comerciales.
6. Obtener autorización explícita antes de vincular el vendedor comercial, activar pagos reales, publicar producción o hacer merge comercial.

## Guía para Walter

La guía breve está en [`docs/operacion/guia-rapida-walter.md`](../operacion/guia-rapida-walter.md). El preview actual es de QA: permite revisar el panel con tres productos sintéticos, pero no hay que vincular allí una cuenta comercial ni tratar esos productos como catálogo de La Taba.
