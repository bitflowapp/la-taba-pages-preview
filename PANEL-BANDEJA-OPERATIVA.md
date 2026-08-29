# El Panel del negocio como bandeja de trabajo

Rama `feature/taba-business-panel-automation`. **Nada de esto toca producción**:
no hay migraciones nuevas, no se cambió Mercado Pago, ni credenciales, ni
`business_payment_settings`, ni alcohol, ni precios, ni el catálogo comercial,
ni los contratos fiscales, ni el Rider, ni el checkout del cliente.

El objetivo era que el dueño pueda manejar TABA una jornada entera desde un
teléfono: abrir el panel, ver qué necesita atención, tocar el pedido, ejecutar
la acción y volver a la bandeja, en segundos.

---

## 1. Auditoría: qué encontramos

Se auditó el Panel **de producción** (`js/production-operations.js` +
`js/business/*`), que es el que ve un comercio real. El panel de demostración
(`js/business.js`) queda oculto en modo producción (`applyRenderedModeState`) y
no se tocó.

### Lo que ya estaba bien, y por eso no se rehizo

La capa de datos del Panel ya era sólida y **no había que reconstruirla**:

| Área | Cómo está resuelto hoy | Dónde |
| --- | --- | --- |
| Pedido nuevo sin refresh | Realtime de Postgres + sondeo de seguridad + `pageshow` + `visibilitychange` + `online` | `core/business-order-intake.js` |
| Realtime caído | Se degrada a sondeo y lo **dice** en pantalla | `handleRealtimeStatus` |
| Eventos duplicados | Reconciliación por `revision` con marcas de agua; un snapshot atrasado se descarta | `reconcileBusinessOrderSnapshot` |
| Dos pestañas | `BroadcastChannel` + respaldo por `storage`; una invalida a la otra | `setupPeerInvalidation` |
| Aviso repetido | El aviso se **reclama** con Web Locks + `localStorage` (7 días): una vez por pedido, aunque haya dos pestañas y aunque se recargue | `alertOnce` |
| Pedidos finalizados | Salen solos de la bandeja activa | `isBusinessInboxOrder` |
| Doble toque | Guarda en vuelo por pedido + clave de idempotencia derivada de `(tipo, pedido, revisión, destino)` | `updateOrderFromAction`, `core/idempotency-key.js` |
| Éxito antes de tiempo | Nunca: el estado sólo cambia con la respuesta del servidor y `expectedRevision` | `transition_order` |
| Sin conexión | Cola durable con reintentos y backoff | `business-command-outbox.js` |
| Lo que se está tipeando | Se rescata y se devuelve alrededor del repintado | `capturarBorradoresDelOperador` |
| Mobile-first | Barra inferior de 4 destinos + hoja de «Más», tarjeta comprimida, cero desborde | rondas anteriores, `styles/business.css` |

### Los ocho huecos que sí encontramos

1. **La bandeja era una lista plana.** `orders.map(businessOrderMarkup)`: seis
   tarjetas iguales, sin secciones, sin recuentos, sin prioridad visible. Medido
   con la bandeja de prueba a 390×844 entraba **una** tarjeta entera; a 320×568,
   **ninguna**. «¿Cuántos pedidos nuevos tengo?» costaba recorrer el tablero
   leyendo el estado de cada tarjeta.
2. **No existía «requiere atención».** Un pedido demorado, uno listo hace media
   hora sin repartidor y uno recién entrado se veían exactamente igual.
3. **La hora era absoluta y del aparato equivocado.** «Hora 28/8, 02:26 a. m.»:
   hay que restar mentalmente, y además `dateTime()` de `state.js` no declara
   zona ni reloj de 24 horas, así que mostraba la hora del teléfono del operador
   en formato ambiguo — el mismo defecto que `panel-timestamp-unambiguous`
   arregló para el resto del Panel y que en la tarjeta de pedido seguía vivo.
4. **El teléfono era texto plano.** Llamar significaba leerlo, memorizarlo,
   salir de la aplicación y tipearlo. No había WhatsApp. El panel de
   *demostración* tenía los dos enlaces desde hacía tiempo; el que usa el
   comercio, no.
5. **Un pedido nuevo hacía una sola cosa: un toast de tres segundos.** Sin
   timbre, sin vibración, sin insignia, sin contador. `business-sound-service.js`
   y `business-notification-service.js` existían con el timbre ya escrito y
   **nadie los instanciaba**: `grep -r createBusinessSoundService js/` devolvía
   una sola línea, su propia definición.
