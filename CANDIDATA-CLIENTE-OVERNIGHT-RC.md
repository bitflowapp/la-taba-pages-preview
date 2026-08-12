# TABA2 · Candidata cliente · trabajo nocturno del 12-ago-2026

Endurecimiento del storefront del CLIENTE. Todo local: sin push, sin deploy, sin
tocar staging más allá de leerlo, sin Rider, sin Android, sin migraciones, sin
Mercado Pago real y sin un peso movido.

Seis defectos encontrados y corregidos, uno de plataforma documentado, **146
líneas de código de producto** en tres archivos, y 57 pruebas nuevas.

---

## 1. Dónde se trabajó

| | |
|---|---|
| **Repositorio** | `…\dev\la-taba-pages-preview` |
| **Worktree** | `…Q2\worktrees	aba2-customer-overnight-rc` (nuevo) |
| **Rama** | `feature/taba2-customer-overnight-rc` (nueva) |
| **HEAD inicial** | `0a5f6d0` |
| **HEAD final** | `c4cfa4d` — último commit de código. Encima queda un noveno, sólo con este informe |
| **Lock** | `…Q2\_claude-locks	aba2-customer-overnight-rc.txt` |
| **Evidencia** | `…Q2rtifacts	aba2-customer-overnight-rc\` |

### Por qué esta base, verificado y no supuesto

El encargo nombraba `1d26c4b` (candidata cliente + mapa permanente) y `b5ecfd5`
(fix del retorno desde Mercado Pago) pidiendo NO asumir que siguieran siendo
HEAD. No lo son. La punta de la línea histórica del cliente
—`feature/taba2-commercial-production-hardening`— es `0a5f6d0`, y contiene a los
tres commits de referencia con ancestría intacta:

```
1d26c4b  2026-08-11  merge: la candidata cliente une el storefront con el mapa permanente
e2890be  2026-08-11  docs(catalogo+modelo): forense de LT-0142, horarios/zona, auditoría
b5ecfd5  2026-08-11  fix(cliente): la tienda deja de volver sin estilos desde Mercado Pago
   ↓
0a5f6d0  2026-08-12  test(staging): los dos certificadores del retorno desde Mercado Pago
   ↓
