# La Taba — cierre técnico antes de las pruebas auténticas de Mercado Pago

**Veredicto: técnicamente lista para la ronda de pagos auténticos de prueba. NO-GO para cobrar a clientes reales**
hasta que pasen los cinco bloqueos de la sección 7, que no se resuelven con código. Nada de esto tocó producción,
la cuenta de Walter ni dinero real; costo de infraestructura: USD 0.

- Repositorio `bitflowapp/la-taba-pages-preview` · rama `fix/astra2-ledger-worker-preview-20261022`.
- QA `ixewllzzuzpqrkxzmfzx` (único proyecto tocado) · preview `https://recovery-20261020.taba2-staging.pages.dev`
  (rama de preview `recovery-20261020` del proyecto Pages `taba2-staging`; la rama productiva `staging` no se tocó).

## 1. Estado del repositorio (lo que había y lo que se recuperó)

- **Los ~1.275 archivos «borrados» nunca se perdieron.** El checkout tiene un *sparse checkout* (configurado el 21/10
  a las 21:24, modo no-cono) que deja fuera del disco capturas de `artifacts/` y `agents/windows-local-agent`. Esos
  archivos tienen la marca *skip-worktree*, siguen en el índice y en HEAD (`git fsck` limpio; índice = HEAD; los 1.275
  coinciden uno a uno con el `git status` preservado a las 18:05). Ningún archivo de `supabase/`, `tests/` o `js/`
  estaba afectado. Un commit nuevo los conserva (el árbol de cada commit de este cierre tiene los 4.225+ archivos). No
  hizo falta restaurar nada; si alguna vez se necesitan en disco: `git sparse-checkout disable` (sólo escribe lo que
  falta). Hay dos respaldos fuera del repositorio, hechos por la sesión anterior: un bundle de la rama con el
  `git status` de ese momento (18:05) y un bundle de todas las ramas locales con la configuración del checkout (18:26).
- `artifacts/product-discovery-real-campaigns/` (sin seguimiento) es salida de `tests/e2e/product-discovery.spec.mjs`
  (mediciones de búsqueda): no es código y no se versiona.
- **Los cambios que había dejado la sesión anterior en los tests** (`${CONNECT}` en `forensic-26` #08/#09 y en las
  sondas F08 de `p1-reconciliation`) se revisaron contra el código: desde `20261022130000` las sondas sólo se encolan
  para un vendedor conectado (corrección de la revisión independiente, para no reencolar eternamente lecturas que
  fallan), y esos escenarios lo suponen. **No tapaban un defecto**; pero al revisarlos apareció uno real en la misma
  zona (sección 2.1), que sí estaba fijado por otra prueba (C13) y se corrigió.

## 2. Correcciones de este cierre (las de código, con una prueba que falla antes y pasa después)

### 2.1 Un pago pendiente de un vendedor que ya no se puede leer quedaba invisible (prioridades 5 y 7)

Cuando Mercado Pago revoca la vinculación, `mp_mark_seller_deauthorized` también apaga el medio de pago, así que la
alerta `MERCADOPAGO_SELLER_CANNOT_CHARGE` no se dispara; y `run_financial_integrity_checks` **cerraba** los hallazgos
de ese vendedor: un pago pendiente quedaba «resuelto» como `checked_again` y la verificación vencida de un pedido como
`verified_no_loss`, aunque nadie los había leído. Un ticket en efectivo de Mercado Pago pagado días después no dejaba
ninguna alerta.

`20261022140000_pending_payment_stays_visible_without_seller.sql` (reemplaza un cuerpo de función; no reescribe filas):
el pago pendiente sin vendedor que lo pueda leer es **un** hallazgo (alerta crítica `PAYMENT_DISCREPANCY_OPEN`), que se
abre una sola vez y no se reabre si una persona lo resolvió; un hallazgo pendiente sólo se cierra cuando el pago se
releyó o se definió; la verificación vencida de un pedido completado se sigue cerrando al desconectar (la desconexión
voluntaria lo permite a propósito) pero con la verdad: `seller_disconnected`. Para un vendedor desconectado no se
encola nada (igual que antes).

Pruebas: C13 cambió de contrato **a propósito** (fijaba el defecto), C16 y C17 son nuevas: rojas sobre `20261022130000`,
verdes ahora. En QA alojado, con el planificador real, el simulacro lo mostró de punta a punta (sección 4).

### 2.2 El primer «Ingresar» del panel no hacía nada (operación diaria de Walter)