6. **Una tarjeta podía quedarse muda.** Con el cobro devuelto,
   `canAdvanceProductionBusinessOrder` le sacaba el botón y no explicaba nada:
   un pedido con el que no se podía hacer nada y sin una línea que dijera por qué.
7. **El tablero se reemplazaba entero sin novedades.** La franja de estado
   («Conectado · Última sincronización…») era parte del marcado del workspace,
   así que cada latido del coordinador reemplazaba el DOM completo. Medido con
   300 pedidos: **29 reemplazos en 30 segundos**, de 548 KB y 12.172 nodos cada
   uno, sin que un solo pedido hubiera cambiado.
8. **Dos trabajos que se calculaban y se tiraban.** `businessWorkspaceMarkup()`
   armaba `businessPaymentsMarkup()` entero en cada repintado —una tarjeta de
   HTML por cada pago del día— y nunca lo interpolaba. Y
   `.production-operations-shortcuts` no era un contenedor flex, así que la
   regla `flex-wrap: nowrap` que decía tener no hacía nada: los diecisiete
   destinos se envolvían en **tres renglones** en escritorio.

---

## 2. Qué se implementó

### La bandeja por secciones (`js/business/business-order-tray.js`)

Módulo **puro**: recibe pedidos, pagos, ofertas y un reloj, y devuelve datos.
No toca el DOM, no consulta estado global, no pide red.

```
REQUIEREN ATENCIÓN (1)   Resolver primero
PEDIDOS NUEVOS (2)       Aceptar o cancelar
EN PREPARACIÓN (1)       Armando el pedido
LISTOS (1)               Para retirar o despachar
EN ENTREGA (1)           Con el repartidor
```

Las cabeceras son **pegajosas**: el recuento —la respuesta a «cuántos me
quedan»— no desaparece al desplazarse. Las secciones vacías no se dibujan. Un
pedido que requiere atención **sube** a la primera sección y no aparece dos
veces.

El orden **dentro** de cada sección no se recalcula: llega ya ordenado por
`compareBusinessInboxOrders` (estado y después antigüedad, el que espera hace
más tiempo primero). Dos autoridades sobre lo mismo se separan con el tiempo.

### Los umbrales salen del servidor, no de una opinión

Las tres señales de demora son **exactamente** las cláusulas que la tarea
automática del servidor usa para levantar sus alertas, copiadas de
`supabase/migrations/20260810140000_scheduler_stalled_needs_history.sql`:

| Señal en pantalla | Regla | Contrato |
| --- | --- | --- |
| **Pedido sin aceptar** | `submitted`, sin `acknowledged_at`, entró hace ≥ 10 min | `ORDER_NOT_ACCEPTED` |
| **Pedido demorado** | `accepted`/`preparing`, y pasó `preparación prometida (o 30) + 30 min` | `ORDER_STALLED` |
| **Listo sin repartidor** | `ready`, delivery, sin rider, listo hace ≥ 15 min | `ORDER_READY_WITHOUT_RIDER` |
| **Rechazado por el repartidor** | la oferta viva volvió `rejected` | `list_rider_order_offers` |
| **Pago devuelto** | devolución total o contracargo sobre el pedido | `isProductionOrderPaymentReversed` |
| **Devolución en curso** | hay un reembolso `requested`/`processing`/`ambiguous` | `paymentRecoveryState` |

`tests/business-order-tray.test.mjs` **lee la migración** y compara sus números
contra las constantes del Panel: si el servidor cambia un umbral y el Panel no,
la prueba corta. Es la única forma de que dos lecturas de la misma regla no se
separen en silencio.

**Quién manda no cambia.** La autoridad sigue siendo el servidor: «Qué pasa»
muestra las alertas que calcula la tarea automática. Lo de la bandeja es una
lectura *local* de la misma regla, para no esperar hasta un minuto —ni una
llamada de red más por repintado— antes de marcar en rojo lo que ya está
demorado.

Para las tres marcas de tiempo que esa lectura necesita se agregaron al mapeo
del repositorio `acknowledgedAt`, `readyAt` y `preparationEstimateMinutes`:
estaban en la fila —la consulta trae `*`— y el mapeo las descartaba.

### El reloj de espera

«Entró **hace 26 min**» reemplaza a la hora absoluta en la cabecera de la
tarjeta. La hora exacta no se pierde: vive en el detalle y usa el formateador
canónico del Panel (`formatPanelTimestamp`, zona `America/Argentina/Buenos_Aires`,
reloj de 24 horas), con lo que además queda cerrado el hueco 3 de la auditoría.

