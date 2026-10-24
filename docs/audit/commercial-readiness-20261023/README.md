# La Taba a un paso del lanzamiento — 24/10/2026

Rama `release/commercial-readiness-20261023`, apilada sobre PR #149 (que a su vez se apila sobre #148). Sin merge, sin tocar producción existente, sin recursos pagos, sin dinero real. Todo lo de QA (`ixewllzzuzpqrkxzmfzx`) fue con dinero ficticio y con respaldo cifrado previo.

Lectura sugerida:

1. [`MATRIZ-GO-NO-GO.md`](MATRIZ-GO-NO-GO.md) — veredicto, bloqueos y evidencia.
2. [`ENTORNOS.md`](ENTORNOS.md) — desarrollo/QA/producción, los cinco proyectos borrados y cómo se activa producción.
3. [`LANZAMIENTO.md`](LANZAMIENTO.md) — infraestructura y secretos, pipeline, migraciones y reversión, checklist de seguridad, primer cobro y primer reembolso reales, monitoreo, rollback.
4. [`ALERTAS-PREEXISTENTES.md`](ALERTAS-PREEXISTENTES.md) — las cinco alertas de QA: diagnóstico, corrección y cierre.
5. [`RESPALDOS-Y-RECUPERACION.md`](RESPALDOS-Y-RECUPERACION.md) — integridad, restauración medida, controles de acceso, plan y runbook de desastre.
6. [`CALIDAD-COMERCIAL.md`](CALIDAD-COMERCIAL.md) — la compra en tres teléfonos y el preview real.
7. [`MARKETPLACE-SEGUNDO-VENDEDOR.md`](MARKETPLACE-SEGUNDO-VENDEDOR.md) y [`REEMBOLSOS-API.md`](REEMBOLSOS-API.md).
8. [`MANUAL-OPERACION-WALTER.md`](MANUAL-OPERACION-WALTER.md) — para el local.

## A. Implementado y verificado