El formulario de ingreso está en la página antes de que llegue el código del panel (se difiere para no cargarle 759 KB
a quien compra). Un envío que llegaba primero recibía «no lo atendí» después de que la página ya había cancelado el
envío normal: se perdía sin un solo mensaje y había que tocar «Ingresar» dos veces. Visto en un Chromium real contra
el preview. Ahora el envío espera al panel y, si no puede cargarlo, lo dice. Prueba nueva
`tests/back-office-first-submit.test.mjs` (roja con el archivo anterior, verde ahora). El cliente pasa a
`la-taba-runtime-v159-panel-first-login` (identidad de release refirmada).

### 2.3 La puerta del preview peleaba con la PWA

La puerta HTTP Basic que había preparado la sesión anterior, al publicarse, mostró dos problemas: (a) detrás del worker
de la puerta `sw.js`, la página y `version.json` salían **sin** `Cache-Control`; (b) un service worker no puede mostrar
el diálogo de HTTP Basic y, con un 401, sirve la shell guardada: quien ya tenía instalada la v156 (o cualquiera tras
reiniciar el navegador) seguía viendo una versión vieja sin que se le pidiera la clave y sin poder actualizar — el
«preview desactualizado» de la segunda auditoría, otra vez. Ahora: una navegación sin acceso va a un formulario propio
(`/__acceso`); la clave correcta deja una cookie de sesión `__Host-` (Secure, HttpOnly, SameSite=Lax, 30 días, firmada
con HMAC derivado del secreto: rotar la clave cierra todas las sesiones); los pedidos del service worker la llevan; las
herramientas siguen entrando por HTTP Basic. Lo autenticado se sirve `private, no-cache`. 12 pruebas de la puerta.

### 2.4 Herramientas de QA alineadas con el código final

- El simulacro alojado `qa-drill-late-changes.mjs` esperaba que se encolaran lecturas para un vendedor desconectado
  (comportamiento que el código final evita a propósito) y usaba un id de preferencia fijo que ya existía en QA.
- `verify-functions.mjs --gates-only` para un QA en uso; `verify-preview-deployment.mjs` lee un preview con puerta y
  recorre la puerta como un navegador; `sync-hosted.mjs` avisa qué tareas `pg_cron` pausa al migrar (lo hace a
  propósito; ver 4); los recorridos de Playwright abren la sesión en la puerta con su formulario.
- La higiene de release encontró rutas locales en el informe anterior y un falso positivo en una expresión regular.

## 3. Resultados de pruebas (código final)

Corridas secuenciales (una suite por vez, 16 GB de RAM compartidos). Lo que no se pudo correr está dicho.

| Verificación | Sobre qué | Resultado |
|---|---|---|
| Suite PostgreSQL completa (`tests/db`): dinero y stock (p0), los 26 escenarios, reconciliación A1–A12, tiempo del worker B1–B3/B6, **cortes en cada punto B4/B5**, contratos C1–C17, concurrencia (6), respaldo y restauración con dinero en tránsito, worker real, despacho | base **construida desde cero** con las 169 migraciones (no una plantilla vieja) | **134/134** (antes de 2.1: 132/132; B4/B5 sobre el código final por primera vez) |
| Pruebas SQL de Mercado Pago del repositorio (pgTAP), cada una en un clon descartable | esquema final | **8/8 archivos** (82 aserciones + 2 guiones) |
| Las mismas suites sobre **QA alojado** (transacciones que se revierten) | QA con las migraciones nuevas | **6/6** |
| Suite JavaScript completa (`npm test`, incluye 222 de pagos con proveedor simulado, barrido y presupuesto de tiempo, puerta del preview) | cliente v159 | **3106/3106** |
| `npm run check` (sintaxis, config, precache, higiene, identidad de release, ubicación, codificación SQL, secretos) · `migrations:validate` · escaneo del artefacto | final | verde |
| Navegador real contra el preview publicado | v159 detrás de la puerta | despliegue 16/16 · panel 9/9 · service worker 6/6 · compra en efectivo completa (ver 5) |

No corrido, a propósito o por falta de herramienta: la matriz E2E completa de Playwright (≈ 830 casos; el cliente
sólo cambió en `js/back-office.js`, cubierto por prueba unitaria y por el navegador real contra el preview); el
*type-check* Deno de las Edge Functions (Deno no está instalado; las funciones se ejecutaron en el *sandbox* Node de
las pruebas y en QA real); `test:release:db` (Docker).

## 4. Supabase QA

En este orden, todo sobre `ixewllzzuzpqrkxzmfzx` (organización Free, presupuesto USD 0):