El número se mantiene vivo **sin repintar el tablero**: el marcado emite
`<time data-elapsed-from="…">` con el texto ya calculado, la huella del
repintado ignora ese texto, y un reloj de 30 s lo reescribe en su propio nodo.

### El aviso de pedido nuevo (`js/business/business-order-alerts.js`)

Cuatro canales, cada uno degradando solo si la plataforma no lo tiene:

| Canal | Dónde funciona |
| --- | --- |
| Timbre (dos tonos) | Donde haya `AudioContext` **y** el operador lo haya encendido |
| Vibración | Android; en iOS no existe la Vibration API y no pasa nada |
| Insignia del icono | `navigator.setAppBadge`, sólo con la PWA instalada |
| Contador en el título | En todas partes — «(2) La Taba» en la pestaña y en el conmutador de apps |

**El timbre lo enciende una persona, y no por diseño:** `AudioContext` arranca
suspendido hasta que hay un gesto del usuario, así que un timbre «siempre
encendido» sería un interruptor que dice sí y no suena. El botón está en la
cabecera, suena una vez al encenderlo —única prueba honesta de que va a sonar— y
la preferencia sobrevive a la recarga.

**No hay spam**: quién decide que hay que avisar sigue siendo `alertOnce()` del
coordinador, que ya reclamaba el aviso con Web Locks + `localStorage`. Un pedido
se anuncia una vez, aunque haya dos pestañas abiertas y aunque se recargue.

### La tarjeta: qué decide arriba, qué se consulta abajo

**Arriba, siempre visible:** código, cliente, estado, aviso de atención, espera,
modo de entrega, medio de pago, total, resumen de productos, **teléfono
marcable**, **WhatsApp**, dirección (o «Retira en el local»), observaciones, y la
acción siguiente.

**En el detalle (`<details>` nativo, un toque):** lista completa de productos,
combos, hora exacta, referencia, punto de entrega con enlace al mapa, y la
**cancelación con motivo**.

El detalle es `<details>` y no una pantalla nueva a propósito: abrirlo no navega,
no cambia el hash, no pierde la posición de la bandeja, se cierra con el mismo
toque, y el teclado y el lector de pantalla ya lo saben manejar. Las tarjetas
abiertas se recuerdan en el módulo, no en el marcado: el workspace se repinta
cuando entra un pedido y una tarjeta abierta se habría cerrado sola en la mano
de quien la acababa de abrir.

La cancelación vive ahí y no al lado de la acción principal porque es la
decisión opuesta: separarla es lo que evita el toque equivocado sobre la tarjeta
más urgente del turno.

### WhatsApp, sin inventar números

`tel:` usa el número **tal como se guardó**. `wa.me` necesita el internacional
completo y ahí sí hay que componerlo: país 54 + el 9 de celular, porque es el
único país donde este producto opera (facturación ARCA, moneda ARS, domicilio en
Neuquén). Cuando el número no permite armar algo plausible **no se inventa un
enlace**: la tarjeta muestra sólo «Llamar». Un `wa.me` mal compuesto abre
WhatsApp con un error, que es peor que no ofrecerlo.

### El tablero deja de reemplazarse solo

La franja de estado se emite **vacía** en el marcado y se llena con un parche en
su propio nodo. Como su texto nunca entra al marcado, tampoco entra a la huella
del repintado: mientras el servidor no traiga novedades, el DOM del tablero no
se toca. Es la misma separación que el reloj de espera.

Además, `«Recuperando pedidos»` dejó de anunciarse en el sondeo de rutina: cada
cinco segundos eso no es una recuperación, es el latido normal, y en pantalla
eran doce parpadeos por minuto sobre una bandeja perfectamente al día.

---

## 3. Benchmark, medido — no estimado

`node scripts/business-panel-bench.mjs --pedidos 300` · 390×844 · la misma
bandeja de prueba antes y después.

| | antes | después | |
| --- | --- | --- | --- |
| Tiempo hasta ver las 300 tarjetas | 465 ms | **334 ms** | −28 % |
| Reemplazos del tablero en 30 s **sin novedades** | 29 | **0** | −100 % |
| DOM reemplazado por esa causa, cada 30 s | ~15,9 MB | **0** | |
| Nodos del workspace | 12.172 | 15.298 | +26 % |
| Marcado del workspace | 548 KB | 864 KB | +58 % |
| Costo de un repintado real | 284 ms | 258 ms | −9 % |

