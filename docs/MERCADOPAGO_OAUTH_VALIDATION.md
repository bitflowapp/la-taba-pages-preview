# Validación — 5 de septiembre de 2026

Estado: **BLOCKED antes de READY FOR WALTER**. Implementación y staging desplegados; faltan las credenciales de una aplicación bajo control de Marco/LUNA y la prueba OAuth real con vendedor de prueba. No se autorizó ninguna cuenta ni se ejecutó un pago real.

## Base y aislamiento

El directorio sugerido C:/1212/la-taba-pages no era un repositorio Git. Se auditó el repositorio registrado C:/Users/marco/dev/la-taba-pages-preview y sus worktrees. La base autoritativa fue origin/main 869a684 (PR 92, panel vigente). Trabajo aislado: C:/1212/la-taba-mercadopago-oauth, rama feature/taba-mercadopago-oauth. Los cambios existentes y worktrees históricos se conservaron.

## Evidencia ejecutada

| Verificación | Resultado |
| --- | --- |
| npm test | 2383/2383 PASS |
| npm run test:payments | 40/40 PASS, incluye 6 casos de OAuth/criptografía |
| npm run test:webhook | Deno 25/25 + 12/12, Node 12/12 PASS |
| Runtime OAuth Deno | 3/3 PASS: guardas de entorno, refresh/concurrencia, respuesta del proveedor |
| Base local completa | 120 migraciones; ciclo de pagos y 235 aserciones pgTAP PASS; dump/restore PASS |
| OAuth pgTAP incluido | 15 aserciones: grants/RLS, estado, expiración/replay, entorno, refresh y desconexión |
| Playwright OAuth | 2/2 PASS, 320 y 1280 px, proveedor y sesión simulados |
| Checkout habitual Chromium | 10/10 PASS: doble toque, regreso, cambio de medio y errores recuperables |
| npm run check | PASS: sintaxis, configuración, activos, precache, higiene, identidad, ubicación y secretos |
| Typecheck Deno | 8 funciones de producción PASS |
| Lint Deno | 4 archivos nuevos de producción PASS |
| Validación migraciones | PASS |
| Empaquetado estático y preflight | PASS |
| Verificación de archivos servidos | 178/178 archivos precache idénticos al paquete, sin 404 |

Los logs locales están en C:/1212/la-taba-mp-*.log. Se corrigieron tres expectativas antiguas de pruebas y los tiempos de espera del navegador; los resultados de la tabla son las ejecuciones posteriores a esas correcciones. No se presenta el navegador simulado como integración real con Mercado Pago.

La revisión ampliada de navegador terminó inicialmente con 15/17: fallaron un caso fiscal por carga de datos y OAuth de 320 px por agotar los 45 segundos totales. Se ajustó únicamente el presupuesto del caso OAuth a 90 segundos para cubrir sus dos navegaciones con 30 segundos de arranque cada una. La comprobación posterior pasó 4/4: caso fiscal actual, ambos tamaños OAuth y el mismo caso fiscal sirviendo los cuatro módulos originales de main como control. No se modificó lógica fiscal ni se activaron reintentos automáticos. Hubo además corridas diagnósticas interrumpidas por timeouts de carga; no se afirma una ejecución completa 17/17 ni una suite de navegador libre de intermitencia. Evidencia: la-taba-mp-e2e-expanded-final.log y la-taba-mp-e2e-comparison.log.

## Despliegue y verificación remota

- Cloudflare Pages: https://taba2-staging.pages.dev (proyecto taba2-staging, rama staging). Runtime público preservado, apunta únicamente a staging.
- Supabase: ukxqbgswjlibmnjemrzd. Ocho funciones desplegadas: connect, oauth-callback, create-preference, checkout-status, payment-worker, webhook, refund y cancel-payment, con prefijo mercadopago-.
- Migración OAuth 20260905063914 aplicada. Se reconciliaron además 23 migraciones históricas de main que faltaban en staging; quedaron 120 versiones alineadas al repositorio.
- Tablas OAuth: RLS habilitado; anon/authenticated sin SELECT. Advisor no informó advertencias ni errores de seguridad para esos objetos. La ausencia de políticas de cliente es deliberada.
- Smoke HTTP: connect sin sesión = 401; callback sin configuración de aplicación = 503; webhook sin firma = 401. No se acreditaron pagos.
- Se prepararon entorno, proyecto, URL y clave de cifrado segura en staging. No se activó OAuth sin credenciales. La configuración histórica permanece hasta ejecutar el setup explícito.
- Producción wwcpogltfgzgkrlilbcd y el sitio la-taba no se modificaron.

## Pendientes reales

1. Marco configura la aplicación TABA/LUNA y ejecuta el prompt seguro documentado. Faltan MERCADOPAGO_CLIENT_ID, MERCADOPAGO_CLIENT_SECRET y MERCADOPAGO_OAUTH_WEBHOOK_SECRET.
2. Verificar sesión owner/admin en staging: el login de prueba local existente respondió HTTP 400; no se cambiaron contraseñas ni se suplantaron usuarios.
3. Autorizar un vendedor de prueba y verificar callback, reconexión y un pago sandbox completo con webhook. Después validar el entorno de uso de Walter antes de declarar READY.

Staging conserva historial del vendedor de prueba anterior. La implementación rechaza cambiar su collector cuando existe historial, para no consultar pagos históricos con credenciales ajenas. Si la aplicación nueva requiere otro vendedor de prueba, se necesita preparar un comercio de prueba separado o migrar explícitamente la identidad histórica; no se borrarán pedidos para sortear esa protección.

Walter no necesita credenciales técnicas, Developers, Supabase ni terminal. Sus instrucciones están en WALTER_MP_CONNECT.md. La configuración y autorización pendientes impiden afirmar hoy que su conexión real ya está probada.