1. **Respaldo cifrado** (AES-256-GCM, ida y vuelta verificada, 3,7 MB; 5 usuarios Auth, 4 productos, 4 pedidos, 167
   migraciones). Guardado fuera del repositorio, en D:.
2. **Restauración probada** en una base aislada nueva del mismo servidor: 152 de 154 tablas idénticas bit a bit —todas
   las financieras (`payment_intents`, `payment_provider_payments`, `payment_refunds`, `orders`,
   `inventory_reservations`, `payment_discrepancies`, `checkout_sessions`, `products`, `payment_events`) y
   `auth.users`—; RLS, políticas, permisos, 492 funciones y publicación idénticos. Las 2 que difieren son operativas
   (`operational_sweep_runs`, `operational_alerts`): el planificador vivo las escribió después del respaldo. La base de
   restauración que creé se borró al terminar; la del ciclo anterior (`taba_restore_20261022_ad3d29a2`) sigue ahí
   esperando tu decisión.
3. **Ensayo con *rollback*** de las dos migraciones sobre el esquema real: aprobado y revertido.
4. **Migraciones aplicadas**: `20261022130000` y `20261022140000` (169 en total; libro de recuperación = libro de
   Supabase, mismo SHA-256 por versión).
5. **Edge Functions**: las 6 que dependen de lo cambiado (`payment-worker` v7, `webhook` v9, `checkout-status`,
   `create-preference`, `refund`, `cancel-payment`). Las 13 están `ACTIVE` y rechazan pedidos sin autenticar o
   malformados; el webhook responde 503 porque falla cerrado mientras falte su firma (pendiente 7.1).
6. **Planificador**: la herramienta de migraciones **pausa a propósito** todas las tareas `pg_cron` al migrar (un esquema
   nuevo no debe correr antes que sus funciones). Las reactivé después del despliegue de funciones, pero no enseguida:
   **QA estuvo ~8 minutos sin planificador** (22:12:52–22:21:00 UTC). Sin dinero real en juego; las 5 tareas corren
   desde entonces sin una falla, y la herramienta ahora avisa qué pausó.
7. **Vault y HMAC**: el secreto de Edge y el de Vault coinciden (SHA-256); una llamada sin firma y otra con firma alterada
   → 401; la llamada firmada desde Vault que despachó `pg_cron` al worker nuevo → **200**.
8. **Conciliación y alertas, con el planificador real** (simulacro sintético): pago pendiente sin vendedor conectado →
   ningún reencolado, **un** hallazgo y la alerta crítica `PAYMENT_DISCREPANCY_OPEN`; trabajo de un worker muerto →
   recuperado (`retry_wait`, una interrupción, *backoff*). La salud del circuito: 0 trabajos vencidos, 0 *dead letters*.
9. **Pedido en efectivo de punta a punta por las RPC reales**, con Realtime: reserva una vez, el panel lo lee, el dueño
   lo cancela, el stock vuelve una vez. En la **primera** corrida tras un rato quieto la suscripción del dueño no
   recibió eventos (el comprador sí); la siguiente, 11/11. Ver riesgo 7.6.
10. Asesores de seguridad: 0 errores; 233 advertencias y 55 notas de categorías ya conocidas (funciones `SECURITY
    DEFINER` ejecutables por `authenticated`, ingreso anónimo habilitado, tablas de servicio con RLS sin políticas).
    Ninguna función nueva aparece.

## 5. Cloudflare (preview QA)

- **URL:** <https://recovery-20261020.taba2-staging.pages.dev> (alias de la rama `recovery-20261020`; despliegue
  `870cc727`, de tipo *preview*). Build del commit `1c8d0635`, runtime `la-taba-runtime-v159-panel-first-login`, apuntado
  al inquilino QA A («QA Pagos de prueba, no público»). Los commits posteriores sólo tocan herramientas y documentos.
- **Lo servido es exactamente el artefacto**: 375 de 375 archivos idénticos (SHA-256); `version.json`, `CACHE_NAME` de
  `sw.js` y la fecha de build coinciden; `sw.js`, la página y `version.json` se revalidan; `noindex`.
