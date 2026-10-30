# LA TABA — LISTA PARA PILOTO DE PAGOS REALES

**Estado actualizado 30/10:** [informe de cierre](../mp-closure-20261030/INFORME.md) y [preflight vigente](../mp-closure-20261030/PREFLIGHT.md). Este informe histórico no autoriza activación: producción no está aprovisionada, B no consintió y R-MKT-1/pago manual/devolución API siguen sin certificar. La CI SQL antes pendiente ya se incorporó; no crear otra cuenta B ni pedir su contraseña.

26/10/2026. Sesión de Claude Sonnet 5.5 para Marco. **Nada de esto movió dinero real ni tocó producción**: el proyecto de producción no existe. Lo que se certificó es el software y el procedimiento; la primera transacción productiva **no se ejecutó y no está certificada**.

## Veredicto

**Software de pagos: listo para el piloto.** Los defectos encontrados hoy están corregidos y probados (§ «Defectos»), la versión v170 está desplegada en QA con el libro de migraciones idéntico al repositorio, y existe un candado en la base que hace imposible cobrar al público por accidente: en producción, sin una autorización escrita y vigente, la base rechaza cualquier pago real.
**Lo que falta no es programación**: son autorizaciones y acciones de titulares (§ 10), cada una con su comprobación automática.

## 1. Rama y PR finales