El DOM creció porque cada tarjeta ahora lleva su aviso de atención, sus dos
botones de contacto y su detalle. Lo que bajó —y es lo que se paga durante ocho
horas— es el trabajo **sostenido**: antes el Panel reconstruía y reemplazaba
medio megabyte de DOM veintinueve veces cada treinta segundos sin que hubiera
pasado nada.

### Densidad, en los anchos donde se usa

`node scripts/business-panel-responsive.mjs` · 12 anchos × 12 pantallas.

| ancho | chrome antes del 1.er pedido | tarjeta mediana | pedidos enteros a la vista |
| --- | --- | --- | --- |
| | antes → después | antes → después | antes → después |
| `320×568` | 271 → 309 | 533 → **349** | 0 → 0 |
| `360×740` | 249 → 312 | 496 → **349** | 1 → 0 |
| `375×812` | 249 → 312 | 496 → **349** | 1 → 1 |
| `390×844` | 249 → **275** | 496 → **349** | 1 → 1 |
| `412×915` | 249 → **275** | 496 → **349** | 1 → 1 |
| `430×932` | 249 → **275** | 496 → **349** | 1 → 1 |
| `768×1024` | 218 → 287 | 496 → **349** | 1 → 1 |
| `1366×768` | 408 → **374** | 440 → **384** | 0 → **2** |
| `1440×900` | 408 → **374** | 384 → **384** | 2 → **3** |
| `1920×1080` | 408 → **374** | 440 → **384** | 2 → **3** |

**La tarjeta mediana bajó 30 % llevando más información.** El chrome subió entre
20 y 60px en teléfono: son las dos filas nuevas —el resumen del turno y la
cabecera de sección— que son justamente la respuesta de dos segundos.

**A 360×740 el contador de «pedidos enteros» bajó de 1 a 0, y es honesto
decirlo**: esa métrica mide la PRIMERA tarjeta, y la primera ahora es
deliberadamente la que está trabada —la que lleva además el aviso de atención y
el selector de repartidor—, no la más vieja. Una tarjeta típica (349px) sí entra
entera en ese ancho.

En escritorio la bandeja se lee en columnas, una por sección: la primera
pantalla muestra la cabeza de tres carriles a la vez. Medido a 1440×900, tres
pedidos enteros contra los dos de antes, y a 1366×768 dos contra ninguno.

### Lo que la sonda mide y no cambió

| | antes | después |
| --- | --- | --- |
| Desborde horizontal (144 combinaciones) | 0 | **0** |
| Áreas táctiles < 44px | 0 | **0** |
| Pares de contraste < 4,5:1 | 24 | 24 |

Los 24 pares de contraste son **los mismos 24 antes y después**, en dos
superficies que este trabajo no tocó (`login` y `team-access`). Ver «Riesgos».

---

## 4. Clasificación de automatizaciones

Basada en contratos reales del sistema, no en intención.

### AUTOMÁTICA — sin intervención humana

| Qué | Dónde |
| --- | --- |
| Entrada de pedidos por realtime, con sondeo de seguridad de respaldo | `business-order-intake.js` |
| Recuperación al volver la conexión, al volver del fondo y al recargar | `setupLifecycleRecovery` |
| Sincronización entre pestañas | `BroadcastChannel` + `storage` |
| Descarte de snapshots atrasados por revisión | `reconcileBusinessOrderSnapshot` |
| Salida de la bandeja de los pedidos finalizados | `isBusinessInboxOrder` |
| Orden por urgencia (estado, después antigüedad) | `compareBusinessInboxOrders` |
| **Clasificación en secciones y señales de atención** | `business-order-tray.js` |
| **Reloj de espera y detección de demora** | `paintElapsedTimes` + umbrales del servidor |
| **Aviso de pedido nuevo (timbre, vibración, insignia, título)** | `business-order-alerts.js` |
| **Recuento de pendientes en insignia y título** | `pendingOrdersForAlerts` |
| Reintento con backoff de comandos encolados | `business-command-outbox.js` |
| Refresco del estado de pagos (cada 15 s) | `startPaymentRefresh` |
| Evaluación de alertas operativas (cada minuto, servidor) | tarea programada |

### SEMIAUTOMÁTICA — un toque, y el servidor confirma