feature/taba2-customer-overnight-rc   ← esta rama
```

Comprobado con `git merge-base --is-ancestor`: los tres son ancestros de la
base. **No hubo cherry-pick**: se ramificó de la punta, que ya los tenía.

### Aislamiento

Se leyeron los 23 locks de `…Q2\_claude-locks\` antes de tocar nada. Ninguna
sesión tenía tomado el storefront del cliente: los dos locks recientes
—`taba2-rider-commercial-ux` y `taba2-business-operations-delivery`— estaban
CERRADOS, y el worktree de la línea del cliente estaba limpio y quieto desde
hacía casi cuatro horas. Aun así se creó **worktree y rama nuevos**: la línea
histórica no se movió ni un commit. Recursos propios: `TEMP` en
`…Q2\_claude-tmp\customer-overnight-rc` y puertos 8123–8168 en vez de los
8080/18787 por defecto, para no pisar a otra sesión.

Al terminar, los dos worktrees vecinos que se leyeron
—`taba2-commercial-production-hardening`, del que sale esta rama, y
`taba2-business-operations-delivery`— siguen con el árbol limpio: verificado con
`git status --porcelain` en cada uno. El primero además se usó para reproducir
una falla sobre la base, y quedó igual que como estaba.

### Los commits

```
b64940c fix(cliente): la caché no se puede envenenar al instalar, y el pago no se entrega dos veces
dca97c6 fix(cliente): el catálogo entero faltaba en el precache, y una red muda dejaba la tienda en negro
386190b test(cliente): accesibilidad, soak nocturno y certificación read-only de lo publicado
eb19214 chore(higiene): los finales de línea vuelven a como estaban
a553050 test(cliente): el contenido extremo, el teclado abierto y la vuelta del pago
15eb026 test(carrito): el hueco que faltaba, dos pestañas contra el mismo disco
d28f101 fix(checkout): el rechazo del backend se dice, y un handoff que nunca salió no deja el checkout muerto
c4cfa4d chore(sw): los comentarios dejan de citar números de assets que ya cambiaron
```

Diff real de la rama: 19 archivos, 3353 inserciones, 149 borrados. De producto
sólo se tocan tres archivos —`sw.js`, `js/app.js`, `styles/tokens.css`—, con
**341 líneas agregadas de las cuales 195 son comentario: 146 de código.**

> Nota de lectura: dos commits intermedios (`dca97c6` y `386190b`) tienen ruido
> de fin de línea porque las herramientas de la sesión reescribieron con CRLF
> archivos que estaban en LF. `eb19214` lo revierte, así que el diff de la rama
> entera está limpio; para leer esos dos commits conviene
> `git diff --ignore-cr-at-eol`. Corrección de un dato: el mensaje de `dca97c6`
> dice «npm test 1379/1379»; el número real de esa corrida es **1362/1362**. No
> se puede enmendar sin reescribir historia, así que queda dicho acá.

---

## 2. Lo que se encontró

Seis defectos del cliente, todos corregidos, y uno de la plataforma que no se
corrige desde acá pero cambia la urgencia de publicar los demás.

### B1 · La caché se podía envenenar al instalar · **P1** · CORREGIDO

`b5ecfd5` cerró el camino de LECTURA: un 503, un 404 o la página de un portal
cautivo ya no llegan al documento si hay copia guardada. Pero **la copia guardada
la escribe `install`**, y `cache.addAll` guarda cualquier respuesta con estado
200 sin mirar el tipo.

*Causa raíz:* `addAll` sólo rechaza por estado. Un 200 con HTML entra igual. El
cliente que abre la tienda por primera vez sobre un borde que contesta HTML
guarda esa página como `styles.css` y como cada uno de los módulos del arranque.
Desde ahí la defensa de lectura ya no defiende nada: la copia buena que iba a
rescatar al documento **es** la página del portal.

*Corrección:* se precachea de a uno y sólo lo que sirve, con el mismo contrato
que usa `fetch`. Como `destination` de un `Request` construido a mano siempre
viene vacío, el tipo exigido se deriva de la extensión.

### B2 · Un solo asset caído dejaba al cliente sin precache entero · **P2** · CORREGIDO

*Causa raíz:* `cache.addAll` es todo-o-nada. Un 404 de un despliegue a medio
publicar hacía fallar la instalación completa y el cliente se quedaba sin tienda
offline. Y `activate` borraba la caché anterior sin mirar si la nueva había
quedado completa, dejando al cliente **peor que antes de actualizar**.

*Corrección:* lo que no bajó no se guarda y no tumba al resto; `activate`
conserva la caché anterior mientras la nueva esté incompleta —`caches.match`
recorre todas las cachés del origen, así que la vieja sigue rescatando al
documento— y con el precache incompleto conserva **sólo la más reciente**, para
que una publicación rota no acumule cachés versión tras versión.

### B3 · Una red que ni contesta ni rechaza dejaba la tienda en negro · **P1** · CORREGIDO

*Causa raíz:* `networkFirst` no tenía plazo. El `catch` cubre la red que RECHAZA
y el control de tipo cubre la que contesta MAL; el tercer estado —la que no
contesta— no tenía salida. Es exactamente lo que hace la radio de un teléfono al
reenganchar, que es el instante en que se vuelve de Mercado Pago.

Y el plazo solo no alcanzaba: **medido con el worker activo**, el navegador abre
unas seis conexiones por origen, así que los ~120 subrecursos no esperan cuatro
segundos en paralelo sino cuatro segundos de a seis. Veinte rondas: **46 s** de
pantalla vacía para algo que estaba entero en la caché, muy por encima de los 8 s
tras los cuales `startup-recovery.js` da el arranque por perdido.

*Corrección:* plazo de 4 s más cortacircuitos —tres plazos vencidos y se sirve
directo de la caché por 10 s—. Como los primeros pedidos vencen todos juntos, el
corte se abre a los ~4 s. El mismo escenario pasó de **46 s a 11 s**. Sin copia
guardada se sigue esperando, que es lo correcto: cortar ahí rompería una carga
lenta que iba a terminar bien.

### B4 · El catálogo comercial entero faltaba en el precache · **P1** · CORREGIDO

`js/taba2-commercial-pending-data.js` —115 KB, el catálogo comercial— es import
**estático** del arranque y no estaba en la lista. Con la caché caliente y el
borde contestando 503 a los módulos, **la tienda no arranca**.

*Causa raíz:* el guard que existe para impedir exactamente esto
(`check-precache-graph.mjs`) seguía `import … from` pero **no `export … from`**.
`js/data.js` es una sola línea de re-export, así que el recorrido se cortaba ahí
y los módulos de abajo nunca se contaban. El guard daba verde sobre un grafo
incompleto.

*Corrección:* el guard sigue las dos formas. Pasó de contar 88 módulos a 91, y
además **avisa sin cortar** de 31 imports estáticos del panel del negocio que
están en la misma situación (no son camino del cliente; ver deuda).

### B5 · El segundo toque en «Pagar con Mercado Pago» creaba una segunda sesión · **P1** · CORREGIDO

*Causa raíz:* `window.location.assign()` **pide** la navegación y sigue; el
documento vive hasta que la página de Mercado Pago compromete, y en un teléfono
con red mala eso son segundos. En ese hueco corría el `finally` del checkout y
devolvía el botón a «Confirmar pedido», habilitado. Quien no ve reacción vuelve
a tocar —es el reflejo, no un error de la persona—.

Ninguna de las tres defensas existentes lo veía:

* `createCheckoutClientRequestId()` devuelve un **UUID nuevo en cada llamada**,
  así que la deduplicación por `client_request_id` del backend no la ve;
* `mercadoPagoCheckoutInFlight` sólo funde llamadas **concurrentes**, y para
  cuando llega el segundo toque la primera ya terminó;
* `confirming` se apagaba justamente en el `finally`.

*Medido contra el código anterior:* cuatro toques → **cuatro sesiones de pago con
cuatro `client_request_id` distintos**. Cada una es otra fila en
`checkout_sessions`, otra reserva en `inventory_reservations` descontando stock
del comercio, y `writeMercadoPagoCheckoutRecord` pisando el registro local de
recuperación —lo que deja **huérfana** a la primera sesión: con el stock tomado y
sin nada del lado del cliente que sepa volver a buscarla—.

*Corrección:* el checkout queda tomado hasta que la persona vuelva, y se re-arma
con cuatro eventos. Tres son los que ya usa `pwa-update.js` —`pageshow`, `focus`
y `visibilitychange`, que cubren la vuelta con «atrás» y desde otra
aplicación—. El cuarto, `hashchange`, cubre la salida que ninguno de los otros
ve: **si la navegación externa nunca llegó a comprometer**, la persona no volvió
de ningún lado y sigue en el mismo documento, así que sin esto el checkout
quedaba tomado para siempre y la venta muerta. Lo primero que hace alguien en
esa situación es tocar la barra de abajo.

**El estado vive en el DOM** porque el guardián de la closure no alcanzaba: en
WebKit aguantaba —no se creaba la segunda sesión— pero un re-render de modo
devolvía el botón a su aspecto normal a los 3,3 s. Eso es peor que las dos
alternativas: la persona ve un botón disponible, lo toca, y no pasa nada.

### B6 · Movimiento reducido que no reducía nada · **P2** · CORREGIDO

*Causa raíz:* el reset de `prefers-reduced-motion` acortaba
`animation-duration` a 0,001 ms y no tocaba las iteraciones. Una animación
`infinite` con duración cero **no se detiene**: corre mil veces por segundo. No
se ve, pero el compositor no para nunca, y en un teléfono eso es batería.

*Corrección:* `animation-iteration-count: 1 !important`. Con regresión en
`motion.spec.mjs`.

### B7 · El borde propio produce el envenenamiento sin ayuda de nadie · **P1 de plataforma** · NO ES DEL CLIENTE

Verificado en vivo contra `https://taba2-staging.pages.dev`:

