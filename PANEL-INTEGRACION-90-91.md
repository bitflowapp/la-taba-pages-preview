# Panel del negocio — la integración de #90 y #91

Dos trabajos sobre la misma pantalla, hechos en paralelo contra un `main`
anterior, y con cruces reales. Este documento dice qué vino de cada uno, dónde
se pisaban, cómo se resolvió cada pisada y con qué evidencia.

El principio con el que se resolvió, y que conviene tener a mano al leer:

> **#90 define la UX operativa. #91 define la estrategia de reconciliación y
> render.** Ninguna se sacrificó para meter la otra.

Rama: `integration/taba-business-panel-90-91`, desde `88f40a2`.

---

## 1 · Qué vino de cada uno

### De #90 — la bandeja que dice qué mirar primero

| Contrato | Dónde vive |
| --- | --- |
| Bandeja por secciones (Requieren atención · Nuevos · En preparación · Listos · En entrega) | `js/business/business-order-tray.js`, `construirBandeja()` |
| Recuentos por sección | encabezado de cada sección, parcheado aparte del cuerpo |
| Prioridades y umbrales sincronizados con el servidor | `TRAY_DELAY_RULES`, atados a la migración por `tests/business-order-tray.test.mjs` |
| Reloj de espera («hace 9 min») | `<time data-elapsed-from>` + `paintElapsedTimes()` |
| Timbre, vibración, insignia y contador del título | `js/business/business-order-alerts.js` |
| Llamar y WhatsApp | `orderContactLinks()` |
| Detalle con `<details>` | `businessOrderDetailMarkup()`, estado en `expandedOrderCards` |
| Explicación de pagos y reembolsos bloqueados | `TRAY_ATTENTION.PAYMENT_*` |
| Preservación de borradores | `capturarBorradoresDelOperador()` / `trasplantarBorradorDeTarjeta()` |
| Comportamiento móvil | `styles/business.css`, `tests/e2e/panel-bandeja-movil.spec.mjs` |
| Cero repintados sin novedades | ahora lo garantiza la comparación por región |

### De #91 — la bandeja que no se rearma

| Contrato | Dónde vive |
| --- | --- |
| Render por regiones | `businessWorkspaceParts()`, `data-panel-region` |
| Reconciliación keyed por tarjeta | `planTrayReconciliation()` |
| LIS para minimizar movimientos | `subsecuenciaCrecienteMasLarga()` |
| Costo que no escala con 50/100/300/500 | medido abajo |
| Precache del grafo real del Panel | `sw.js` + `scripts/check-precache-graph.mjs` |
| Detección de imports dinámicos de back-office | `check-precache-graph.mjs` |
| `sandbox-tools.js` incluido | `sw.js` |
| Gate offline real | el guard ahora **corta**, no avisa |
| Carrera entre dos pestañas, idempotente | `business-command-outbox.js` |
| Guard contra nodos de texto acumulativos | `parchearRegion()` |
| Guard de transición estado vacío → pedidos | `parchearBandeja()` |
| Endurance sin crecimiento | medido abajo |

---

## 2 · Los conflictos, y cómo se resolvió cada uno

### A · Dos mecanismos de parche incremental → uno

**El cruce.** #90 sacó la franja de estado del marcado del workspace y la
escribía en su nodo con `patchWorkspaceStatus()`. #91 partió el workspace en
regiones con `data-panel-region` y reemplazaba la que cambiara. Los dos
resuelven lo mismo: que el latido del coordinador —que cambia la marca de la
última sincronización varias veces por minuto— no rearme el tablero.

**La resolución.** Queda **el de regiones**. La franja de estado es la región
`status` y nada más. `patchWorkspaceStatus()` y el contenedor vacío
`data-ops-status` que lo alimentaba se fueron del archivo.

Lo que #90 demostró no se pierde y se amplía: el parche por regiones **dejó de
estar gateado en «Pedidos»**. Gateado, un latido en «Pagos» o en «Alta de
producto» seguía reemplazando esa superficie entera —que es justo lo que el
parche de la franja evitaba en todas las vistas—. Ahora cubre las siete
regiones y todas las vistas del Panel.