| Qué | Salvaguarda |
| --- | --- |
| Aceptar · Iniciar preparación · Marcar listo · Confirmar entrega (retiro) | `expectedRevision` + clave de idempotencia + guarda en vuelo |
| Ofrecer / reasignar repartidor, retirar oferta | el servidor recuenta la capacidad al aceptar |
| Llamar al cliente · abrir WhatsApp | abre la app; no escribe nada |
| Abrir y cerrar el detalle del pedido | sólo presentación |
| Encender el timbre | se guarda la preferencia; ninguna otra consecuencia |
| Actualizar pagos «ahora» | consulta |

### HUMANA — sigue exigiendo una decisión explícita

| Qué | Por qué, y qué se exige |
| --- | --- |
| **Cancelar un pedido** | Motivo obligatorio escrito a mano. Con cobro de Mercado Pago, bloqueada hasta que la devolución total esté hecha. |
| **Devolver dinero** | Irreversible. Motivo + escribir `DEVOLVER`. No se puede devolver más de lo cobrado. Sólo dueño o encargado. |
| **Habilitar la homologación fiscal** | Frase exacta `I_AUTHORIZE_ARCA_HOMOLOGATION`, y el servidor además exige aprobación del contador, datos fiscales y certificado vigente. La facturación **real** no se habilita desde el Panel. |
| **Cerrar el día** | Firma. Una diferencia de caja sin explicar frena el cierre; con problemas críticos abiertos hay que escribir `CERRAR IGUAL`. |
| **Publicar un producto / cargar precios** | Sólo dueño o encargado; queda auditado. |
| **Conectar Mercado Pago / habilitar cobros** | Asistente con evidencia real paso a paso. |
| **Confirmar que una impresión salió** | Un trabajo aceptado por el spooler nunca se reporta como impreso. |
| **Aprobar el acceso de una persona al comercio** | Bandeja de solicitudes, decisión del dueño. |

Ninguna acción irreversible se automatizó, y ninguna dejó de pedir lo que pedía.

---

## 5. Pruebas

**Nuevas**

| Archivo | Qué fija |
| --- | --- |
| `tests/business-order-tray.test.mjs` (23) | Los umbrales contra la migración; el reloj; cada señal de atención con su borde exacto; el reparto en secciones sin duplicados; el resumen del turno; la composición de WhatsApp y su caso «no se puede, no se inventa» |
| `tests/business-order-alerts.test.mjs` (9) | El timbre nace apagado; la preferencia sobrevive a la recarga; un almacenamiento bloqueado no lo apaga; el mismo pedido no se anuncia dos veces; iOS sin vibración sigue avisando; el contador no se acumula sobre un título ya contado |
| `tests/e2e/panel-bandeja-movil.spec.mjs` (16) | El pedido nuevo entra solo; el detalle no pierde la bandeja y sobrevive al repintado; teléfono y WhatsApp; dirección y retiro; la transición mueve de sección; **el doble toque manda una sola transición**; un error del servidor no se muestra como éxito; recargar relee del servidor; la reconexión recupera; dos pestañas convergen; el aviso no se repite tras recargar; 320/390/430 sin desborde; **cero reemplazos del tablero sin novedades** |
| `tests/business-panel-surfaces.test.mjs` (+1) | Ningún comentario HTML del código fuente lleva acentos graves — ver «Riesgos» |

**Ampliadas**: `tests/e2e/panel-responsive.spec.mjs` ahora corre también a
**320×568**; `tests/e2e/business-intake-reliability.spec.mjs` abre el detalle
antes de escribir el motivo, que es el recorrido real.

**Estado**: `npm run check` en verde · `npm test` **2.299/2.299** · Playwright
chromium **415/415**.

---

## 6. Riesgos y deuda que quedan abiertos

1. **El Panel no arranca sin red, y no es nuevo.** `production-operations.js`
   está en el precache del service worker, pero se carga por import dinámico y
   **sus 39 imports estáticos no están en la lista** —incluido
   `business-operations-center.js`, y ahora los dos módulos nuevos—. Sin red, un
   import estático que no está en caché rompe el grafo entero: el Panel no
   degrada, no abre. `npm run check` lo avisa desde antes de este trabajo y no
   corta el gate. Agregar dos de treinta y nueve no arregla nada: es un cambio
   propio, con su prueba.
2. **24 pares de contraste por debajo de 4,5:1**, idénticos antes y después, en
   `login` («Creá tu cuenta», «Olvidé mi contraseña», 1,66:1) y `team-access`
   («Esperando», 2,22:1). No se tocaron esas superficies; quedan anotados.