```
GET /styles/no-existe-jamas.css   →  200  text/html  57 021 bytes  (index.html)
GET /js/no-existe-jamas.js        →  200  text/html  57 021 bytes  (index.html)
cache.addAll(['./styles/no-existe-jamas-taba2.css'])  →  GUARDÓ 56 707 bytes
                                                          content-type: text/html
```

Cloudflare Pages contesta el shell de la aplicación a **cualquier** ruta que no
exista, incluidas `.css` y `.js`. O sea: **el envenenamiento de caché que arregla
B1 no necesita el portal cautivo de un bar**. Lo produce un despliegue al que le
falte o que renombre un asset precacheado, sin 404, sin error y sin que nada
avise. No se corrige desde el cliente —es configuración del borde— pero es la
razón por la que B1 deja de ser una hipótesis.

---

## 3. Lo que se agregó para probarlo

| suite | pruebas | qué fija |
|---|---|---|
| `tests/service-worker-install-and-timeout.test.mjs` | 21 | instalación, `activate`, plazo, cortacircuitos, caché heredada. Contra el worker anterior fallaban **10 de 19** |
| `tests/e2e/service-worker-degraded-recovery.spec.mjs` | 19 | worker REALMENTE ACTIVO contra la matriz de doce fallas de borde, en Chromium y WebKit. Antes del arreglo del precache y del cortacircuitos fallaban **10 de 17** |
| `tests/e2e/checkout-payment-handoff.spec.mjs` | 8 | el handoff a Mercado Pago y los tres rechazos del backend, en Chromium y WebKit. Contra el código anterior fallaban **3 de 4** |
| `tests/e2e/storefront-stress-responsive.spec.mjs` | 5 | contenido extremo, teclado abierto, retorno de pago, agotado y precio pendiente |
| `tests/e2e/cart-two-tabs.spec.mjs` | 3 | el carrito con dos pestañas contra el mismo disco |
| `tests/e2e/motion.spec.mjs` | +1 | nada animándose para siempre con movimiento reducido |
| `tests/service-worker-degraded-edge.test.mjs` | 1 dado vuelta | el límite del `content-type` mentido, que el propio test pedía dar vuelta si aparecía un borde así |