- **Alertas que el comercio puede usar** (migraciones `20261024010000` y `20261024020000`, con reversa probada byte a byte): una compra abandonada en Mercado Pago ya no es una emergencia mientras el proveedor contesta (era CRÍTICA ~26 h); un pedido con el pago devuelto pide cancelarse (antes pedía «aceptalo», que la base rechaza) y deja de contar como nuevo o demorado. Aplicadas en QA; las cinco alertas preexistentes quedaron diagnosticadas y cerradas: el ciclo reembolso → alerta → cancelación con motivo → stock repuesto una vez → alerta resuelta se hizo en el teléfono sobre el preview real.
- **Panel**: «pago devuelto» por importes como la base (se trababa la tarjeta tras devolver un pago en revisión); textos propios para tres alertas de dinero que caían en el genérico.
- **Registro único de entornos** (`deploy/environments.json`) validado en cada lectura; **más de treinta herramientas, dos flujos y el vigía** dejaron de apuntar a proyectos borrados: sin proyecto de producción, todas fallan cerradas con un mensaje claro y sin leer credenciales; el despliegue corta antes de construir; el vigía de GitHub deja de fallar y mandar correos cada corrida.
- **Preview de QA** con la v161: publicación verificada archivo por archivo, Panel de pagos 19/19, centro de operación en 390 px sin errores.
- **Respaldos**: integridad de todas las instantáneas, restauración **sin Supabase** medida (15–40 s la capa de datos), dos respaldos cifrados nuevos antes de cada migración.
- **App Rider contra QA**: su modo staging apuntaba al staging borrado, así que el repartidor no se podía probar antes del lanzamiento. Ahora apunta al QA del registro (gradle, chequeo en tiempo de ejecución y builders), con una prueba que lo ata al registro. El flujo del protocolo V5 del proyecto borrado se niega en su primer paso y manda a `scripts/production/deploy.mjs`.
- **CI de GitHub sobre el código de #148/#149**: sus commits llevaban `[skip ci]`, así que el job de base de datos nunca había corrido sobre ese código. En esta rama mostró cuatro fallas preexistentes, corregidas acá, sin tocar producto:
  1. la fase EXPAND se medía con la versión final de `production_least_privilege_test.sql` (ahora usa la de esa fase, la misma que corre `main`);
  2. el arnés independiente de pagos no conocía la verificación del integrador que agregó #149 (secreto de la aplicación, `/oauth/token`, tokens `APP_USR-`) y la tomaba por falla del pago;
  3. el total de pgTAP canónico quedó en 943 aunque #148 llevó esa prueba de 44 a 47 aserciones;
  4. las migraciones posteriores se aplicaban sobre la base que ya había corrido el CONTRACT del protocolo V5, el estado de la producción borrada, y `20261022100000` (#148) parchea una función legada que ese CONTRACT convierte en un stub. Ahora el esquema final se construye en un clúster propio, como cualquier entorno real (QA, la producción nueva): todas las migraciones en orden, sin CONTRACT. El protocolo V5 sigue verificándose completo en su propio clúster.

  «Native PWA update» falla de forma intermitente en WebKit (CacheStorage vacío tras actualizar, la carrera que el propio guion documenta). Con el mismo código pasó en `dd744625` y falló en `main` (`ff55f4cf`). El resultado de la corrida final está en el PR #150.
- Suites: `npm test` completo, `tests/db/commercial-alerts.test.mjs` 10/10 (los casos nuevos fallan sin las migraciones), Panel 47/47, chequeos del repositorio y escaneo de secretos en verde. Se corrigió además una falla de higiene que traía #149 (ruta local en un documento de un repositorio público).

## B. Técnicamente preparado para activar

- `scripts/production/bind-production.mjs`: el PR de binding en un comando cuando exista el proyecto (registro, binding de La Taba Delivery, bloqueos de QA y piloto, identidad de caché, vigía, app Rider), con verificación remota de sólo lectura.
- `scripts/production/deploy.mjs` (`status`, `bootstrap`, `rehearse`, `migrations`, `functions`, `schedulers`, `gates`) y `scripts/production/backup.mjs`: el mecanismo probado en QA detrás de una guardia de producción (registro, organización paga, región, salud, marca de la base, `--confirm <ref>`).
- `ops-pulse.mjs --target production`, guiones de verificación, auditoría, Auth y operación de Mercado Pago apuntando al registro.
- Página de mantenimiento para `la-taba.pages.dev` (`deploy/maintenance/`), sin publicar.
- Escenario del segundo vendedor: comercio QA B habilitado con un producto sintético; sin bloqueos técnicos.

## C. Acciones humanas imprescindibles

1. **Crear el proyecto de producción** (plan de pago, Luna Systems) — D1.
2. **Sesión del dueño de La Taba Delivery**: renovar el Client Secret expuesto el 6/10, URLs de OAuth y webhook del proyecto nuevo.
3. **Walter**: precios, stock, fotos con derechos, horarios, envío; conectar **su** Mercado Pago; aprobar el cobro y el reembolso de control; factura electrónica con su contador; RPO/RTO.
4. **Marco**: destino de la copia externa de respaldos y custodio separado de la clave (D4); SMTP; publicar la página de mantenimiento o el sitio nuevo en `la-taba.pages.dev`; retirar `taba2-staging.pages.dev`.
5. **Una cuenta de prueba tipo Vendedor** (G1) para demostrar el marketplace antes del cobro real — opcional si se acepta demostrarlo en el cobro de control.
6. Revisar y mergear #148 → #149 → este PR.

## D. Lo que todavía impide cobrar de manera segura

- No hay proyecto de producción (y por lo tanto ni base, ni funciones, ni secretos, ni respaldos de producción).
- La aplicación de producción de Mercado Pago no está verificada y su Client Secret debe renovarse.
- Nunca se movió dinero real por esta arquitectura: faltan el cobro y el reembolso de control, y el reembolso por API no se pudo certificar en prueba.
- El ruteo del webhook con vendedor ≠ dueño de la aplicación no está demostrado.
- La recuperación ante la pérdida del proyecto depende de una clave guardada en una sola PC y no se ensayó sobre un proyecto nuevo.
- El sitio público muestra una tienda contra una base borrada.

**No hay GO comercial**: falta evidencia crítica (proyecto, cobro real, reembolso real, marketplace real).