### B · La huella por tarjeta y el reloj vivo

**El cruce.** #90 actualiza «hace 9 min» sin reconstruir el tablero. #91
compara cada tarjeta por huella de su marcado. Si la huella incluyera el texto
del reloj, un minuto que pasa cambiaría la huella de las 500 tarjetas a la vez
y la reconciliación —que existe para no tocar lo que no cambió— reemplazaría la
bandeja entera una vez por minuto. O(N) otra vez, disfrazado de «cambió el
marcado».

**La resolución.** `sinRelojVivo()` es **una** función y se aplica a las tres
huellas: la del marcado completo, la de cada región y la de cada tarjeta. Borra
el texto entre `<time … data-elapsed-from …>` y su cierre, y nada más. El texto
lo mantiene al día `paintElapsedTimes()`, que escribe en el nodo de texto y no
toca ningún elemento.

**Medido** (escenario E, abajo): con 500 pedidos, un minuto que pasa reescribe
**500 etiquetas de reloj y toca CERO tarjetas**.

### C · La reconciliación con secciones en el medio

**El cruce.** #91 reconciliaba `workspace → tarjeta`. #90 metió un nivel:
`workspace → sección → tarjeta`.

**La resolución.** Tres niveles, y el del medio con una regla propia:

1. **Regiones** — se comparan por huella; sólo se actualiza la que cambió.
2. **Secciones** — se reconcilian **por presencia y orden, nunca por
   reemplazo**. Las dos listas van al planificador con huella `null` a
   propósito: con huellas iguales no emite un solo «reemplazar».
3. **Tarjetas** — dentro del cuerpo de cada sección, con clave y LIS.

Y el encabezado de cada sección —que es donde vive el **recuento**— se parchea
en su propio nodo, aparte del cuerpo.

**Por qué así, y no de la forma obvia.** Si el encabezado viajara pegado al
cuerpo, aceptar un pedido —que cambia el recuento de «Nuevos» y el de «En
preparación»— reconstruiría **las dos secciones completas**. Con 500 pedidos eso
es casi toda la bandeja. Separados, mover un pedido cuesta: una tarjeta que
sale, una que entra, dos encabezados. **Medido: 2 tarjetas tocadas, con 50 y con
500.**

### D · La preservación del trabajo del operador

No hace falta rescatar lo que no se destruye. La tarjeta que no cambió no se
toca, así que conserva sola su `<details>` abierto, su scroll, su texto a medio
escribir, el cursor y el foco. La que sí cambia trasplanta su borrador
(`trasplantarBorradorDeTarjeta`), y el foco se devuelve **sólo si un reemplazo se
lo llevó** —devolverlo cuando nadie lo perdió sería moverlo por nuestra cuenta—.

### E · `outerHTML` contra «el tablero no recibe hijos nuevos»

**El cruce.** #91 actualizaba cada región con `nodo.outerHTML = markup.trim()`.
El `.trim()` estaba por una razón real: sin él, cada parche dejaba un nodo de
texto suelto, y la región `status` se reescribe una vez por latido.

Pero tapaba la basura sin tapar el hecho de fondo: **el nodo de la región moría
y nacía otro en cada latido**, y eso rompe una propiedad que #90 había medido y
dejado por escrito: «mientras el servidor no cambie nada, el contenedor del
workspace no puede recibir hijos nuevos». Con `outerHTML`, tres latidos en ocho
segundos son tres hijos nuevos.