**+21 pruebas unitarias** (1341 → 1362) y **+36 de navegador**.

Cinco herramientas que quedan en el repo:

* `scripts/soak-customer-overnight.mjs` — el soak, doce escenarios sobre una
  pestaña de larga vida.
* `scripts/measure-customer-performance.mjs` — mide con el worker **activo**; el
  medidor que había corre con `serviceWorkers: 'block'`.
* `scripts/taba2-customer-a11y-audit.mjs` — accesibilidad sin color.
* `scripts/certify-staging-customer-readonly.mjs` — certificación de lo servido.
* `scripts/realtime-relay.mjs` — aprendió seis formas nuevas de contestar mal
  (429, tipo mentido, cuerpo cortado, red colgada, y degradación de módulos y de
  todo).

El contrato visual de la tienda pasó a `tests/e2e/helpers.mjs`: ahora lo afirman
dos suites y no pueden divergir.

**Ninguna prueba se debilitó para conseguir verde.** La única que cambió de
sentido es el «límite conocido» del `content-type` mentido, y ese test estaba
escrito pidiendo que se lo diera vuelta si alguna vez aparecía un borde así.

---

## 4. Resultados

### Gates

| gate | resultado |
|---|---|
| `npm run check` | **5 / 5** · precache 91 módulos del grafo del cliente, todos en `sw.js` |
| `npm test` | **1362 / 1362** (1341 en la base, +21) |
| Playwright **chromium** | **291 / 291** |
| Playwright **mobile-webkit** | **60 / 60** |
| `npm run secrets:scan` | limpio |
| `npm run migrations:validate` | revisión estática aprobada · **sólo lectura, no se aplicó nada** |

Todo verde, en una corrida con el host libre y nada más compitiendo.

**Sobre los rojos que hubo en el camino, para que nadie los busque en vano.** Una
corrida anterior del gate, hecha MIENTRAS el soak y otra suite ocupaban la
máquina, dio un rojo en `business-windows-operations.spec.mjs` —panel del
negocio, nada que esta rama toque—. Al repetirla falló OTRA prueba del mismo
archivo, que es la firma de la saturación y no de una regresión. Atribuido con
evidencia: la misma suite da 3/3 verde en esta rama con la máquina libre, y 2/2
verde sobre la base `0a5f6d0` sin ninguno de estos cambios. La corrida final de
arriba, ya sin competencia, la pasa junto con las otras 288.

### Soak

**1706 ciclos en 50 minutos**, sobre UNA pestaña de larga vida —un contexto nuevo
por ciclo escondería justamente lo que se busca—, con doce escenarios rotando y
las mismas invariantes comerciales exigidas después de CADA ciclo: tienda
arrancada, superficie de marca puesta, barra inferior fijada, hoja principal con
reglas, sin desborde, carrito legible y cero rechazos sin manejar nuevos.

| | |
|---|---|
| Ciclos | **1706** (~142 por escenario, los doce parejos) |
| Duración | **50 min** |
| Errores de escenario | **0** |
| Fallas de invariante | **0** |
| Promesas rechazadas sin manejar | **0** |
| Errores de página | **0** |
| Worker controlando la pestaña | **siempre** |

Los doce escenarios: navegar→carrito→recargar · carrito→checkout→abandonar ·
checkout→externo→volver · offline→online · borde 503→recuperación · worker
viejo→nuevo · pestaña vieja→reabrir · seguimiento · ruta inválida→recuperación ·
catálogo lento (red colgada) · almacenamiento corrupto · segundo plano→primer
plano.

**Degradación acumulativa: no hay.**

| | primer cuarto | último cuarto |
|---|---|---|
| oyentes vivos | 74 | 75 |
| intervalos vivos | 1 | 1 |
| temporizadores vivos | 6 | 6 |
| memoria (tras recolección forzada) | 10 MB | 14 MB |