- **Acceso controlado, gratis** (worker de Pages, sin Cloudflare Access ni nada pago): sin sesión, una navegación va al
  formulario `/__acceso` y cualquier otro pedido recibe 401; la clave da una sesión de 30 días; si se agota la cuota de
  Functions el proyecto **no** sirve sin puerta (`fail_open=false`).
  - **Usuario `qa`.** La clave vive sólo en el Administrador de credenciales de esta PC (`TABA2 E2E:RECOVERY PREVIEW
    ACCESS`); para copiarla al portapapeles sin verla en pantalla: `node scripts/recovery/preview-access.mjs --copy`.
    Pasala a los revisores por un canal privado (no por este chat ni por el repositorio). Para cambiarla:
    `--rotate` y volver a publicar el preview; cierra todas las sesiones.
  - Quien abrió el preview **antes** de hoy (v156, sin puerta) debería ver el formulario en la próxima navegación y, al
    entrar, actualizarse solo: su service worker deja pasar las redirecciones igual que v159 (desde v141). Esto se
    deduce del código y se probó con v159, **no** con un navegador que tenga v156 instalada; si alguien queda viendo
    una versión vieja, borrar los datos del sitio una vez lo resuelve.
- **Probado en Chromium real a través de la puerta:**
  - Panel del dueño: ingreso con **un** clic, Pagos con «Cobros manuales» (efectivo/transferencia) y la lista de Mercado
    Pago, el contador igual a lo que responde el servidor, sin errores de consola: 9/9.
  - Service worker: se activa, precachea los 216 archivos detrás de la puerta, la recarga queda bajo su control, y sin
    sesión la recarga muestra el formulario y no una tienda vieja: 6/6.
  - Compra: catálogo → carrito → retiro → datos → **efectivo** → pedido `LT-0048` confirmado por el servidor; sin scroll
    horizontal a 390 px; el dueño lo ve y lo cancela; el stock vuelve una sola vez. **Mercado Pago no se ofrece**,
    correcto: QA no tiene vendedor conectado (el servidor responde `data-mercadopago-available=false`). La elección
    efectivo / Mercado Pago con Mercado Pago **ofrecido** sólo se puede ver después del paso 8.A.2.
- No se tocó la rama productiva `staging` ni ningún otro proyecto. Cobros comerciales: deshabilitados.

## 6. GitHub

- Rama publicada: `fix/astra2-ledger-worker-preview-20261022` (repositorio **público**). Commits de este cierre, sobre
  `3f94db06`:
  - `78868c02` pago pendiente sin vendedor visible (`20261022140000`, C13/C16/C17) y herramientas de QA;
  - `03ad1d65` la puerta revalida y no comparte lo autenticado;
  - `c1549e37` la puerta funciona con la PWA (sesión firmada y formulario);
  - `1c8d0635` primer «Ingresar» del panel (v159);
  - `f47ddf1c` verificadores de navegador;
  - el commit de este informe y su evidencia.
- Todos llevan `[CF-Pages-Skip] [skip ci]`, como los anteriores: un push no dispara builds de Pages ni CI.
- Antes del push: `npm run check` (incluye el escaneo de secretos) y revisión de la evidencia (sin rutas locales, sin
  credenciales, sin tokens). Ningún secreto, clave ni contraseña está en el repositorio: viven en el Administrador de
  credenciales de esta PC, en Vault o en los secretos de Edge.
- Pull Request **en borrador** contra `main`, para revisión: la rama está 35+ commits por delante de `main` (toda la línea
  de recuperación, forense, Astra2 y este cierre) y 0 por detrás. **No se hizo merge** ni se publicó producción.

## 7. Riesgos pendientes

**Los cinco bloqueos reales para cobrar** (no se resuelven con código):

1. **Pagos auténticos de Mercado Pago (prueba).** Falta la firma del webhook de QA (hoy el webhook falla cerrado con
   503), el consentimiento OAuth del vendedor de prueba `3594962708` y los pagos con tarjetas oficiales de prueba:
   aprobado, rechazado y después aprobado, pendiente, dos intentos, devolución parcial y total, respuesta de devolución
   perdida, cancelación. Con eso también se verifica contra el proveedor real lo que hoy está simulado: el libro mayor
   por `date_last_updated`, su paginación y el formato de fechas.
2. **Vinculación autorizada de la cuenta de Walter** (aplicación y entorno de producción, distintos de QA). Requiere tu
   autorización explícita y la de Walter.
3. **Precios, fotografías y stock reales**: Walter valida los 72 SKU de la planilla (fuera de Git). Hasta entonces no se
   publica ningún producto real.
4. **Recuperación y respaldo externo**: destino cifrado fuera de esta PC, custodia de la clave separada y RPO/RTO
   acordados con Walter. La restauración de la base está probada; la de la plataforma completa (Auth, Storage, cron,
   Vault y secretos de Edge en un proyecto nuevo) no.
