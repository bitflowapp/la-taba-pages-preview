# La Taba — handoff de la mañana (2026-09-28)

## Actualización de cierre (2026-09-28, noche)

**LA_TABA_BASE_READY: YES. La base técnica está terminada; la tienda sigue cerrada (`STORE_LIVE: NO`, `PRODUCTS_PUBLIC: 0`).**

Lo que falta son sólo datos y decisiones del comercio, todos juntos en [`catalog/opening/OWNER-INPUT.md`](../catalog/opening/OWNER-INPUT.md). El paso a paso sin terminal está en [`docs/STORE-OPENING-RUNBOOK.md`](STORE-OPENING-RUNBOOK.md), empezando por «El día de la apertura, en siete pasos».

Qué cambió desde esta mañana:

- **Preparar apertura** tiene una sola fuente, `get_store_opening_readiness`. La leen:
  - el Panel (Apertura);
  - `npm run opening:check`, que responde `TECHNICAL_READY: YES`, `COMMERCIAL_READY: NO`, `CAN_OPEN: NO`;
  - `npm run opening:dry-run`, que no escribe nada.
- **Seis defectos reales encontrados en vivo y corregidos**, cada uno con su prueba:
  1. La primera publicación de los 46 borradores fallaba.
  2. Una cuenta que aceptó una invitación no se podía borrar.
  3. El alcohol se podía encender con la edad vacía.
  4. El primer deploy después de publicar habría fallado.
  5. Las herramientas del dueño lo sacaban del Panel y del teléfono.
  6. Un cliente nuevo no veía Mercado Pago hasta salir y volver al carrito.