Los oyentes, los intervalos y los temporizadores están planos, que es lo que
delata una fuga y lo que se buscaba. La memoria no sube de a poco: se queda en
10 MB durante los primeros 658 ciclos, da **un escalón** a 13–14 MB y se queda
plana los 1000 siguientes. La atribución más probable es que el escalón lo
produje yo: alrededor de ese ciclo edité `sw.js` —el relay sirve desde disco, así
que el worker cambió de bytes y el escenario de actualización instaló uno nuevo
de verdad—. Es una hipótesis, no una medición: lo que sí es medición es que la
serie es plana antes y después, y que la forma es un escalón y no una pendiente.

**Un hallazgo, y fue del propio harness.** La primera corrida acumuló 7 errores
entre los ciclos 39 y 61: el carrito crecía sin vaciarse nunca y a las ~35
vueltas todos los botones de agregar estaban deshabilitados. No era un defecto:
era el contrato de stock del catálogo demo funcionando. Se corrigió el harness
—se vacía y se sigue comprando, como una persona— y esa corrida quedó archivada
en `soak-corrida-1-artefacto-de-stock/` para que se pueda ver.

Bitácora completa: `soak/soak.jsonl` (una línea por ciclo) y
`soak/soak-resumen.json`.

> Sobre la duración: el encargo orientaba a «~100 ciclos» o «durante horas». Se
> hicieron **17× el objetivo de ciclos** en 50 minutos de reloj. Se cortó ahí a
> propósito: la serie estaba plana desde hacía mil ciclos y el host hacía falta
> libre para correr el gate completo sin que la saturación produjera falsos
> rojos —que es exactamente lo que pasó cuando ambos corrieron juntos, ver más
> arriba—.

### Service worker y caché

Doce fallas de borde, con el worker activo, en los dos motores:

| borde | hojas | módulos | todo |
|---|---|---|---|
| 503 | ✓ | ✓ | ✓ |
| 404 | ✓ | ✓ | — |
| 429 | ✓ | — | — |
| portal cautivo (200 HTML) | ✓ | ✓ | — |
| tipo mentido (200, tipo correcto, cuerpo HTML) | ✓ | ✓ | — |
| red colgada (ni contesta ni rechaza) | ✓ | ✓ | ✓ |

Más: primera visita sobre portal cautivo sin envenenar la caché; el precache se
cura solo en la primera visita sana; módulo servido como HTML que no entra a la
caché; pestaña reabierta contra worker activo; dos pestañas contra el mismo
worker; y el carrito intacto tras recargar con el borde caído.

**Worker viejo → worker nuevo.** No hizo falta escribir nada:
`tests/e2e/pwa-update-lifecycle.spec.mjs` ya publica DOS versiones distintas del
`sw.js` REAL en la misma URL y camina el ciclo entero —worker en espera, otra
pestaña que actualiza primero, «Actualizar ahora» que recarga una sola vez, el
aviso que se puede cerrar en iPhone, y que no se apilen escuchas—. Como lee el
fuente de verdad, esas cinco pruebas ejercen el `activate` nuevo contra una
transición de versión genuina, y siguen verdes. El soak además rota un escenario
de `registration.update()` + `skipWaiting` + recarga cada doce ciclos; ese es más
flojo —sin cambio de bytes no hay worker nuevo que instalar— y por eso la
cobertura real de la actualización es la suite, no el soak.

**La asimetría que queda, con número detrás.** El cuerpo se inspecciona siempre
para las hojas de estilo, y para los módulos **sólo si hay copia guardada**. No
es prolijidad: inspeccionar módulos siempre llevaba la visita fría de 167 a 182
pedidos y de 1993 a 2576 KB transferidos, y en la visita fría la caché está
vacía, o sea que la inspección no puede servir para nada. Con la condición, la
visita fría vuelve exacto a 167 pedidos y 1993 KB. En `install` sí se inspecciona
siempre: es una vez por publicación y es el momento en que se envenena la caché.

`CACHE_NAME` se deja en **v61** a propósito: los assets no cambiaron y subir la
versión obligaría a todos los clientes a bajar los 120 de nuevo. El
envenenamiento heredado se desactiva por el control de lectura, que es más
barato.

### Mercado Pago · volver atrás

Lo que ya estaba certificado en `0a5f6d0` sigue verde (9 pruebas: css-503,
css-404, portal cautivo, atrás interno, segundo plano, y los cuatro retornos
cancelado/pendiente/rechazado/aprobado). Lo nuevo:

