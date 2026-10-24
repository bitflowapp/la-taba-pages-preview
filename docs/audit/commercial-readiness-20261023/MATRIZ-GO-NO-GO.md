# Matriz GO / NO-GO — La Taba, 24/10/2026

Veredicto de ingeniería: **NO-GO para cobrar a clientes reales hoy.** El motivo no es el flujo de cobro (probado de punta a punta en QA con dinero ficticio del proveedor) sino que **no existe el proyecto de producción** y faltan autorizaciones y pruebas reales que ninguna herramienta puede reemplazar. Todo lo técnico que dependía sólo de ingeniería quedó hecho o preparado para activar con un comando.

Actualiza la [matriz del 23/10](../mercadopago-final-20261023/lanzamiento/MATRIZ-GO-NO-GO.md). **BLOQUEO** = sin esto no se cobra. **LÍMITE QA** = el entorno de pruebas no puede demostrarlo. **NO CRÍTICO** = no impide cobrar.

## A. Bloqueos

| ID | Qué | Estado al 24/10 | Cierra | Titular |
|---|---|---|---|---|
| A1 | No existe proyecto de producción | **abierto** — verificado en vivo (`ENTORNOS.md` §1) | crear el proyecto (plan de pago) | Luna Systems (D1) |
| A2 | Código y pipeline atados a proyectos borrados | **cerrado en código**: registro único; toda herramienta de producción falla cerrada sin proyecto; el despliegue corta antes de construir; el vigía en espera; la app Rider prueba contra QA; el flujo V5 del proyecto borrado se niega; binding en un comando (`bind-production.mjs`, probado) | correr el binding cuando exista A1 (PR + CI) | ingeniería |
| A3 | Aplicación La Taba Delivery sin verificar y Client Secret expuesto el 6/10 | **abierto** | sesión del dueño: renovar el secreto, URLs y webhook del proyecto nuevo, lectura del dueño (`test_user` ausente) | dueño de la app |
| A4 | Marketplace con vendedor ≠ dueño de la app sin demostrar (R-MKT-1) | **preparado**: G2 hecho en QA, sin bloqueos técnicos (`MARKETPLACE-SEGUNDO-VENDEDOR.md`) | G1 (una cuenta de prueba) **o** el cobro de control A7 vigilado | titular de la cuenta de prueba / Walter |
| A5 | Recuperación ante desastres | **parcial**: respaldos cifrados íntegros, restauración local medida (15–40 s capa de datos), herramienta de respaldo de producción lista; faltan custodia separada de la clave, copia fuera de la PC, RPO/RTO aceptados y ensayo sobre un proyecto nuevo | D3, D4 y un ensayo autorizado | Marco / Walter |
| A6 | Datos y autorizaciones del comercio (catálogo y precios reales, fotos con derechos, horarios, envío, conexión de **su** Mercado Pago) | **abierto** | `catalog/opening/OWNER-INPUT.md`, `MANUAL-OPERACION-WALTER.md` §7 | Walter |
| A7 | Primer cobro y primer reembolso reales de control | **abierto**; procedimiento listo (`LANZAMIENTO.md` §5–6) | ejecutarlos con vigilancia | Walter + operador |
| A8 | Migraciones del núcleo financiero en producción (`20261023210000` y las dos de hoy) | **listas**: aplicadas y verificadas en QA; el primer despliegue (`deploy.mjs bootstrap`) aplica las 173 | A1 | ingeniería |
| A9 | `la-taba.pages.dev` sirve una tienda contra una base borrada | **abierto** (producción existente: no se tocó) | publicar el sitio nuevo tras A1, o una página de mantenimiento mientras tanto | Marco |

## B. Límites del entorno de pruebas (riesgo medido, no bloquean)

| ID | Límite | Cómo se cubre |
|---|---|---|
| B1 | Reembolso por API: 401 cause 7 con credenciales de prueba, sin alternativa oficial no probada (`REEMBOLSOS-API.md`) | devolución desde la cuenta del vendedor (probada y conciliada); la API se certifica en A7 |
| B2 | La app de prueba es autoautorizada (`marketplace: NONE`) | A4 |
| B3 | Pagos entre usuarios de prueba informan `live_mode=true` | las guardas usan el entorno ligado a `test_user` |
| B4 | QA en plan Free (pausa por inactividad, sin copias gestionadas) | producción en plan de pago |
| B5 | Pruebas de base locales con cron/net/Vault simulados | verificación alojada en QA (cron, Vault, HMAC reales) |
| B6 | Sin calificación oficial de «calidad de integración» | se pide tras el primer pago real |
| B7 | Sesión de Developers de la cuenta dueña de QA (SMS) | sólo el titular |

## C. No críticos