| PR | Rama | Qué es | Estado |
|---|---|---|---|
| [#156](https://github.com/bitflowapp/la-taba-pages-preview/pull/156) → [#157](https://github.com/bitflowapp/la-taba-pages-preview/pull/157) | `feature/taba-commercial-payments-final-20261025` → `audit/codex-payment-validation-20261025` | v168 + auditoría de Codex (v169) | abiertos, sin merge |
| [**#158**](https://github.com/bitflowapp/la-taba-pages-preview/pull/158) | `review/v169-financial-audit-20261026` | **v170-payment-review** (revisión independiente + dos arreglos de certificación) | borrador, apilado sobre #157 |
| [**#159**](https://github.com/bitflowapp/la-taba-pages-preview/pull/159) | `feature/live-pilot-gate-20261026` | **v171**: piloto cerrado, PREFLIGHT / LIVE SMOKE, procedimientos | borrador, apilado sobre #158 |

No se fusionó nada a `main`. Pedir la fusión de la cadena #156 → #157 → #158 → #159 es una de las autorizaciones pendientes (§ 10).

## 2. SHA exacto certificado, CI y pruebas financieras

| | v170 (PR #158) | v171 (PR #159) |
|---|---|---|
| SHA de código | `68e56906e559b340019df7eeab2022ab1bfc52a0` | `c8ddedec14431141a72d9f7d14aa3ca2ca0c38fb` (los commits posteriores son sólo documentación) |
| CI de GitHub | corrida [40392316077](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/40392316077): **4 de 4 jobs ✅** (el job Web se relanzó una vez: la primera vuelta pasó todos los pasos —E2E completo de 72 min incluido— y fue cancelada por el tope de 120 min en el último paso, porque el runner tardó 39 min en lo que suele tardar 9) | corrida [40400371597](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/40400371597): **4 de 4 jobs ✅** (Migrations/pgTAP/restauración + banco de pagos, Web con el E2E completo, Windows, Native PWA) |
| Banco Docker de pagos con emulador y funciones reales | **CI (Linux): 17/17 en prueba y 17/17 en ensayo de producción** ([`evidencia/ci/v170`](evidencia/ci/v170/payments-e2e.json)) | **CI (Linux): 18/18 y 18/18**, con el escenario nuevo `pilot_gate` ([`evidencia/ci/v171`](evidencia/ci/v171/payments-e2e.json)); además local en Windows 18/18 y 18/18 ([`evidencia/banco-docker-local-v171.json`](evidencia/banco-docker-local-v171.json)) |
| Ciclo de vida de la base: OLD → EXPAND → V5 → CONTRACT → pgTAP (960) → restauración aislada | **verde en la CI** y local | verde local (exit 0) |
| PostgreSQL: concurrencia de preferencias y devoluciones, conciliación, permisos | medido en `b80d7f0c` y repetido por la CI en el SHA: 3.256 pruebas de Node, 70 + 262 de Deno, SQL por archivo (21/24; los 3 restantes no son de pagos), 8 sesiones → 1 despachador | **3.321/3.321** de Node; `tests/db` 233/237 (las 4 que no pasan necesitan `pg_dump`); candado: 11/11 + 8 mutaciones (7 muertas, 1 redundante por diseño) |
| Checkout E2E en Chromium y WebKit | job «Web, backend…» de la CI | ídem |
| Secretos | escáner de secretos y de rutas en `npm run check`: verde | verde |
| Identidad y actualización de la PWA | `la-taba-runtime-v170-payment-review`, 221 archivos precacheados, `check-release-identity` verde; «Native PWA update» verde en la CI | sin cambios de cliente |

### Defectos hallados y corregidos hoy (además de los 5 del informe de la revisión)

| # | Defecto | Efecto | Corrección |
|---|---|---|---|
| H-1 | La CI de «Migrations, pgTAP…» fallaba: el verificador del ciclo de vida A1 no conocía la RPC `claim_mercadopago_preference_dispatch` ni exigía que el handler nuevo **falle cerrado sin ella** | CI roja en v169 | el verificador permite la RPC, prueba «falla cerrada, cero POST al proveedor» sobre una base sin el claim y la aplica antes del resto (orden de despliegue: migraciones primero) — `68e56906` |
| H-2 | `scripts/payments-e2e/run.mjs` **salía con 0 sin ejecutar un solo escenario en Windows** (la guarda `file://${argv[1]}` nunca coincide) y `asistente-activacion ensayo` informaba «OK» por el código de salida | un «verde» falso del banco | `pathToFileURL`; cero escenarios = fallo; el ensayo exige informe existente, verde y con escenarios — `68e56906` |
| H-3 | El banco no podía correr en Docker Desktop (las IP de contenedores no se alcanzan; `npx`, procesos y rutas de Windows) | no se podía certificar localmente | puertos sólo en `127.0.0.1` y sin DNS externo (`PUBLISH_PORTS`), `npx.cmd` + `taskkill`, directorio de funciones como URL de archivo — v171 |
| H-4 | Un pago real aprobado se verificaba mal: `is_financing` es «el pago que financia el pedido», no cuotas | la verificación de la compra fallaba sobre datos reales | corregido al correr el verificador contra filas reales del banco — v171 |
| H-5 | El PREFLIGHT bloqueaba por «avisos con firma rechazada» | un entorno con pruebas de firma falsa nunca pasaba | ahora es informativo; bloquea lo que deja dinero sin conciliar — v171 |
| H-6 | `mercadopago_release_unused_seller.local.sql` sembraba un pago de producción que el candado rechaza | ciclo de vida rojo | el comercio histórico «sold» se abre al público antes de sembrar — v171 |

## 3. Estado del despliegue en QA

Proyecto `la-taba-recovery-test` (`ixewllzzuzpqrkxzmfzx`, entorno `test`, dinero ficticio). Respetando el archivo de coordinación (`COORDINACION-la-taba-QA-claude-v170-20261026.json`; el de Codex decía RESERVED desde las 03:11Z pero su estado de cierre era 04:14Z y no había actividad ajena), en el orden pedido:

| Paso | Resultado | Evidencia |
|---|---|---|
| 1. Migraciones | `…26010000`, `…020000`, `…030000`, `…040000` (19:49Z) y `…27010000` del piloto (20:55Z): **179 en el libro = 179 del repositorio, SHA por SHA** | [`qa-v170/`](evidencia/qa-v170/), [`qa-piloto/`](evidencia/qa-piloto/) |
| 2. Funciones | las 9 `mercadopago-*` desde `68e56906`: connect v16, oauth-callback v15, create-checkout-session v13, **create-preference v15**, checkout-status v14, webhook v19, **payment-worker v16**, **refund v16**, cancel-payment v15; hashes `ezbr_sha256` registrados | `verificacion-despliegue.json` |
| 3. Configuración y permisos | `verificar-configuracion --ref=qa`: veredicto TEST; `claim_mercadopago_preference_dispatch` sólo para `service_role`; cron: los 5 jobs que estaban activos, reactivados; el de retención sigue apagado como antes | `schedulers-antes/despues.json` |
| 4. Regresión | 6/6 firmas falsas rechazadas (401); **preferencia real** creada por el handler nuevo en Mercado Pago (×2); doble clic → misma preferencia, **un solo intento**; ambos checkouts vencieron solos, reservas liberadas (`checkout_expired`) y stock repuesto; LT-0185 y LT-0186 intactos (aprobados, un pedido, sin discrepancias, cola vacía) | `qa-actions.jsonl` |
| 5. Conciliación final | 16 intenciones, 10 pedidos del comercio A, 0 del B, 0 fuera de `test` | `qa-actions.jsonl` (`counts`) |
| 6. Cierre de la ventana | cerrada; comercios cerrados | — |

**Pago OTHE `185083342105` (ARS 350, que estaba `in_process`)**: resolvió el proveedor, no nosotros — `rejected / cc_rejected_other_reason` a las 12:07Z, ~9 h después; sin pedido, checkout cancelado, reserva ya liberada, `watch_state: settled`. Nunca se lo trató como rechazado antes de tiempo.

**No se pudo: un pago aprobado nuevo en QA.** Checkout Pro responde «Hubo un error accediendo a esta página» a un navegador automatizado ([`log`](evidencia/qa-v170/checkout-pro-bloquea-navegador-automatizado.log)); es una barrera anti-bot y no se esquiva. Lo paga una persona (§ 10, E7). La extensión de Chrome tampoco estaba conectada.

**Ensayo del piloto contra la base alojada (QA):** `preflight` sin bloqueos → `autorizar` (importe y huella tipeados) → cantidad distinta y producto distinto: **409 rechazados** → la compra exacta: **aceptada una vez con preferencia real de Mercado Pago** → la segunda: 409 → nueva autorización con un checkout en vuelo: **rechazada** → importe o huella mal tipeados: rechazados → `verificar` marca la compra sin pagar como falla → el checkout sin pagar venció solo, reserva liberada, stock 17 → autorizar de nuevo y **abortar**: la compra exacta pasó a 409. Después el comercio A de QA volvió a su alcance normal y la ventana se cerró (`COORDINACION-la-taba-QA-claude-v170-20261026.json`: CLOSED).

## 4. Configuración productiva preparada

[`PRODUCCION-INFRAESTRUCTURA.md`](PRODUCCION-INFRAESTRUCTURA.md): proyecto separado de QA, dominio, funciones, migraciones y RLS, secretos aislados, respaldos con restauración medida (15–40 s), monitorización y jobs, reversión, **costo mínimo USD 25/mes** (Pro con el crédito de cómputo que cubre una Micro; PITR +USD 100 no recomendado). **No se creó ni contrató nada.**

## 5. Integradora y vendedor

[`PRODUCCION-INFRAESTRUCTURA.md`](PRODUCCION-INFRAESTRUCTURA.md) §3: aplicación **La Taba Delivery `7677852968049976`** (dueña = cuenta real), la integradora **nunca** es vendedora (callback, verificación y cobro lo rechazan; el banco lo prueba en el ensayo de producción), y la tabla de qué combinación de cuentas es una compra de prueba, una de cuenta productiva autorizada y una de Walter. Reglas oficiales y **lo que Mercado Pago no documenta**: [`PROVEEDOR-REGLAS.md`](PROVEEDOR-REGLAS.md) (por ejemplo, si el comprador puede ser la dueña de la aplicación: sin confirmar).

## 6. Procedimiento de la primera compra con dinero real

[`PROCEDIMIENTO-COMPRA-REAL.md`](PROCEDIMIENTO-COMPRA-REAL.md). Antes de mover un peso, el titular responde por escrito las siete preguntas: **quién recibe** (titular y cuenta), **quién paga** (cuenta distinta), **qué se compra**, **cuánto** (importe exacto en ARS), **quién asume las comisiones**, **cómo se devuelve** y **cuándo se aborta**. Ingeniería no elige ninguna. Herramienta: `node scripts/mercadopago/piloto-pago-real.mjs plantilla | validar | preflight | autorizar | abortar | verificar | verificar-devolucion` (`PREFLIGHT` no mueve dinero y se repite; `LIVE SMOKE` sólo existe como una autorización firmada, con el importe y la huella tipeados a mano).

Comportamientos que se comprobaron antes y no se repiten con dinero real: **cierre del navegador antes del retorno** (QA real, LT-0186: el pedido se creó 94 ms después del cierre), **webhook duplicado** (replay firmado sobre un pago real de QA: dos 201, un recibo, un pedido; en el banco, el mismo aviso ×3 y ×5 a la vez), **pérdida de conexión** (QA real: primer pedido de estado abortado, el segundo llega, cero checkouts nuevos) y **aviso que nunca llega** (el barrido del proveedor arma el pedido) — informe de Codex [`codex-payment-20261026/INFORME.md`](../codex-payment-20261026/INFORME.md) y escenarios `duplicates` y `webhook_lost_truth_sweep` del banco. Nunca se confirma una compra por los parámetros del navegador.

## 7. Devolución y conciliación

[`PROCEDIMIENTO-DEVOLUCION.md`](PROCEDIMIENTO-DEVOLUCION.md): autorización de la operación y el importe, comprobaciones previas, camino A (API, una sola vez, clave de idempotencia) y camino B (desde la cuenta del vendedor, conciliado como `external`), qué hacer ante 401 / ambiguo, y `verificar-devolucion`. **La API de reembolso sigue sin certificarse con dinero real** (401 código 7 en el entorno de prueba); si falla en producción no se declara realizada y rige el camino B. Ningún asiento dice «devuelto» sin identificador del proveedor, importe exacto y estado aprobado.

## 8. Reversión

Siete niveles (`asistente-activacion.mjs reversion`), más una puerta fina nueva: `piloto-pago-real.mjs abortar` y `cerrar-piloto`. Walter tiene **«Pausar cobros online»** en su Panel ([`ENTREGA-WALTER.md`](ENTREGA-WALTER.md)). Reversa SQL del candado: `docs/migrations/rollback/20261027010000_live_pilot_gate.rollback.sql` (se niega a borrar autorizaciones consumidas).

## 9. Clasificación de resultados

### Implementado y verificado
- Candado del piloto cerrado en la base: banco (18/18 ×2), SQL (11/11, 7/8 mutaciones), QA alojado, ciclo de vida completo.
- CLI de PREFLIGHT / autorización / verificación / verificación de devolución: 66 pruebas unitarias + banco + QA.
- Correcciones de la revisión v170 (reembolso ambiguo con salida por evidencia del proveedor, conciliación con páginas cortas, dos pestañas, adaptador de pruebas) y del verificador de CI.
- Despliegue de v170 en QA, regresión de no-duplicación, vencimiento y firmas falsas; resolución del pago OTHE por el proveedor.
- Banco Docker certificable en Windows; ya no puede «pasar» sin ejecutar escenarios.

### Preparado, pendiente de activación
- Proyecto de producción, secretos, sitio, binding y despliegue (`asistente-activacion.mjs estado`: P1–P11).
- Primera compra y primera devolución reales; entrega a Walter.
- R-MKT-1 con segundo vendedor: [`R-MKT-1-PROCEDIMIENTO.md`](../payments-final-20261025/R-MKT-1-PROCEDIMIENTO.md); `qa-mp-marketplace.mjs preflight` confirma que sólo falta el vendedor B.

### Bloqueado por una autorización concreta
- Todo lo de producción (E1–E6 de § 10). Pago aprobado de QA (E7a) y R-MKT-1 (E7b). Fusión de la cadena de PR (E8).

### Defecto técnico todavía abierto (conocido, no bloquea el piloto)
1. Si el despachador de preferencias muere justo después del *claim*, el comprador espera hasta que vence el checkout (15 min): no se reenvía a ciegas.
2. Los visitantes sin sesión no ven combos (`get_mercadopago_checkout_availability` es sólo para autenticados; anterior a esta línea).
3. Un grupo de más de 10.000 pagos con el mismo instante no cierra la ventana del libro (a propósito).
4. La verificación de permisos no puede probar un permiso de reembolso positivo (Mercado Pago sólo publica `read`, `write`, `offline_access`).
5. Las pruebas SQL de `tests/db/` no corren en ninguna CI (hay que correrlas con el procedimiento de la sesión); recomendación: un job con el PostgreSQL de `ubuntu-latest`.
6. Mientras el público ve la tienda, el botón de Mercado Pago aparece aunque el comercio esté en piloto cerrado: pagar da «No podemos preparar este pago» (seguro, no informativo). Se evita publicando el sitio en mantenimiento hasta abrir.
7. Las alertas críticas sólo se ven con el Panel abierto (sin correo ni push) hasta tener SMTP.

## 10. Autorizaciones externas que todavía hacen falta (pasos finales concretos)

| # | Quién | Acción exacta | Desbloquea |
|---|---|---|---|
| E1 | Luna Systems (Marco) | aprobar el gasto de **USD ~25/mes** y crear `la-taba-production` (Pro, `sa-east-1`, organización de pago) — D1 | todo lo productivo |
| E2 | dueño de La Taba Delivery | en Mercado Pago Developers: activar credenciales productivas (rubro, sitio, términos), **renovar el Client Secret conservando el Client ID**, registrar Redirect URL y webhook del proyecto nuevo (Pagos + Vinculación de aplicaciones) y revelar la clave del webhook | vincular a Walter |
| E3 | Marco | cargar secretos por entrada oculta **sin** la llave final; D4: custodia separada de la clave de cifrado y copia fuera de la PC; SMTP (opcional para el piloto) | despliegue seguro |
| E4 | Marco | publicar el sitio nuevo (o mantenimiento) en `la-taba.pages.dev` | cerrar A9 |
| E5 | Walter | decidir y firmar las siete respuestas; vincular **su** cuenta por OAuth; confirmar la recepción; ejecutar la devolución | primera compra |
| E6 | Marco / Walter | designar la persona y la cuenta compradora (distinta de la vendedora y, hasta confirmarlo, de la dueña de la aplicación) | primera compra |
| E7a | una persona | pagar con la tarjeta APRO el checkout de QA que arma `qa-mp-e2e.mjs checkout` (instrucciones en el mensaje de entrega) | cierra la regresión de QA con un pago aprobado nuevo |
| E7b | Marco | autorizar el plugin de Mercado Pago (enlace en el mensaje de entrega) para crear el segundo vendedor de prueba | R-MKT-1 |
| E8 | Marco | revisar y autorizar la fusión de #156 → #157 → #158 → #159 | llevar todo a `main` |

**Criterio final:** con E1–E6 hechos, el titular autoriza una compra sabiendo exactamente cuánto dinero se mueve, quién lo recibe, cómo se confirma (12 comprobaciones + 2 manuales), cómo se devuelve (API o cuenta del vendedor, ambas verificadas) y cómo se revierte el sistema (siete niveles, el botón de Walter y el aborto de la autorización).