* el segundo toque durante la navegación **no** crea una segunda sesión;
* el botón **nunca** vuelve a estar disponible mientras el pago está entregado;
* al volver, el checkout se re-arma y se puede cambiar el medio de pago, con el
  carrito intacto;
* si la navegación externa **nunca salió**, moverse por la tienda devuelve el
  checkout en vez de dejarlo muerto;
* el doble toque sobre un backend lento en el camino de efectivo viaja con el
  **mismo** `client_request_id`, así que el backend lo reconoce como un pedido.

Todo con backend de mentira y destino externo respondido localmente: **cero
pagos, cero pedidos, cero pesos**.

### Carrito

Lo que ya estaba: sobrevive a la recarga, se reconcilia contra el catálogo
verificado (producto que desapareció, sin stock o sin precio no vuelve), vence a
las 72 h, y un 503 del catálogo **no** lo vacía. Se agregó el hueco que faltaba
—dos pestañas— y quedó verde sin tocar producto.

Incidentalmente verificado por el soak: el catálogo respeta el stock. Sumando de
a dos por ciclo, a las ~35 vueltas el botón de agregar quedó deshabilitado en
todos los productos. No hay producto gratis ni sobreventa.

### Checkout

Máquina de estados ejercida en doble toque, vuelta, recarga, backend lento,
error de backend, reintento, sesión entregada al pago, efectivo y Mercado Pago
TEST simulado. Los tres rechazos de último segundo —stock insuficiente, contenido
cambiado durante el envío y sesión vencida— se **dicen**, no pierden el carrito y
dejan el botón listo para reintentar. Sin pedido duplicado, sin sesión de pago
duplicada, sin estados visuales ambiguos.

### Tracking

**No se tocó una línea.** Las cuatro suites siguen verdes (8 pruebas): mapa
siempre visible, sin Rider inventado en reposo, llegada, modo seguimiento y
expiración terminal. El soak recorre `#tracking` cada doce ciclos y exige que el
panel siga existiendo.

Se auditó la cobertura de lo que pedía el encargo y ya estaba puesta:
`tests/customer-tracking-poll.test.mjs` cubre token vencido o revocado, sondeo en
segundo plano, aborto de consultas lentas, revalidación terminal y limpieza de
listeners (13 pruebas); `tests/rider-tracking-no-replay.test.mjs` cubre los
puntos fuera de orden —«C → B(viejo) no retrocede», «realtime entrega C y el poll
llega con B», «cola offline drenada después de E en vivo»— y el regreso REAL que
sí tiene que verse (12 pruebas). No hacía falta agregar nada.

**No se usó `recover_order_tracking_access` contra ninguna sesión humana.**

### Responsive

`320 · 360 · 375 · 390 · 412 · 432` en Chromium y WebKit, once pasos por ancho:
**66 mediciones por motor, cero hallazgos**. Sin desborde, sin objetivo táctil
por debajo de 44 px, sin acción principal tapada, sin campo con tipografía que
haga zoom solo en iOS.

Lo que esa auditoría no podía ver, cubierto aparte y también en cero: nombre de
99 caracteres, precio de siete cifras con total de ocho escrito entero, teclado
abierto (380 px de alto), retorno de pago con parámetros, agotado y precio
pendiente.

### Accesibilidad

Cero hallazgos de semántica en las siete vistas, en los dos motores: todos los
controles tienen nombre accesible, todos los campos tienen etiqueta, ninguna
imagen sin alternativa, ningún enfocable escondido con `aria-hidden`, ningún
`tabindex` positivo, y el foco se ve en todas las paradas del tabulador. El
contraste ya lo cubría el auditor existente y sigue sin fallas.

Un único hallazgo real, corregido: el movimiento reducido (B6).

**Nota de método.** La primera versión del auditor medía el foco con
`el.focus()` y reportó 35 controles «sin foco visible». Era falso:
`:focus-visible` es una decisión del navegador y un foco programático no la
activa. Recorriendo con tabulador de verdad, los 35 desaparecen. **No se cambió
una línea de CSS por ese ruido.**

### Performance

Con el worker ACTIVO, mediana de seis corridas, 390×844:

| escenario | usable | load | pedidos | transferido | decodificado | memoria |
|---|---|---|---|---|---|---|
| fría (cliente nuevo) | 450 ms | 458 ms | 167 | 1993 KB | 2870 KB | 10 MB |
| caliente (recurrente) | 226 ms | 270 ms | 167 | **0 KB** | 2870 KB | 10 MB |
| recarga | 198 ms | 336 ms | 167 | 0 KB | 2870 KB | 10 MB |