| ID | Tema | Estado |
|---|---|---|
| C1 | Devolver el dinero no cerraba el pedido | **resuelto como defecto de producto**: alerta «pedido con el pago devuelto», Panel por importes, métricas coherentes, procedimiento probado en QA (`ALERTAS-PREEXISTENTES.md`). Mejora futura: ofrecer «cancelar pedido» al confirmar la devolución |
| C2 | Facturación electrónica apagada | decisión de Walter y su contador |
| C3 | Fotos (Storage) fuera del `pg_dump` | cargarlas desde las fuentes con derechos; exportación aparte |
| C4 | SMTP propio para Auth y avisos | alta del proveedor |
| C5 | Bases de ensayo: `taba_restore_20261022_ad3d29a2` y `taba_restore_20261023_e9ba39c2` en QA; en el clúster local, `taba_local_cr0`, `cr1`, `cr3`, `cr4`, `cr5`, `cr6`, `cr7_mercadopag`, `cr7_production` (clones de prueba) y `taba_local_restore_20261024_960e9754` (intento fallido, sólo sustitutos), `…_d14a301e`, `…_b5f06541` (ensayos); `taba_local_base` y `taba_local_work` son las plantillas del arnés; tenant sintético `drill-fb-qa` | se conservan; borrarlas es decisión de Marco con recibo |
| C6 | Cuentas de prueba no borrables (límite 15) | una más con G1 |
| C7 | Limpieza de TestApp / TABA2 Staging y documentación histórica | limpieza |
| C8 | Advertencias del asesor de Supabase (0 errores) | revisadas como de diseño; repetir en producción (`LANZAMIENTO.md` §4) |
| C9 | `mercadopago_operator_switch.local.sql` usa un `seller_id` fijo que hoy está conectado en QA | darle un id propio |
| C10 | Pruebas de base no aisladas en una base poblada | sólo sobre bases descartables |
| C11 | Alertas críticas sólo visibles con el Panel abierto (sin correo ni push) | timbre del Panel; correo cuando exista C4 |
| C12 | `taba2-staging.pages.dev` (rama de producción de un proyecto de staging) sirve una tienda contra una base borrada | retirarla o reemplazarla por un aviso (autorización) |
| C13 | Vigía de Cloudflare preparado y sin desplegar | decisión de Marco (el de GitHub cubre lo mismo) |
| C14 | Enlace del nombre del producto de 20–39 px de alto en el catálogo | ajuste visual menor |
| C15 | Deuda de pruebas SQL **preexistente** (igual sin las migraciones de hoy): el fixture de `supabase/tests/operational_resilience_drills.local.sql` lo rechaza el control de imágenes de catálogo; `order_intake_dispatch_p0.local.sql` espera el cierre de alertas anterior a F08. Ninguna está en la lista canónica de CI | actualizar los fixtures |
| C16 | «Native PWA update» de CI falla de forma intermitente en WebKit: tras activar la actualización el CacheStorage queda vacío y la recarga sin red va al servidor (carrera de WebKit bajo automatización que el guion ya documenta) | **preexistente**: falló en `main` (`ff55f4cf`) y pasó en `dd744625` con el mismo código PWA; se vuelve a correr el job |
| C17 | Credencial `STAGING SUPABASE PUBLISHABLE KEY` para compilar el Rider de QA: no existe en esta PC | guardarla (clave publicable de QA, ref de QA como usuario) o pasar `RIDER_STAGING_PUBLIC_KEY` a Gradle |

## D. Evidencia de esta etapa

| Qué | Dónde |
|---|---|
| Entornos, refs borrados y activación | `ENTORNOS.md`; `tests/environments-registry.test.mjs`, `production-bind.test.mjs`, `production-deploy.test.mjs` |
| Cinco alertas preexistentes: diagnóstico, corrección, QA y teléfono | `ALERTAS-PREEXISTENTES.md`; `despliegue-qa/` |
| Respaldos y recuperación | `RESPALDOS-Y-RECUPERACION.md`; `despliegue-qa/ensayo-restauracion-local.json` |
| Calidad comercial en el teléfono y preview real | `CALIDAD-COMERCIAL.md`; `calidad-movil/` |
| Procedimientos de lanzamiento (1–8) y manual (9) | `LANZAMIENTO.md`, `MANUAL-OPERACION-WALTER.md` |
| Suites | `npm test` completo, `tests/db/commercial-alerts.test.mjs` (10/10 con las migraciones; falla sin ellas), panel 47/47, chequeos del repositorio en verde; CI de GitHub sobre el SHA final del PR (resultado en el PR #150). La CI de esta rama es la primera que corre el job de base de datos sobre el código de #148/#149: sus seis fallas preexistentes se corrigieron acá y el job pasa (`README.md` §A) |

## E. Condiciones para pasar a GO

**GO técnico** cuando A1, A2 (binding corrido), A3, A5 y A9 estén cerrados y las pruebas sin dinero de `LANZAMIENTO.md` §4 pasen en el proyecto de producción. **GO comercial** cuando además Walter entregue A6, el cobro y la devolución de control (A7) salgan limpios y A4 quede demostrado (por G1 o por el propio A7). Apertura gradual 5 → 15 → 30 clientes, con apagado inmediato por comercio.