3. **Con 300 pedidos el workspace son 864 KB de marcado y 15.298 nodos.** Ya no
   se reconstruye sin motivo, pero un cambio real de un solo pedido sigue
   rearmando el tablero completo (258 ms). Con la bandeja cerca del tope de 500
   que sirve el repositorio, eso pide o repintado por tarjeta o virtualización.
4. **«Comprobante fiscal solicitado» no está en la bandeja.** El estado fiscal
   de un pedido vive en `listFiscalDocuments`, que la bandeja no consulta;
   pedirlo por tarjeta sería un N+1 por repintado. Sigue en «Comprobantes», que
   es donde se resuelve. No se inventó una señal que no se puede sostener.
5. **`PAYMENT_APPROVED_WITHOUT_ORDER` tampoco puede vivir acá**: por definición
   es plata sin pedido, así que no hay tarjeta donde ponerla. Sigue en «Qué
   pasa».
6. **La demora de la bandeja es una lectura local.** Coincide con la del
   servidor por regla y por prueba, pero puede adelantarse al barrido de un
   minuto. Es a favor del operador —marca antes, nunca después— y la alerta
   formal sigue siendo la del servidor.
7. **`businessPaymentsMarkup()` quedó sin llamador.** Se dejó en el archivo con
   un comentario que lo explica: los manejadores `data-production-payment-*`
   siguen siendo el camino de recuperación de un pago y comparten contratos con
   ese bloque. Darlo de baja entero es una limpieza aparte.
8. **El benchmark corre contra un servidor simulado sin WebSocket**, así que
   realtime está permanentemente caído durante la medición. Es el peor caso a
   propósito —un local con mala señal— pero no es el caso típico.

### Un defecto que este trabajo introdujo y sacó, y que conviene conocer

Un comentario `<!-- … -->` escrito **dentro** de un template literal viaja como
texto, y si cita algo con acentos graves —`` `<h2>` ``— el acento **cierra la
plantilla**. Lo peligroso es que el archivo sigue parseando: lo que queda se lee
como una cadena de comparaciones entre plantillas, así que `node --check` pasa,
`npm run check` pasa, y el Panel se dibuja **vacío** en el navegador. Lo
encontraron 32 pruebas de navegador en rojo, ningún gate de sintaxis. Ahora hay
una prueba que lo impide (`tests/business-panel-surfaces.test.mjs`).

---

## 7. Archivos

**Nuevos**

```
js/business/business-order-tray.js        clasificación, urgencia y contacto (puro)
js/business/business-order-alerts.js      timbre, vibración, insignia y título
scripts/business-panel-bench.mjs          el benchmark de arriba
tests/business-order-tray.test.mjs
tests/business-order-alerts.test.mjs
tests/e2e/panel-bandeja-movil.spec.mjs
artifacts/taba2-panel-operativo-movil/    capturas 320/360/375/390/393/412/430/…
```

**Modificados**

```
js/production-operations.js               bandeja por secciones, tarjeta, detalle,
                                          reloj vivo, parche de estado, avisos
js/business/business-panel-render.js      exporta el formateador de hora del Panel
js/core/business-order-intake.js          «Recuperando» sólo cuando hay algo que recuperar
js/repositories/supabase_order_repository.js  mapea acknowledged_at, ready_at y
                                          preparation_estimate_minutes
styles/business.css                       secciones, avisos, contacto, detalle,
                                          columnas de escritorio, 320px
scripts/business-panel-responsive.mjs     agrega 320×568 y mide la tarjeta mediana
sw.js · release-identity.json             CACHE_NAME v92 (re-firmado)
scripts/preflight-staging-package.mjs     el CACHE_NAME que exige el preflight
tests/github-pages.test.mjs               idem
tests/business-panel-surfaces.test.mjs    guarda de comentarios HTML
tests/e2e/panel-responsive.spec.mjs       agrega 320×568
tests/e2e/business-intake-reliability.spec.mjs  abre el detalle antes de escribir
```

---

## 8. Cómo reproducir la evidencia

```bash
npm ci
npm run check
npm test
npx playwright test --project=chromium

# capturas y medición responsive (12 anchos × 12 pantallas)
node scripts/business-panel-responsive.mjs --label despues \
  --out artifacts/taba2-panel-operativo-movil/capturas

# benchmark con 300 pedidos
node scripts/business-panel-bench.mjs --pedidos 300 --label despues
```

Nada de eso toca Supabase, Mercado Pago ni ARCA: intercepta las llamadas del
cliente y responde con datos inventados. Ninguna captura contiene datos reales.