- **Línea fiscal única** (PR #122): el core `taba-fiscal`, los pedidos online facturados como pedidos y la recuperación ante desastre.
  - Está aplicada en CP con reversión probada, y **apagada**: `ARCA_PRODUCTION: NO`.
  - La función con la que el Panel muestra, descarga e imprime el PDF de un comprobante también quedó desplegada (2026-09-29). Las 13 funciones de CP son iguales al repo, archivo por archivo.
  - Para homologar faltan CUIT, certificado y clave, punto de venta, delegación y la política contable.
- **Traspaso Walter dueño / Marco encargado técnico**: está en el runbook y probado contra la base, incluido que el comercio nunca quede sin dueño.
- **Deploys:** 
  - A = `b548e91` (`0753f346`).
  - B = `03eaa8d` (`9042dc83`), con simulacro B→A→B.
  - A′ = `e2978e5` (`ac985354`), con la línea fiscal y el worker v130.
  - B′ = `71a73a9` (`ba18d3c5`), con simulacro B′→A′→B′: PASS.

  En los cuatro, el smoke corre en modo `live`. `main` = `release`.

Evidencia: `docs/CONTROLLED-PRODUCTION-STATUS.md`, secciones «2026-09-28 (noche)» y «2026-09-28 (tarde)».

---


Noche del 27 al 28 de septiembre sobre CONTROLLED_PRODUCTION (CP): proyecto `tkanbadcglszlcyfjvpv`, web `la-taba-commercial-pilot.pages.dev`.

**Veredicto: la parte técnica está lista para un canary humano con pago manual. La tienda real no está abierta y hoy no puede abrir al público.**

Faltan datos que sólo carga el comercio:

- fotos propias;
- precios;
- stock;
- horarios;
- modo de entrega.

Además, la base de CP no deja publicar un producto sin foto aprobada. Hoy hay **0 productos vendibles**.

Para ver qué falta en cualquier momento:

```
node scripts/controlled-production/opening-readiness.mjs
```

## Qué quedó listo

- **Tienda, checkout y pago manual.**
  - Compra completa en CP (negocio QA): cliente → pago manual → Panel → rider → GPS → código → entregado, 2/2 en Pixel 7 e iPhone 13.
  - El checkout ya no pierde el nombre del cliente nuevo (QA-401, ver más abajo).
- **Pedidos.** Ciclo de vida con idempotencia, retiro en el local pagado en efectivo, stock sin sobreventa, cancelación que devuelve stock una sola vez, y abrir/pausar/cerrar con «PAUSAR TODO». Todo certificado en vivo.
- **Panel del dueño.**
  - Pedidos, catálogo, stock, caja, pagos, cierre, configuración y fiscal, sin errores en Chromium ni WebKit.
  - Imágenes: carga → vista previa → aprobación → publicación en storage.
  - Crédito CC BY-SA en la ficha.
- **Rider.**
  - APK v4 firmada, sin secretos.
  - GPS real, con recepción con pantalla apagada y recuperación de red medidas esta noche.
- **Impresión.** LocalAgent 65/65; su CI instala el MSI, corre el servicio e imprime ESC/POS por el spooler.
- **Operación.**
  - Pulso operativo HEALTHY.
  - Backup verificado y restaurado en un entorno aislado.
  - RLS 58/58; storage auditado.
  - Registro de migraciones de CP idéntico al release.
- **Mercado Pago.** Configurado del lado de la plataforma: 9 funciones, webhook, worker cada 30 s y firma. Falta el vendedor.
- **Herramientas nuevas para la apertura.**
  - `scripts/controlled-production/opening-readiness.mjs`: lista qué falta y dónde se carga. Con `--verify-ordering` registra la verificación de plataforma, y sólo lo hace cuando todo lo demás está en PASS.
  - `catalog/opening/planilla-apertura-cp.csv`: los 46 productos, con precio y stock vacíos, listos para completar.
  - `catalog/opening/README.md`: cómo se completa y se aplica la planilla.
  - `scripts/controlled-production/order-lifecycle-cert.mjs`: certificación en vivo del ciclo de vida de los pedidos.

## Qué se desplegó

- **Web de CP: `98866ab`** (PR #120), runtime `la-taba-runtime-v128-checkout-saved-profile`.
  - Lo publicó el workflow oficial (run 36399354557) con `CP_DEPLOY_SHA` armado, después del CI exacto del SHA: web + E2E (run 36399354417) y Rider Android (run 36399354472), todo en verde.
  - Deployment `5f5b0b61`; el alias sirve `98866ab`.
  - Smoke público PASS en Chromium, Chrome Android y WebKit.
- **Simulacro de rollback B→A→B** (`rollback-cp-20260928.json`):
  - A = `aefa942`, la versión que estaba en vivo.
  - Volver a A y regresar a B dio PASS, con smoke en cada paso, backend sin cambios y config verificada.
- **Service worker** (`sw-live-cp-20260928.json`):
  - Perfil sembrado en v127 antes del deploy: sirve `98866ab` al instante, conserva la sesión y pasa recarga, chequeo de actualización y recarga forzada.
  - El worker v128 espera el «Actualizar ahora», como está diseñado.
  - Un visitante nuevo arranca directo en v128.
- **Capacidad en CI sobre `98866ab`**: PASS (run 36399354529).
- **Después del deploy**:
  - Pulso operativo HEALTHY.
  - Tienda anónima con 35/35 rutas limpias en 5 combinaciones de motor y tamaño; sólo el 401 esperado de Mercado Pago.
- **Backend**:
  - Esta noche no se aplicaron migraciones; sólo se cambió la etiqueta de una fila del registro, con el SQL idéntico.
  - `catalog-image-manager` v2 (fix de la primera aprobación, desplegado con #119). Las 9 funciones de Mercado Pago no se tocaron (v5).
- **Ramas**:
  - `release/taba-controlled-production` suma, sobre `98866ab`, las herramientas de apertura y esta documentación. No cambia ningún archivo de la web, así que lo desplegado sigue siendo `98866ab`.
  - `main` se lleva a la misma cabeza cuando su CI termina en verde.

## Qué tests pasaron

| Área | Resultado | Evidencia (`docs/evidence/controlled-production/`) |
| --- | --- | --- |
| Suite unitaria | 2696/2696 local sobre `98866ab`, más 7/7 del chequeo de apertura; `npm run check` PASS (precache, higiene, identidad v128, escaneo de secretos). CI completo en verde (ver «Qué se desplegó») | — |
| QA-401 | Reproducido antes del fix (6 E2E y 2 unitarios fallando). Después: 6/6 unitarios, 8/8 E2E en Chromium y 8/8 en WebKit iPhone 13 | PR #120 |
| Compra completa en CP (UI real, negocio QA) | 2/2 con el código v128 | — |
| Ciclo de vida, idempotencia y retiro con efectivo | 31/31. Entrega: estados inválidos, revisión vieja PT409, cliente sin permiso, aristas del Rider, retroceso, estado final, reintentos de alta, transición y cancelación, stock devuelto una sola vez. Retiro (la forma del canary): no se despacha, el efectivo se registra una sola vez aunque se toque dos veces, y el negocio entrega en mostrador | `order-lifecycle-cp-20260928.json` |
| Abrir, pausar, cerrar, PAUSAR TODO y ventana QA | 36 controles | `verify-cp-controls-20260928.json` |
| Capacidad en CI sobre `98866ab` (negocio QA) | 30 usuarios, 3 riders, 10 carritos, 7 pedidos de 8 checkouts simultáneos (1 perdedor de carrera, esperado), 0 errores, p95 ≈ 543 ms. Doble clic y reintento → mismo pedido; dos pestañas → PT409; oferta disputada → 1 ganador; 6/6 entregas; realtime 30/30; 0 filas visibles para anónimos | `capacity-cp-ci-20260928.json` |
| Carrera por la última unidad / bordes de stock | PASS / PASS | `last-unit-race-cp-20260928.json`, `stock-edges-cp-20260928.json` |
| RLS / auditoría de base | 58/58 / limpia | `rls-cp-20260928.json`, `db-audit-cp-20260928.json` |
| Impresión | 65/65 | `verify-cp-printing-20260928.json` |
| Storage | PASS | `storage-inventory-cp-20260928.json` |
| Backup y restore | PASS: 144 migraciones, 108 tablas y 8051 filas; esquema y RLS iguales; nunca sobre CP | `restore-drill-cp-20260928.json` |
| Migraciones | CP = release, 144/144. Se cambió sólo la etiqueta de una fila; el SQL es idéntico | `migrations-cp-20260928.json` |
| APK del Rider | 13 valores prohibidos revisados, 0 fugas | `apk-scan-rider-cp-20260928.json` |
| Pulso operativo | HEALTHY | `ops-pulse-cp-20260928.json` |
| Tienda anónima | 0 productos visibles, mensaje de cerrado; sólo el 401 esperado de Mercado Pago en consola | — |
| Chequeo de apertura | 7/7 unitarios; sobre el negocio real lista los 7 pendientes | `opening-readiness-cp-20260928.json` |

## Qué sigue bloqueado

| Bloqueo | Por qué | Qué lo destraba |
| --- | --- | --- |
| **Productos vendibles: 0** | 45/46 sin foto con derechos (las fotos de marca no tienen permiso comercial verificable); 46/46 sin precio; 46/46 sin stock contado | Fotos propias + planilla |
| **Primera publicación** | El Panel sólo publica fichas ya verificadas. La verificación la hace la importación comercial con `publicar = si` | La planilla aplicada con la sesión del dueño |
| **Horarios** | 0 franjas en el negocio real y el horario se exige: sin franjas, el servidor rechaza todo pedido | Panel → Horarios y cobertura → Horarios |
| **Modo de entrega** | Delivery y retiro apagados; 0 zonas; sin costo ni mínimo (`DELIVERY_POLICY_REAL`, `DELIVERY_FEES_REAL` y `DELIVERY_ZONE` = `PENDING_OWNER_INPUT`) | Panel → Horarios y cobertura. Retiro es lo más simple para el canary. |
| **Riders y staff** | 0 riders y 0 staff en el negocio real | Se registran en la web del Panel y piden acceso; se aprueban en Panel → Equipo → Solicitudes de acceso |
| **Verificación de plataforma** | `ordering_verified` y `ordering_enabled` están en `false`. La habilita una persona después de confirmar identidad, moneda, entrega, tarifas y condiciones | `opening-readiness.mjs --verify-ordering`, sólo con todo lo anterior en PASS |
| **Alcohol** | Cerrado; 18 SKUs sin política | Decisión comercial y legal: edad mínima y franja |
| **Mercado Pago** | Sin vendedor conectado | Walter conecta **su** cuenta desde el Panel |
| **Rider físico, paso final** | El Moto tiene bloqueo seguro con PIN. Después de apagar la pantalla, la prueba no pudo seguir | Desbloquear y repetir. El PASS completo del 09-24, con la misma APK, sigue vigente |
| **ARCA** | Sin credenciales de homologación. El código fiscal está en PRs sin mergear (#112 y #113, core `taba-fiscal`; #104 quedó superado) | Certificado y CUIT del titular fiscal, y la decisión de merge. Producción: NO |
| **MSI del LocalAgent** | Sin firma de código | Certificado de firma |

**Detalle del Rider físico:**

- Con la APK v4 firmada y el negocio QA:
  - 16 recibos de GPS reales, con precisión mediana de 1,5 m;
  - 3 recibos con la pantalla apagada;
  - 1 recibo 6 s después de volver el WiFi.
- `wm dismiss-keyguard` no abre un bloqueo con PIN. Por eso la UI de la prueba no se encontró al volver.
- El pedido QA LT-0056 quedó cancelado, sin rastro GPS (0 filas) y con el stock devuelto.
- El código del Rider no cambió desde el PASS del 09-24; sólo se agregaron guardas de Gradle.

## Qué requiere humano (en orden)

1. **Fotos propias** de 5 a 10 productos sin alcohol para el canary.
   - Guía y nombres de archivo: `catalog/photo-capture/README.md`.
   - La carga puede hacerse en lote con la misma automatización del Panel que publicó Campari.
   - El dueño revisa cada vista previa y aprueba en Panel → Catálogo → Imagen, con derecho `PROPIO`.
2. **Planilla de apertura**: precio, stock contado y `publicar = si` para esos productos, en `catalog/opening/planilla-apertura-cp.csv`. La aplica el operador técnico con la sesión del dueño; primero en prueba y después de verdad.
3. **Horarios** del local.
4. **Modo de entrega**: retiro y/o delivery con zona, costo y mínimo.
5. **Riders y staff reales**:
   - Cada persona entra a la web del Panel → «Creá tu cuenta» → «Repartir pedidos» o «Atender el local» → «Pedir acceso».
   - El dueño aprueba en Panel → Equipo → Solicitudes de acceso.
   - Los riders instalan por sideload la APK firmada v4 (`2fcc64f9…`, la certificada) e ingresan con ese correo.
6. **Verificación de plataforma**: una persona confirma los datos del comercio y corre `--verify-ordering`.
7. **Abrir el local** desde el Panel en la franja del canary.
8. **Walter**: pasar su e-mail. No se inventó ninguno. Con ese dato:
   - Crear su cuenta: `node scripts/controlled-production/accounts.mjs create-account --target controlled-production --email <walter>`.
   - Hacerlo dueño:
     - `bootstrap-owner` rechaza a propósito un segundo dueño (`BUSINESS_ALREADY_HAS_ANOTHER_OWNER`), y Marco ya lo es.
     - Hay dos caminos. El primero: Marco lo invita como `owner` con la RPC `identity_create_invitation`, porque el Panel no tiene botón para invitar.
     - El segundo: decidir que Marco deje de ser dueño, desactivarlo y usar `bootstrap-owner`.
   - Mandarle el acceso con `accounts.mjs access-link`. El link va al portapapeles y no se imprime.
   - Walter conecta **su** Mercado Pago desde el Panel. Marco no puede ser el vendedor.
9. **Canary de pago real con Mercado Pago**: autorizarlo y hacerlo a mano. `REAL_PAYMENT_EXECUTED: NO`.
10. **Alcohol**: decidir si se vende y con qué franja. Si se vende, cargar la política y sacar las fotos de los 18 SKUs.
11. **Cepita** (issue #118): confirmar qué presentación y GTIN vende el local.
12. **Moto**: desbloquearlo para repetir el Rider físico, o aceptar el PASS del 09-24.
13. **Impresora térmica**: probarla con el LocalAgent en la PC del local.
14. **ARCA**: credenciales de homologación del titular fiscal y decisión sobre los PRs fiscales (#112 → #113).
15. **Contraseña del Panel de Marco**:
    - La que llegó por el chat no cumplía la política de CP y no se usó.
    - La actual es generada y está sólo en el Credential Manager (`TABA2 E2E:CP OWNER MARCO PANEL`).
    - Conviene que Marco la cambie por una propia y no reutilice la que circuló.
16. **GS1 Argentina** (opcional): consultar por imágenes y datos oficiales.
17. **PRs pendientes de decisión**:
    - #117: QA-401 en `main`; ya está en el release.
    - #112, #113, #114, #115: fiscal. #104 está superado por #112 y se cierra.
    - #91, #83, #41.

## Qué puede abrirse hoy

- **Un canary humano con pago manual (efectivo o transferencia coordinada)**, en cuanto estén los puntos 1 a 7 de la cola, aunque sea con 5 productos.
- El resto está probado para ese canary: checkout, pedidos, Panel, Rider (retiro sin rider, o delivery con al menos un rider), impresión opcional, pausa de emergencia y rollback.

## Qué no debe abrirse todavía

- **La tienda al público general**: no hay productos vendibles ni horarios.
- **Pagos con Mercado Pago**: no hay vendedor real y no se hizo el canary de pago.
- **Alcohol**: no hay política cargada.
- **No hacer**:
  - conectar el Mercado Pago de Marco;
  - publicar fotos de marca sin permiso;
  - `db push` sin revisar el registro de migraciones;
  - restaurar un backup sobre CP.

## Plan de apertura 5 → 15 → 30

| Etapa | Clientes | Riders | Catálogo | Pago | Duración | Para avanzar |
| --- | --- | --- | --- | --- | --- | --- |
| 0 · canary | 5 conocidos | 0–1 (retiro, o delivery a una zona) | 5–10 SKUs sin alcohol, con foto propia, precio y stock contado | Manual | Una franja de 2 h | 0 P0/P1, todos los pedidos cerrados, stock igual al conteo, pulso HEALTHY |
| 1 | 15 | 2 | Ampliado | Manual; Mercado Pago sólo con Walter conectado y el canary de pago OK | 1–2 días | Lo mismo y 0 pedidos trabados |
| 2 | 30 | 3 | Todo lo que tenga foto, sin alcohol salvo que haya política | Manual + Mercado Pago | Abierta | Capacidad certificada para 30 usuarios y 3 riders |

**Checklist del día de apertura**

1. `opening-readiness.mjs` con `READY_FOR_CANARY: YES`.
2. Pulso operativo HEALTHY y negocios QA cerrados.
3. Operador del Panel logueado; impresora probada (opcional).
4. Si hay delivery: un rider disponible con el GPS probado.
5. «PAUSAR TODO» a mano como corte de emergencia.

## Fotos requeridas (45 SKUs, archivo `<sku>__front.jpg`)

- **Aguas (5)**: villavicencio-sin-gas-500ml ★, bonaqua-sin-gas-2250ml-local, eco-de-los-andes-sin-gas-2000ml, glaciar-con-gas-1500ml, glaciar-sin-gas-1500ml
- **Gaseosas (7)**: coca-cola-original-2250ml-local ★, coca-cola-sin-azucar-2250ml-local ★, fanta-naranja-2250ml ★, sprite-sin-azucar-2250ml-local ★, pepsi-black-1500ml, pepsi-black-2250ml-local, sprite-sin-azucar-600ml
- **Energizantes (4)**: red-bull-energy-drink-355ml ★, monster-mango-loco-473ml, monster-ultra-473ml-local, speed-zero-473ml
- **Mixers (4)**: paso-de-los-toros-pomelo-1500ml, paso-de-los-toros-tonica-1500ml, schweppes-pomelo-sin-azucar-2250ml, schweppes-tonica-354ml-local
- **Jugos (2)**: cepita-durazno-1000ml, cepita-naranja-1000ml. Antes, confirmar la presentación (issue #118).
- **Snacks (5)**: doritos-queso-129g, lays-clasicas-134g, lays-clasicas-40g, mani-king-salado-sin-piel-100g, pehuamar-palitos-salados-90g
- **Hielo (1)**: hielo-cristal-4kg
- **Con alcohol, sólo si se habilita (17; Campari ya tiene imagen)**:
  - Cervezas: heineken-710ml ★, quilmes-clasica-710ml ★, brahma-chopp-1000ml, corona-extra-330ml, imperial-golden-473ml, patagonia-lager-del-sur-730ml, schneider-rubia-710ml, stella-artois-rubia-473ml
  - Fernet: fernet-branca-750ml ★
  - Aperitivos: aperol-750ml, branca-menta-750ml, cinzano-rosso-950ml
  - Vinos: alamos-malbec-750ml-local, norton-malbec-750ml-local, santa-julia-chenin-dulce-750ml, trapiche-cabernet-sauvignon-750ml, trapiche-red-blend-750ml

★ = canary del catálogo. Los 28 SKUs sin alcohol alcanzan para abrir sin habilitar alcohol.

## Observaciones menores (P3)

- El mensaje de la última acción de imagen se repite dentro del gestor de cada producto. El gestor está plegado, así que casi no se ve.
- La tienda anónima registra en consola el 401 de disponibilidad de Mercado Pago para visitantes sin sesión. Es esperado.
- El Panel muestra «Falta verificar la ficha comercial» sin una acción para resolverlo. Se resuelve con la planilla. Un botón de primera publicación en el Panel sería una mejora de producto, no un bug.
- El enum `source_type` no tiene «licencia abierta», así que Campari quedó como `retail_reference`.

## Rollback

- **Web**: el deploy de esta noche incluyó un simulacro B→A→B (ver «Qué se desplegó»). A mano: Cloudflare Pages → `la-taba-commercial-pilot` → promover el deployment anterior.
- **Operación**: «PAUSAR TODO» desde el Panel. Probado.
- **Base**: backup lógico verificado del 2026-09-28 07:31 UTC. Sólo se restaura en un entorno aislado; nunca sobre CP sin decisión humana.