Oyentes vivos 72–85, un intervalo, cuatro temporizadores. Estable.

**La deuda histórica, medida y no tocada.** 2870 KB decodificados para abrir una
tienda de bebidas es mucho, y buena parte no se usa en Home: el grafo de mapa y
seguimiento (`maplibre_tracking_map.js` 1071 líneas, `route_geometry.js` 446,
`rider_motion.js` 294, `map_view.js` 554) y el catálogo demo
(`taba2-commercial-pending-data.js` 115 KB + `approved-beverage-demo-data.js`
41 KB) entran por imports estáticos del arranque. **No se refactorizó**: el
encargo pide no hacerlo sin una mejora local y demostrable, y mover eso a import
dinámico cambia el grafo del precache, el arranque offline y el contrato del
mapa permanente. Queda cuantificado para que la decisión se tome con el número.

### Staging público · sólo lectura

**Ningún deploy. Ninguna mutación. Sólo GET.**

| | |
|---|---|
| Worker servido | `la-taba-runtime-v61-cliente-comercial-mapa-permanente`, **119 assets** |
| ¿Trae los arreglos de esta noche? | **NO** — 0 coincidencias de `precargar`, `PLAZO_DE_RED_MS`, `pareceDocumentoHtml` |
| Assets del precache servido | 119 / 119 responden 200 con el tipo correcto y sin HTML en el cuerpo |
| Cliente nuevo | usable en 8,3 s · sin errores de consola · sin desborde · marca puesta |
| Cliente recurrente | usable en 2,4 s · **0 pedidos a la red** · 122 recursos, todos de caché |
| `runtime-config.js` | `mode=production`, provider supabase, businessId `00000000-…-0001`. **Sin secretos**: la única aparición de la palabra `service_role` está en el comentario de advertencia; no hay ninguna asignación |
| Borde ante asset inexistente | **200 con `index.html`** — ver B7 |

**Lo servido tiene el agujero del precache (B4) y el de la instalación (B1).**
Distinción explícita: todo lo de este informe está **corregido localmente**;
**nada está servido en staging**.

---

## 5. Deuda

### BLOCKER

Ninguno atribuible al cliente.

### P1 · fuera del alcance de esta rama

* **El borde contesta 200 con HTML a cualquier ruta inexistente** (B7). Es
  configuración de Cloudflare Pages, no del cliente. Mientras siga así, cualquier
  despliegue al que le falte un asset precacheado envenena la caché de todos los
  clientes que instalen en esa ventana. B1 lo neutraliza del lado del cliente;
  cerrarlo del lado del borde es una decisión de plataforma.

### P2

* **El camino de Mercado Pago no tiene la clave de idempotencia persistente que
  sí tiene el pedido directo.** `createOrder` conserva `pendingRequest` mientras
  el intento no cerró bien, así que un reintento viaja con el mismo
  `client_request_id`. `createMercadoPagoCheckout` genera uno nuevo cada vez y no
  lo persiste. Hoy la única defensa es la del botón (B5), que cubre el caso
  observado —el segundo toque en la misma pestaña— pero no cubriría un reintento
  desde otra pestaña o después de recargar. Aplicar el mismo patrón exige saber
  cómo trata el backend un `client_request_id` repetido, y eso no se puede
  verificar sin mutar staging.
* **31 imports estáticos del panel del negocio no están precacheados** aunque sus
  módulos raíz sí lo estén (`production-operations.js` y compañía). Sin red esos
  módulos no evalúan igual, así que precachear la raíz sola no sirve. No es
  camino del cliente. El guard ya lo avisa en cada `npm run check`.

### P3 · documentado, sin acción

* **Un borde que miente el `content-type` de los MÓDULOS deja sin tienda al
  cliente NUEVO.** Con copia guardada está cubierto; sin copia no hay arreglo
  posible del lado del cliente, porque `startup-recovery.js` es un script clásico
  y llega roto igual que el resto. Cloudflare Pages no produce este caso —contesta
  `text/html`, que sí se detecta—. Fijado con prueba.
* **`span.product-age-tag` usa fondo blanco** sobre la identidad oscura. El
  auditor lo marca como superficie clara; es una decisión de legibilidad del
  aviso de edad, no una falla de contraste. Sin acción.
* **`styles.css` sigue siendo una cadena de trece `@import`.** Funciona y está
  respaldada, pero concentra toda la presentación en un recurso cuyo fallo apaga
  la tienda. Observación heredada del P1 anterior; sigue vigente.

### POST-PILOT

* Los 2870 KB decodificados del arranque, con el mapa y el catálogo demo
  entrando por imports estáticos. Medido arriba.