**La resolución.** `parchearRegion()`: el nodo se queda, se le sincronizan los
atributos —`hidden` de la hoja «Más» y del velo viven ahí— y el interior se
reemplaza **sólo si de verdad es otro**. Los encabezados de sección van por el
mismo camino. Es mejor que las dos versiones: sin hijos nuevos por latido (#90) y
con una sola autoridad de parche (#91).

### F · Dos pruebas que se contradecían

Ninguna estaba mal; cada una medía su mitad.

1. **«un pedido que cambia conserva foco» (#91) pasaba sin probar nada.** El
   campo de motivo ahora vive dentro de un `<details>` que nace cerrado, y un
   `<input>` adentro de un `<details>` cerrado **no es enfocable**:
   `entrada.focus()` no hacía nada y la prueba verificaba que se conservara un
   foco que nunca existió. La prueba ahora abre el detalle con un clic en su
   `<summary>` —lo que hace el operador— y **falla explícitamente** si el campo
   no quedó enfocado.

2. **«sin novedades el tablero NO se reemplaza» (#90) medía en el lugar
   correcto para su versión y en el equivocado para la integrada.** Su
   contraprueba —«no es un tablero congelado»— exigía hijos directos nuevos
   cuando hay novedad; pero un pedido que avanza **ya no reemplaza ningún hijo
   directo**, que es la mejora. Ahora cuenta tarjetas que entran y salen en todo
   el subárbol, y exige las dos cosas a la vez: la tarjeta llega al DOM **y**
   ningún bloque del tablero se reemplaza. La versión quieta también se
   endureció: cero hijos nuevos **y** cero tarjetas tocadas.

---

## 3 · Lo que la integración encontró y arregló

### El Panel de #90 no abría sin red

#90 suma `business-order-tray.js` y `business-order-alerts.js`, y su único
cambio en `sw.js` es el nombre de la caché. Sin red, un import estático que no
está en la caché rompe el grafo entero: el Panel **no abre**. El guard de #91 lo
encontró apenas se juntaron:

```
4 módulo(s) del grafo diferido (panel del negocio) fuera del precache de sw.js.
  · js/business/business-order-tray.js
  · js/business/business-order-alerts.js
  · js/business/business-sound-service.js
  · js/core/service-hours.js
```

### `service-hours.js` faltaba en `main`, no en los PR

El cuarto no es de ninguno de los dos. Entró con el trabajo de 24/7 multi-rubro
(`58b21c4`), que hizo que `business-operations-config.js` lo importe, y nadie lo
agregó al precache. **Falta en `main` desde entonces** y no se veía porque el
guard todavía no cortaba. La integración lo tapa.

### El banco de prueba de #90 mentía a favor

`scripts/business-panel-bench.mjs` generaba sus pedidos con
`00000000-0000-4000-8000-0000000${n}`: **35 caracteres**, último grupo de once
dígitos. El adaptador descarta un `backendId` que no es un UUID, así que el
pedido pierde la identidad con la que el coordinador compara revisiones: la
bandeja se dibuja completa y **nunca se actualiza**.

Un fixture roto que hace fallar la medición se descubre solo. Éste la
falsificaba **a favor**: medir «cuánto cuesta un cambio» daba cero elementos
tocados.

#91 tenía el molde bien y lo había documentado en su propio banco. Estaban
duplicados. Ahora hay **uno solo** (`pedidosSinteticos()` en
`scripts/lib/business-panel-fixtures.mjs`), con una guarda que corta si alguna
vez deja de dar un UUID válido, y `tests/business-panel-bench-fixture.test.mjs`
lo mira —incluido que ningún banco vuelva a componerse el suyo—.

**Los `BENCH-*.json` publicados de #90 no se tocaron.** Son lo que se midió.
`artifacts/taba2-panel-operativo-movil/LEEME.md` dice ahora qué miden
exactamente y qué no se puede concluir de ellos.

---

## 4 · Benchmark

Mismo arnés (`scripts/business-tray-scale-bench.mjs`) para los cuatro tamaños,
390×844, chromium, sondeo forzado a 1200 ms.

### Costo de dibujar la bandeja

| pedidos | elementos | marcado | ms hasta la bandeja |
| ---: | ---: | ---: | ---: |
| 50 | 2.625 | 148 KB | 179 |
| 100 | 5.168 | 288 KB | 219 |
| 300 | 15.297 | 844 KB | 473 |
| 500 | 25.425 | 1,4 MB | 875 |

### Costo de UN cambio — los cinco escenarios

Se cuenta **por columnas**: para cada escenario, los cuatro tamaños tienen que
decir aproximadamente lo mismo.

Los cuatro tamaños en el orden 50 / 100 / 300 / 500.

| escenario | destruidos | creados | movidos | tarjetas tocadas | rearmes | CPU (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A · sin cambio de sección | 59 / 59 / 59 / 59 | 59 / 59 / 59 / 59 | 0 | **2 / 2 / 2 / 2** | 0 | 0 / 55 / 297 / 389 |
| B · cambio de sección | 65 / 65 / 65 / 65 | 60 / 60 / 60 / 60 | 0 | **2 / 2 / 2 / 2** | 0 | 0 / 55 / 231 / 388 |
| C · alta | 9 / 3 / 3 / 43 | 63 / 54 / 56 / 54 | 0 | **1 / 1 / 1 / 2** | 0 | 0 / 60 / 234 / 406 |
| D · baja | 50 / 50 / 50 / 50 | 3 / 3 / 3 / 3 | 0 | **1 / 1 / 1 / 1** | 0 | 0 / 60 / 257 / 678 |
| E · sólo el reloj | 0 / 0 / 6 / 6 | 0 / 0 / 6 / 6 | 0 | **0 / 0 / 0 / 0** | 0 | 0 / 1489 / 5516 / 8989 |

**El criterio se cumple.** Un cambio de un pedido no vuelve a O(N): las tarjetas
reconstruidas son 1 o 2 con 50 pedidos y 1 o 2 con 500. `rearmes` —hijos
directos del workspace reemplazados— es **cero en los veinte casos**. Y la
continuidad —scroll, texto a medio escribir, `<details>` abierto, foco y
cursor— se conserva **en los veinte**.

La única variación digna de mención, explicada:

* **C con 500 destruye 43 y toca 2 tarjetas** en vez de 1. No es un defecto: la
  bandeja está en el tope que sirve el repositorio
  (`MAX_BUSINESS_INBOX_ORDERS = 500`), así que un alta **desaloja** al último —una
  entra, una sale—. Queda registrado en el reporte como `desalojoPorTope: true`,
  y con 50, 100 y 300 es `false`.

Las diferencias chicas en `destruidos` y `creados` (3 vs. 9, 54 vs. 63) son
encabezados de sección que se reescriben o no según cuántas secciones tenga la
bandeja en ese momento. Son elementos sueltos, no tarjetas: la columna que
importa —tarjetas tocadas— no se mueve.

`movidos` es cero en los veinte casos porque ninguno de los cinco escenarios
reordena tarjetas DENTRO de una sección: una tarjeta que cruza de sección cambia
además su contenido, así que se reconstruye —que es lo correcto— en vez de
mudarse. El camino de la subsecuencia creciente más larga, que es el que evita
mover N tarjetas cuando sólo se movió una, está cubierto por
`tests/business-tray-patch.test.mjs`.

**El reloj (E) es el resultado que decide el punto B.** El escenario lleva a
propósito los N pedidos a 3 minutos 45 segundos de antigüedad para que **todos**
crucen el minuto dentro de la ventana de 32 s. El resultado, por tamaño:

| pedidos | etiquetas de reloj reescritas | tarjetas tocadas | elementos destruidos |
| ---: | ---: | ---: | ---: |
| 50 | 50 | **0** | 0 |
| 100 | 100 | **0** | 0 |
| 300 | 303 | **0** | 6 |
| 500 | 503 | **0** | 6 |

Los seis elementos de 300 y 500 son la franja de estado, que cambió una vez
dentro de la ventana. Ninguna tarjeta.

> Ese escenario, mal medido, decía lo contrario. Sin esperar a que la bandeja se
> aquietara antes de abrir la ventana, E se atribuía el repintado de su propia
> preparación —cambiar `created_at` en las N **es** un cambio real de las N— y
> reportaba 25.348 elementos destruidos con 500 pedidos. La conclusión habría
> sido que un minuto que pasa rearma el tablero. El arnés ahora exige dos vueltas
> de sondeo sin movimiento antes de medir, en todos los escenarios.

### Tiempo hasta ver el cambio, y CPU

`ms hasta ver el cambio` está dominado por el intervalo de sondeo (1200 ms) y
diría lo mismo con seis pedidos que con quinientos. Lo que sí escala es el
**tiempo de tarea larga del hilo principal**, que es lo que se siente: mientras
el hilo está ocupado, el toque en «Aceptar pedido» espera.

Comparación contra `main`, con la bandeja llena y **el servidor quieto**
(`scripts/business-panel-cpu-quieto.mjs`, ventana de 32 s):

| pedidos | `main` CPU | integración CPU | `main` tarea más larga | integración tarea más larga |
| ---: | ---: | ---: | ---: | ---: |
| 50 | 0 ms | 0 ms | 0 ms | 0 ms |
| 100 | 4.514 ms (14,1 %) | **1.509 ms (4,7 %)** | 114 ms | 98 ms |
| 300 | 12.428 ms (38,8 %) | **5.198 ms (16,2 %)** | 202 ms | 162 ms |
| 500 | 18.876 ms (59,0 %) | **8.176 ms (25,6 %)** | 571 ms | **285 ms** |

La integración baja el CPU en reposo a menos de la mitad con 300 y 500 pedidos,
y parte al medio la tarea más larga.

**Lo que queda, dicho sin adornos: no es constante.** Sigue creciendo con la
cantidad de pedidos, y no lo introduce esta integración —ninguno de los dos PR
decía resolverlo—. Es la **pasada de marcado**: cada render regenera el marcado
de las N tarjetas para calcular su huella, aunque después no toque ninguna. El
DOM ya no escala; el string todavía sí.

Es el próximo cuello y queda **nombrado, no tapado**: memoizar el marcado por
(identidad, revisión, generación de pagos/riders/atención) lo sacaría, y merece
su propio cambio con su propia evidencia. En producción el sondeo por defecto es
5000 ms, así que el costo real es del orden de una cuarta parte del de la tabla.

---

## 5 · Endurance

500 pedidos, **320 cambios**, con cambios entre secciones y sin mover de
sección, aperturas de detalle, edición de campos, y una ida y vuelta a «Qué
pasa» cada 25 vueltas.

| qué | inicio | final | Δ |
| --- | ---: | ---: | ---: |
| Tarjetas | 500 | 500 | **0** |
| Hijos del workspace *(contando nodos de texto)* | 15 | 15 | **0** |
| Elementos del documento | 26.365 | 27.031 | +666 |
| Nodos del navegador *(CDP, incluye desprendidos)* | — | — | +2.674 |
| Escuchas JS *(CDP, la cuenta autoritativa)* | — | — | **0** |
| Documentos | — | — | **0** |
| Intervalos vivos | 4 | 4 | **0** |
| Observadores DOM | — | — | **−1** |
| `ResizeObserver` / `PerformanceObserver` | — | — | **0** |
| Canales entre pestañas | 2 | 2 | **0** |
| Heap (con recolección forzada) | — | — | **+1,0 MB** |

Y la continuidad, después de los 320 cambios: scroll, texto a medio escribir,
`<details>` abierto, foco y cursor, **los cinco conservados**.

**Los +666 elementos no son una fuga, y no se declara «sin fuga» porque
`querySelectorAll('*')` no creciera** —de hecho creció—. Se explican enteros:
las tarjetas en atención pasaron de **84 a 252** durante la corrida. Los pedidos
envejecen y cruzan los umbrales de 10 y 15 minutos, así que ganan su aviso de
atención, que es interfaz real para estado real. La cuenta de secciones bajó de 5
a 4 por la misma razón: una sección se vació y la reconciliación la dio de baja.

**El heap no gotea: da un escalón y se planta.** Sube en las primeras vueltas
—el escalón de los avisos de atención— y ahí se queda. Leído sobre la corrida
entera, `(último − primero) / ciclos` reparte esa subida inicial entre las 320
vueltas y la hace parecer un goteo. La pendiente de la **segunda mitad** es de
**−42 KB por ciclo** (negativa: baja), contra una oscilación entre muestras
consecutivas de hasta 6,8 MB. Plana dentro del ruido del recolector.

**Cero nodos de texto acumulados** es el número que valida `parchearRegion()`:
los hijos directos del workspace, contando nodos de texto, terminan en 15 igual
que empezaron, después de 320 cambios y de miles de reescrituras de la franja de
estado.

> Sobre las escuchas: el contador ingenuo de la página (envolver
> `addEventListener` / `removeEventListener`) reporta +1.045, y **está mal**. Una
> escucha colgada de un nodo que se descarta se recolecta con el nodo y nunca
> llama a `removeEventListener`. La cuenta autoritativa es la del navegador
> (`Memory.getDOMCounters`): **cero sobre 320 ciclos**. Se dejan las dos en el
> reporte, con el nombre de cada una, porque la diferencia entre ellas es
> justamente el motivo por el que una cuenta ingenua no sirve para declarar que
> no hay fuga.

---

## 6 · Arranque en frío sin red

Verificado desde una instalación fría de verdad, que es lo que la misión pedía y
lo que una prueba mal armada no distingue:

1. Se visita **la tienda**, que no carga el Panel.
2. Se espera a que el service worker termine de instalar y llene el precache.
3. Se comprueba que el grafo del Panel está en la caché **sin haberlo
   visitado** — incluidos los cuatro módulos que faltaban y `sandbox-tools.js`.
4. El borde empieza a tirar **todos** los `.js` con 503.
5. Recién entonces se va al Panel.

Resultado: el Panel abre, la bandeja se dibuja, y **cero respuestas 503** para
cualquier `.js`.

> «Abrí el Panel online y después offline» no sirve como prueba y por eso no se
> usa: el worker cachea al pasar, así que un teléfono que ya abrió el Panel con
> señal lo tiene guardado aunque no esté precacheado. El caso real es el otro y
> es rutina: `precargar()` borra la caché en cada publicación, así que después de
> cada versión lo único guardado es lo que está en la lista.

Se agregó una segunda prueba, **con sesión**, que exige que la bandeja se
dibuje. Que se vea la tarjeta de acceso no alcanza: eso lo dibuja `app.js`, que
está precacheado desde siempre, y una prueba que mire eso pasa aunque el Panel
no abra. (Se comprobó: pasa en `cf793a6`, donde el Panel no está precacheado.)

---

## 7 · Dos pestañas

Las dos pestañas comparten origen, así que comparten IndexedDB y comparten la
cola de comandos. Tocan el **mismo** botón en un instante acordado.

Las cuatro cosas, verificadas:

1. **Una sola operación durable** — el servidor aplicó **1** transición.
2. **Ninguna duplicación** — la revisión subió **una** vez, y las dos pestañas
   mandaron **la misma** clave de idempotencia.
3. **El perdedor reconoce la operación ganadora** — las dos pantallas terminan
   mostrando el pedido en su sección nueva.
4. **Ningún error falso** — el aviso se mira en el **toast**, que es donde
   `app.js` manda las excepciones de la acción.

**La prueba se mira a sí misma.** Si las dos pestañas dejan de solaparse, falla
en vez de pasar en verde midiendo dos acciones consecutivas.

> Con `Promise.all` sobre dos `locator.click()` **no había carrera**: caen a 14
> ms una de otra y en 14 ms la primera ya escribió. Se comprobó que así la prueba
> pasaba igual con el arreglo del outbox puesto y sacado, que es la definición de
> una prueba que no prueba nada. Ahora el clic sale del temporizador de cada
> página desde un instante acordado, y la búsqueda por clave de la segunda se
> demora a propósito para que los dos encolados estén abiertos a la vez.

**Hasta dónde llega esta prueba, dicho con precisión.** El entrelazado que queda
—las dos búsquedas fallando antes de que cualquiera escriba, que es el que
produce el choque contra el índice único— **no se puede fijar desde afuera**:
IndexedDB serializa las transacciones entre pestañas por su cuenta, y demorar el
`onsuccess` demora el manejador, no la transacción. Forzarlo pediría parchear la
aplicación desde la prueba, y entonces la prueba probaría el parche. Ese caso
está cubierto de forma determinista en `tests/business-outbox-continuidad.test.mjs`,
donde el almacenamiento en memoria modela el índice único y el entrelazado se
escribe a mano.

El servidor de prueba ahora modela el **recibo idempotente**, que es lo que hace
durable a una sola operación: sin él, dos envíos subirían la revisión dos veces y
la carrera se estaría midiendo contra un backend que no existe.

---

## 8 · Móvil y accesibilidad

320 · 360 · 390 · 412 · 430 px, más 1366 y 1440 de escritorio. Todo verde:

* cero desborde horizontal en los cinco anchos, y también con el texto al 150 % y
  al 200 %;
* objetivos táctiles de 44 px o más;
* la navegación se recorre con teclado y el foco se ve (`focus-visible`);
* orden semántico: un solo `<h1>` que nombra la herramienta, y cada superficie
  con su `<h2>`;
* el anuncio para lector de pantalla es **una línea** —«2 nuevos · 1 requiere
  atención · 3 en curso»— y no la lista entera: el `aria-live` estaba en el
  contenedor de las tarjetas y cada repintado dictaba el tablero completo;
* Ctrl+F sigue funcionando porque **no se virtualiza**.

**Sobre no virtualizar, con la distinción intacta.** 20.000 nodos estáticos no
son literalmente gratis: tienen costo de memoria, de layout y de árbol de
accesibilidad. Lo que la evidencia demuestra es que **el cuello principal es
reconstruirlos**, no su mera existencia — y eso es lo que este trabajo saca.
Virtualizar rompería Ctrl+F, el orden de tabulación y la lista completa para el
lector de pantalla, y obligaría a medir alturas variables. No hay evidencia nueva
que lo justifique.

---

## 9 · Alcance

**No se tocó**: Mercado Pago, secretos, `business_payment_settings`, alcohol,
precios, stock comercial, catálogo, Rider, checkout del cliente, migraciones ni
contratos fiscales.

**Fiscal**: no se agregó «comprobante fiscal solicitado» a la tarjeta de pedido.
El contrato del backend no representa ese dato por pedido, y agregarlo pediría
una consulta por tarjeta —un N+1 con la bandeja llena—. Queda fuera, y queda
dicho.

---

## 10 · Verificación

| Compuerta | Resultado |
| --- | --- |
| `npm run check` | verde (8 comprobaciones) |
| `npm test` | **2377 / 2377** |
| Pruebas nuevas de #90 | verdes |
| Pruebas nuevas de #91 | verdes |
| Playwright focal del Panel (chromium) | **34 / 34** |
| Suite completa de navegador | *ver el PR* |

Identidad de publicación: `la-taba-runtime-v93-la-bandeja-por-secciones-que-no-se-rearma`,
178 archivos precacheados, CSS a `?v=58` porque `styles/business.css` cambió.
El `@import` de `styles.css` va con el mismo token —lo encontró
`tests/pwa.test.mjs`, que ata la cadena—.

---

## 11 · Evidencia

```
artifacts/taba2-panel-integracion-90-91/
  BANDEJA-integracion.json   los cinco escenarios × 50/100/300/500
  BANDEJA-jornada.json       320 cambios con 500 pedidos
  CPU-QUIETO.json            integración vs. main, con el servidor quieto
```

Para volver a generarlos:

```bash
node scripts/business-tray-scale-bench.mjs --label integracion --pedidos 50,100,300,500
node scripts/business-tray-scale-bench.mjs --label jornada --pedidos 500 --jornada 320 --escenarios no
node scripts/business-panel-cpu-quieto.mjs 500
```

Nada de esto toca Supabase, Mercado Pago ni ARCA: se interceptan las llamadas
del cliente y se contesta con datos inventados.