5. **Revisión financiera final** independiente sobre el commit que se vaya a usar para cobrar.

**Riesgos técnicos que quedan** (conocidos y acotados):

6. **Realtime tras un rato quieto**: la primera suscripción del dueño puede quedar «suscrita» sin entregar eventos. El
   panel productivo igual consulta cada 45 s con la pestaña visible, así que un pedido nuevo aparece en menos de un
   minuto; con la pestaña **oculta** y el canal mudo, recién al volver al frente. Recomendación operativa: el panel
   abierto y visible en el dispositivo del mostrador.
7. Si Mercado Pago revoca la vinculación, el medio de pago se apaga y la alerta «no puede cobrar» no se dispara: el
   dinero en tránsito ya queda visible (2.1), pero el hecho de que Mercado Pago desapareció del checkout sólo se ve en
   Panel → Mercado Pago.
8. Sin *type-check* Deno de las Edge Functions; `scripts/release-v5/compatibility.json` sin re-baseline (lo exige
   cualquier salida a producción).
9. Asesores de Supabase con advertencias de categorías conocidas (sección 4.10): revisar antes de abrir al público.
10. Plan Free: 150 s de reloj por invocación (el worker ya planifica con presupuesto), sin respaldos automáticos ni PITR,
    y 100.000 pedidos/día de Functions para la puerta del preview.
11. Restos en QA que esperan tu autorización para borrarse: la base `taba_restore_20261022_ad3d29a2` y los inquilinos
    sintéticos de los simulacros («MP retry fixture», pausados; uno tiene a propósito la alerta crítica del pago
    pendiente sin vendedor que prueba la corrección 2.1).

## 8. Pasos exactos para empezar a vender con Walter

**A. Ronda de pagos auténticos de prueba (QA, sin dinero real), en este orden:**

1. Firma del webhook: en el panel de desarrolladores de Mercado Pago, aplicación de **prueba** de QA
   (`2691240967769590`), configurar el webhook y copiar su clave secreta al portapapeles (la persona titular, con su
   MFA). Después: `node scripts/recovery/store-webhook-secret-from-clipboard.mjs` (la guarda en QA sin mostrarla y
   limpia el portapapeles) y `node scripts/recovery/qa-mp-e2e.mjs forged-webhooks` (una firma falsa debe rechazarse).
2. Vendedor de prueba: `node scripts/recovery/qa-panel-connect.mjs` imprime un enlace de un solo uso (10 min); la cuenta
   vendedora de prueba lo abre en su navegador y autoriza. Verificar con `node scripts/recovery/qa-mp-e2e.mjs status`.
3. Compras: abrir la ventana QA (`qa-mp-e2e.mjs window-open`), comprar desde el preview eligiendo **Mercado Pago** con
   el comprador de prueba y las tarjetas oficiales de prueba (la persona, en su navegador): aprobada, rechazada y luego
   aprobada, pendiente; y una en **efectivo**. Revisar en el panel: Pedidos (cada pago aprobado con su pedido, una sola
   vez) y Pagos («Dinero sin resolver» vacío). `qa-mp-e2e.mjs inspect` compara con el servidor.
4. Devoluciones y cancelación desde el panel: una parcial, una total (el pedido totalmente devuelto no se puede
   entregar) y una cancelación; `qa-mp-e2e.mjs worker` y `inspect` para ver que el proveedor y la base coinciden.
5. Cerrar la ventana (`qa-mp-e2e.mjs window-close`) y guardar la evidencia en `docs/audit/`.

**B. Antes de abrir la tienda real:**

6. Walter completa y firma la planilla de los 72 SKU (precio, presentación, foto con derechos, stock); se importan con
   las herramientas de catálogo y se revisa la góndola en el preview.
7. Respaldo externo: elegir destino cifrado y quién guarda la clave; programar el respaldo y hacer un simulacro de
   restauración (las herramientas ya existen: `postgres-backup.mjs`, `restore-postgres-application.mjs`,
   `verify-postgres-restore.mjs`, alarma `backup-freshness.mjs`).
8. Revisión financiera independiente sobre el commit final; re-baseline de `release-v5` y proceso de salida a
   producción (proyecto productivo propio, nunca este QA).
9. Con tu autorización y la de Walter: Walter vincula **su** cuenta de Mercado Pago desde el panel de producción (OAuth,
   con su MFA), se habilita Mercado Pago, se hace una compra real chica de punta a punta (y su devolución), y recién
   ahí se abre a los primeros clientes. El efectivo funciona desde el primer día, aun sin Mercado Pago.