---

## 6. Qué necesita gate humano

1. **iPhone real contra staging, DESPUÉS de publicar.** Es el gate que ya pedía
   el P1 anterior y sigue pendiente: entrar, agregar dos productos, ir al
   checkout, elegir Mercado Pago, salir, volver con «atrás», y mirar que la
   tienda esté entera y el medio de pago se pueda cambiar. Nada de lo hecho esta
   noche lo reemplaza: se probó en WebKit simulado, no en un teléfono.
2. **El segundo toque, en el teléfono.** Tocar «Pagar» y volver a tocar mientras
   la pantalla no reacciona. El botón tiene que quedarse en «Te llevamos a
   Mercado Pago…» y no volver.
3. **La decisión sobre el borde** (B7): si Cloudflare Pages debe seguir
   contestando el shell a rutas `.css` y `.js` inexistentes.

## 7. Qué necesita deploy

Todo. Nada de este trabajo está publicado.

Por orden de valor:

1. **`sw.js`** — B1, B2, B3, B4. Es donde está el riesgo real y donde el borde
   propio (B7) ya demostró que el disparador existe.
2. **`js/app.js`** — B5, el segundo toque en Mercado Pago.
3. **`styles/tokens.css`** — B6, movimiento reducido.

Advertencia que conviene repetir: **el arreglo del worker rige recién cuando el
worker nuevo activa.** Un cliente con la PWA abierta sigue con el worker viejo
hasta que acepte «Actualizar ahora» o cierre todas sus pestañas. Durante las
primeras horas después de publicar puede quedar alguien con el comportamiento
anterior, y eso no significa que el arreglo no esté.

---

## 8. Lo que no se tocó

`STAGING_MUTATED=false` · `PRODUCTION_TOUCHED=false` · `DEPLOY=false` ·
`PUSH=false` · `DB_PUSH=false` · `ARCA=false` · `MERCADO_PAGO_REAL=false`

Sin Rider, sin Android, sin Moto G15. Sin migraciones ni `supabase db push` ni
Management API —`migrations:validate` se corrió sólo en su modo estático de
lectura—. Sin pedidos humanos. Sin tocar LT-0030 ni LT-0142. Sin `reset`,
`clean`, `stash` ni `amend`. Sin secretos en ningún log ni en ningún artefacto
(verificado con un barrido sobre la carpeta de evidencia).

Y sin un solo `window.location.reload()` nuevo: el encargo lo prohibía como
parche y no hizo falta.

---

## 9. Declaración

Se cumplen los seis criterios de cierre del encargo:

* **sin P0/P1 abierto atribuible al cliente** — los seis defectos encontrados
  están corregidos, con prueba que falla contra el código anterior. El P1 que
  queda abierto (B7) es del borde, no del cliente, y está declarado como tal;
* **WebKit verde** — 60/60, y las tres suites nuevas del cliente corren ahí
  además de en Chromium;
* **MP → atrás protegido** — nueve pruebas heredadas más cinco nuevas, incluida
  la que mide que cuatro toques dejan de crear cuatro sesiones de pago;
* **carrito estable** — persistencia, reconciliación, vencimiento, 503, dos
  pestañas y storage corrupto;
* **checkout idempotente** — sin pedido ni sesión duplicados, y los rechazos de
  último segundo se dicen sin perder el carrito;
* **soak sin degradación progresiva** — 1706 ciclos, oyentes y temporizadores
  planos, cero fallas de invariante.

Por lo tanto:

# TABA2_CUSTOMER_OVERNIGHT_RELEASE_CANDIDATE_READY

Con dos cosas dichas en voz alta, que no son reservas sobre la candidata sino
sobre lo que falta para que llegue a alguien:

1. **Nada de esto está publicado.** Lo que sirve staging hoy es la versión
   anterior, con el agujero del precache y el de la instalación. La candidata es
   local y está lista; el deploy es una decisión humana.
2. **El gate del iPhone real sigue pendiente**, como ya lo estaba antes de esta
   noche. Se probó en WebKit simulado con el worker activo, que es todo lo que se
   puede probar desde acá, y no reemplaza a una persona con el teléfono en la
   mano después de publicar.

Corregir un dato del propio encargo: el soak corrió **50 minutos**, no varias
horas. Se cortó a propósito con 17× el objetivo de ciclos, la serie plana desde
hacía mil vueltas, y el host haciendo falta libre para que el gate final no
diera falsos rojos. Queda dicho para que nadie lea «durante horas» donde dice
cincuenta minutos.
