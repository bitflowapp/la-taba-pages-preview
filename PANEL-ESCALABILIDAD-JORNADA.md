# Panel del negocio: una jornada completa, con la bandeja llena y mala señal

**Rama**: `claude/business-panel-scalability-itt1zi` · **base**: `cf793a6` (`main`)
**No mergear. No desplegar. No tocar producción.**

Este trabajo NO rehace la bandeja operativa: eso es el PR #90. Toma los riesgos
que #90 dejó anotados y abiertos —el 1, el 3 y el 4— y los cierra con medición.

---

## 0. Resumen en una tabla

| Riesgo abierto de #90 | Qué era en realidad | Cómo quedó |
| --- | --- | --- |
| **1 · el Panel no arranca sin red** (34 imports estáticos fuera del precache) | Real, y peor de lo anotado: eran **35** módulos, **y un 36.º que ninguna lectura del código muestra** | Cerrado y **verificado con el navegador**, no por inspección. El guard pasó de aviso a **compuerta** y ahora sigue los imports dinámicos del back office |
| **3 · un pedido que cambia rearma el tablero** (258 ms con 300) | Real, y **mucho** peor de lo anotado: no era UN rearme por cambio, eran **3 a 6** | Cerrado. El costo de un cambio pasó a ser **constante**: 130 elementos, no crezca lo que crezca la bandeja |
| **4 · «comprobante fiscal solicitado» sería un N+1** | **NO era un problema de rendimiento.** El dato no existe: el servidor rechaza facturar un pedido online | Cerrado **no construyéndolo**, con la línea de SQL como prueba |
| — (no estaba anotado) | **Dos pestañas encolaban la misma acción y la segunda moría** contra el índice único | Arreglado: la perdedora relee y devuelve el comando ganador |
| — (no estaba anotado) | **Un defecto que introdujo ESTE trabajo** y se encontró midiendo: el parche por región dejaba un nodo de texto suelto por latido | Arreglado antes de salir, con prueba que lo vigila |

---

## 1. Método

Primero medir, después opinar. El orden fue: auditoría → banco de pruebas →
hipótesis → implementación mínima → banco A/B → pruebas.

El banco nuevo es `scripts/business-tray-scale-bench.mjs`. **No reemplaza al de
#90** (`business-panel-bench.mjs`): aquel mide el tamaño del tablero y cuántas
veces se repinta SIN novedades —la mitad barata, y ya cerrada—. Este mide la
mitad cara, que es la que quedó abierta: **qué cuesta que un pedido cambie de
verdad**, con la bandeja en 50, 100, 300 y 500 pedidos (500 es el tope que sirve
el repositorio, `MAX_BUSINESS_INBOX_ORDERS`).

Corre contra un servidor local con las llamadas interceptadas. No toca Supabase,
Mercado Pago ni ARCA, y no hay un solo dato real en la salida.

### Lo primero que midió el banco fue un defecto del propio banco

Los primeros intentos daban **cero movimiento**: se cambiaba un pedido en el
servidor y la bandeja no se enteraba nunca. No era el Panel. Los pedidos
sintéticos se generaban con

```
id: `00000000-0000-4000-8000-0000000${n}`   // 35 caracteres
```

Un UUID tiene 36. Con el último grupo corto, el adaptador descarta el
`backendId` y el pedido pierde la identidad con la que el coordinador compara
revisiones: la bandeja se dibuja perfecta y **no se actualiza jamás**.

Vale anotarlo porque `scripts/business-panel-bench.mjs`, de #90, genera los
pedidos con la misma línea. No invalida sus números —mide cambios de vista y
repintados ociosos, que no dependen de esto— pero cualquier medición futura de
una ACTUALIZACIÓN sobre ese guion daría cero por este motivo. Está anotado en
«Interacción con #90».

---

## 2. Escalabilidad de la bandeja: qué se midió y qué se encontró

### Antes

| pedidos | elementos del workspace | marcado | ms hasta la bandeja | **elementos destruidos por UN cambio** | **tarjetas tocadas** | rearmes del tablero |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 2.084 | 98 KB | 294 | 12.523 | 600 | 6 |
| 100 | 4.108 | 189 KB | 378 | 24.667 | 1.200 | 6 |
| 300 | 12.171 | 550 KB | 1.552 | 36.519 | 1.800 | 3 |
| 500 | 20.234 | 911 KB | 3.115 | 60.708 | 3.000 | 3 |

Las dos columnas del final son el hallazgo, y son peores que lo que #90 había
anotado. La nota decía «un cambio real de un solo pedido sigue rearmando el
tablero completo». No es completo: es **completo entre tres y seis veces**.
Cada `notify()` del ciclo —el estado del intake, la cola de comandos, el pago
que se refresca— dispara su propio repintado, y cada repintado con 500 pedidos
tira y reconstruye 20.234 elementos.

Con 500 pedidos, **aceptar uno destruía y rearmaba 3.000 tarjetas.**

Y la bandeja tarda 3,1 segundos en aparecer, que es lo que espera una persona
parada en el mostrador después de tocar «Pedidos».

---

## 3. Qué se hizo, y qué se descartó

### Descartado: virtualización

Era la respuesta de moda y habría sido peor. Dibujar sólo lo que entra en
pantalla rompe Ctrl+F, rompe el orden de tabulación, obliga a medir alturas
variables —una tarjeta con seis productos y observaciones no mide como una de
uno— y le saca al lector de pantalla la lista completa. Además ataca el problema
equivocado: 20.234 elementos QUIETOS en el DOM no molestan a nadie. Lo que
duele es **reconstruirlos**.

### Elegido: parche por región + reconciliación por tarjeta con clave

Dos niveles, ninguno inventado:

1. **Por región.** El workspace pasó de ser una sola cadena a siete bloques con
   `data-panel-region`. Se comparan por huella y sólo se reemplaza el que
   cambió. En la práctica el único que cambia solo es `status`, que lleva la
   marca de la última sincronización: mientras formaba parte de una sola cadena,
   ese reloj bastaba para rearmar el tablero entero.
2. **Por tarjeta.** La bandeja se reconcilia con clave (`data-order-card`): la
   tarjeta que no cambió no se toca. Conserva sola su scroll, su `<details>`
   abierto, su texto a medio escribir y el foco, sin necesidad de rescatarlos.

La huella es FNV-1a de 32 bits **sobre el marcado ya generado**, no sobre
«revisión + estado». La diferencia importa: la tarjeta también cambia por cosas
que no son del pedido —los pagos del día, qué riders están en turno, si su
propio botón está en vuelo— y una huella derivada de la revisión del servidor se
perdería todas esas.

### El segundo hallazgo, que apareció midiendo la primera versión

La primera versión bajó las tarjetas tocadas con 500 pedidos de 3.000 a 332.
Buen número, pero **332 no es 2**, y no había explicación.

La medición dijo qué pasaba: exactamente **una** tarjeta cambiaba de marcado,
pero la bandeja se ordena por urgencia, así que un pedido que pasa a «listo»
baja 165 posiciones. El plan ingenuo recorría el destino de adelante hacia atrás
y movía todo lo que no estuviera en su lugar: **166 movimientos**, y para el
navegador cada `insertBefore` es un `remove` más un `insert` de la tarjeta
entera.

Sólo UNA tarjeta se había movido. Las otras 165 quedaron **corridas**, que no es
lo mismo. La subsecuencia creciente más larga separa una cosa de la otra: deja
quietas las tarjetas cuyo orden relativo ya es correcto y mueve sólo las que
rompen la secuencia. Es el mismo paso que usan los frameworks modernos para
listas con clave, y es la diferencia entre 166 movimientos y 1.

### El tercer hallazgo: un defecto que introdujo este mismo trabajo

`nodo.outerHTML = marcado` parsea la cadena entera y reemplaza el nodo por
**todo** lo que produjo, espacios incluidos. Como el marcado de cada región
empieza con un salto de línea y su sangría, cada parche dejaba un nodo de texto
suelto de regalo. La región `status` se reescribe una vez por latido: en una
jornada, miles de nodos huérfanos que **ningún `querySelectorAll('*')` muestra**
—cuenta elementos, no texto— y que sólo se ven en el heap.

Se arregla con `.trim()`. Lo vigila una aserción de la prueba de navegador que
cuenta `childNodes`, no elementos.

---

## 3 bis. Benchmark A/B: el resultado

Mismo guion, misma máquina, mismo navegador, 390×844, realtime caído a
propósito, sondeo cada 1,2 s. Treinta cambios de estado por tamaño.

### Lo que cuesta que UN pedido cambie

| pedidos | elementos destruidos ANTES | DESPUÉS | tarjetas tocadas ANTES | DESPUÉS |
| ---: | ---: | ---: | ---: | ---: |
| 50 | 12.523 | **130** | 600 | **4** |
| 100 | 24.667 | **130** | 1.200 | **4** |
| 300 | 36.519 | **130** | 1.800 | **4** |
| 500 | 60.708 | **108** | 3.000 | **4** |

**El número dejó de depender del tamaño de la bandeja.** Esa es la propiedad
que se buscaba, y es más importante que la mejora puntual: antes, cada pedido
más era trabajo extra en cada cambio; ahora, un cambio cuesta lo mismo con 50
que con 500.

Las 4 tarjetas tocadas son exactamente las que tienen que moverse: la que
cambió (sale y entra) y la que se reubicó por el reordenamiento (sale y entra).
Las otras 498 no se tocan, y por eso conservan solas el scroll, el texto y el
foco.

### Tiempo hasta ver la bandeja

| pedidos | ANTES | DESPUÉS | |
| ---: | ---: | ---: | --- |
| 50 | 294 ms | 237 ms | −19 % |
| 100 | 378 ms | 317 ms | −16 % |
| 300 | 1.552 ms | 483 ms | **−69 %** |
| 500 | 3.115 ms | 875 ms | **−72 %** |

Con la bandeja llena, tocar «Pedidos» pasó de tres segundos largos a menos de
uno.

### Tiempo hasta que el cambio se ve

| pedidos | ANTES | DESPUÉS |
| ---: | ---: | ---: |
| 50 | 1.121 ms | 1.029 ms |
| 100 | 1.283 ms | 1.010 ms |
| 300 | 2.276 ms | 1.107 ms |
| 500 | 2.433 ms | 962 ms |

Con 500 pedidos, el cambio pasó de 2,4 s a menos de 1 s. El piso de ~1 s **no
es el render**: es el sondeo de 1,2 s del banco con realtime caído. O sea que
con 500 pedidos el dibujo dejó de ser el cuello de botella.

### Tamaño del DOM (sin cambios, a propósito)

| pedidos | elementos | marcado |
| ---: | ---: | ---: |
| 50 | 2.084 | 99 KB |
| 100 | 4.108 | 191 KB |
| 300 | 12.171 | 558 KB |
| 500 | 20.234 | 924 KB |

La bandeja sigue completa en el DOM: 500 tarjetas, 20.234 elementos. **Eso es
deliberado** —ver «Descartado: virtualización»—. El aumento de ~1,5 % contra el
estado anterior es el atributo `data-order-card` de cada tarjeta y los siete
`data-panel-region`.

### Continuidad del trabajo del operador

En los cuatro tamaños, con alguien scrolleado, escribiendo un motivo de
cancelación y con el foco puesto, mientras OTRO pedido cambia en el servidor:

| | antes | después |
| --- | --- | --- |
| scroll conservado | sí | sí |
| texto a medio escribir | sí | sí |
| posición del cursor | sí | sí |
| foco | sí | sí |

Se conservaban antes también: el Panel ya rescataba y devolvía los borradores a
mano. La diferencia es que **ahora no hay nada que rescatar**, porque la tarjeta
no se destruye. El rescate quedó para el render completo, que sigue existiendo
para las otras vistas.

---

## 4. Arranque con red degradada (riesgo 1 de #90)

### Qué era

`production-operations.js` estaba en el precache desde hacía tiempo, pero llega
por import **dinámico** y sus imports **estáticos** no estaban. Sin red eso no
degrada: el navegador no puede resolver un import estático que no está en la
caché, el grafo se cae entero y **el Panel no abre**. El comercio se queda sin
la herramienta con la que trabaja justo cuando peor está la señal.

La auditoría del grafo dio **35 módulos y 393 KB** (la nota de #90 decía 34; la
diferencia es el módulo nuevo de este trabajo). Los más pesados:
`business-operations-center.js` (128 KB), `business-panel-render.js` (42 KB),
`business-operation-language.js` (27 KB).

### Qué significa «sirve sin red» acá, y qué NO

Esto es lo que se decidió deliberadamente **no** hacer: convertir la aplicación
en offline-first. Lo que se puede sostener con lo que hoy existe:

| Sin red, el Panel… | ¿Anda? | Por qué |
| --- | --- | --- |
| **abre** | sí, ahora | el grafo entero está en caché |
| muestra el **estado de la conexión** | sí | es estado local del coordinador |
| muestra la **cola de comandos pendientes** | sí | es durable: vive en IndexedDB |
| muestra **los pedidos que ya tenía en pantalla** | sí, si la pestaña siguió viva | están en memoria |
| muestra los pedidos **después de recargar** | **no**, y está bien | nunca se guardaron localmente; inventar una copia local de la bandeja es inventar autoridad |
| **acepta, prepara, despacha** | encola, no confirma | fail-close: clave de idempotencia + revisión esperada, y nada se da por hecho hasta que el servidor confirma |

### Qué se cambió

- Los 35 módulos entraron a `ASSETS` en `sw.js`. La instalación sigue siendo
  atómica y validada: si el borde está incompleto, el worker anterior sigue
  activo con su caché intacta.
- `scripts/check-precache-graph.mjs` pasó de **aviso a compuerta**. El aviso
  existía desde antes de #90 y no lo leyó nadie durante meses; dejarlo como
  aviso era garantizar que se rompiera de nuevo con el próximo módulo.

### Y con los 35 adentro, el Panel SEGUÍA sin abrir

Acá está la parte que importa del método, porque leyendo el código la deuda
estaba saldada. Con el worker encendido, la caché caliente y el borde
contestando 503 a todos los módulos, el Panel **no abría igual**, y el
navegador dijo por qué en una línea:

```
503 /js/sandbox-tools.js
```

`cargarBackOffice()` pide cuatro módulos con **un solo `Promise.all`**:
`business.js`, `delivery.js`, `production-operations.js` y `sandbox-tools.js`.
Si uno falla, la promesa entera se rechaza y el back office no entra. O sea que
el Panel del comercio no abría por **9 KB de una herramienta de demostración**
que no tiene nada que ver con vender.

Es invisible para el guard por construcción: el recorrido parte de lo que ya
está en la lista, y `sandbox-tools.js` no estaba, así que nadie lo recorría. Y
es invisible leyendo, porque `import()` dinámico parece diferido y opcional —y
dentro de un `Promise.all` no es ninguna de las dos cosas—.

Dos cambios, los dos chicos:

- `js/sandbox-tools.js` entró al precache (137 → **173** archivos).
- El guard ahora **sigue los imports dinámicos de `back-office.js`** y exige que
  los cuatro estén en la lista. Un quinto módulo en ese grupo ya no puede pasar
  desapercibido.

### La verificación

Verificado a mano en los dos sentidos, y automatizado en los dos:

| | resultado |
| --- | --- |
| Sacando una entrada del precache | `npm run check` corta y nombra el módulo y quién lo importa |
| El guard contra el árbol base `cf793a6` | corta, y nombra `js/sandbox-tools.js` |
| Con el borde en `js-503`, en esta rama | el Panel entra completo: **cero pedidos fallidos**, la región de alta se dibuja |
| La misma prueba contra `cf793a6` | falla: 4 de 5 módulos del Panel ausentes del precache |

La prueba de navegador **no mira si se ve la tarjeta de acceso**, y eso importa:
`app.js` la muestra por modo de aplicación y `app.js` siempre entra, así que esa
aserción pasa aunque el Panel esté caído. Se comprobó. Lo que mira es la región
de alta autogestionada, que sólo puede escribirla el módulo del Panel.

---

## 5. Datos fiscales: el riesgo 4 no era un riesgo de rendimiento

#90 lo anotó como «pedirlo por tarjeta sería un N+1 por repintado», y la
conclusión fue no mostrarlo por ahora. La investigación dice que la razón real
es otra, y más definitiva.

**El N+1 no hacía falta.** `listDocuments()` ya trae hasta 500 comprobantes del
comercio en **una** consulta, con `source_type` y `source_id`. Un `Set` de ids
alcanzaba: cero consultas por tarjeta.

**Pero el dato no existe.** En `20260802170000_fiscal_document_closure.sql`,
dentro de `request_fiscal_document`:

```sql
if p_source_type <> 'pos_sale' then
  raise exception 'facturacion online requiere politica fiscal validada' using errcode='P0001';
end if;
```

`online_order` está en la restricción de la tabla, pero **el servidor lo
rechaza**. No hay ninguna migración posterior que lo habilite, y en todo el
cliente el único llamador pide `source_type: 'pos_sale'` (el mostrador).

O sea: hoy **ningún pedido de la bandeja puede tener un comprobante fiscal
solicitado**. Una señal en la tarjeta sería un N+0 que siempre devuelve nada, o
peor, una promesa visual de algo que el servidor no autoriza.

**Decisión: no se construye.** De la lista de preferencias del pedido —join,
snapshot agregado, dato derivado, o no mostrarlo— corresponde la última, y no
por costo: por autoridad. Cuando el negocio habilite facturación de pedidos
online, el camino barato ya está identificado (`listDocuments()` una vez por
refresco, indexado por `source_id`) y queda escrito acá.

---

## 6. Cola offline: qué se verificó, y el defecto que apareció

Se ejercitaron los seis escenarios del pedido, con un servidor de mentira que
respeta la clave de idempotencia igual que el real. Así «cuántas veces se envió»
y «cuántas veces se **aplicó**» son dos números distintos, y el que se mide es
el segundo.

| Escenario | Resultado |
| --- | --- |
| Se corta la red a mitad del toque | Queda **pendiente**, nunca confirmada, con reintento programado. Cero aplicaciones |
| Se recarga con un envío en vuelo | Se reconcilia antes de reenviar: **cero reenvíos**, una sola aplicación |
| Respuesta ambigua (el servidor aplicó y la respuesta se perdió) | El reintento **pregunta** en vez de reenviar: una sola aplicación |
| Backend lento, dos drenajes en la misma pestaña | El segundo se suma al primero: **un** envío |
| Vuelve la conexión | El reintento con backoff confirma. Una sola aplicación |
| Conflicto de revisión (otro operador movió el pedido) | Se detiene en `conflicted` y **espera a una persona**. No reintenta |
| **Dos pestañas en el mostrador** | **Fallaba** (ver abajo). Ahora: una sola acción encolada, una sola aplicación |

### El defecto de las dos pestañas

La cola serializa el encolado **de su pestaña**. El almacenamiento, en cambio,
es de todo el origen. Dos pestañas abiertas tienen cada una su propia cadena y
las dos pueden pasar el `findByIdempotencyKey` antes de que cualquiera escriba:
la segunda choca contra el índice único de IndexedDB y ese choque viajaba como
excepción **hasta la acción del operador**. La pantalla decía que falló algo que
en realidad ya estaba encolado y en camino.

No producía una acción doble —para eso está la clave determinista— pero sí un
error mentiroso en el peor momento.

Arreglo: cuando la escritura choca, se relee por clave de idempotencia y se
devuelve el comando ganador. Es el mismo replay que ya devolvía el otro camino.
Si no hay ganador, el error era otro y viaja.

**Y por qué no se había visto**: el doble de almacenamiento en memoria que usan
las pruebas no tenía el índice único que sí tiene IndexedDB. Se le agregó: una
prueba con almacenamiento en memoria ahora significa lo mismo que el camino
real.

---

## 7. Qué quedó automatizado y qué sigue exigiendo una persona

Este trabajo **no automatizó ninguna decisión nueva**. Lo que hizo fue abaratar
el dibujo y asegurar el arranque. La frontera no se movió, y conviene dejarla
escrita.

### Automático (y ya lo era)

| Qué | Dónde |
| --- | --- |
| Entrada de pedidos por realtime, con sondeo de respaldo | `business-order-intake.js` |
| Descarte de snapshots atrasados por revisión | `reconcileBusinessOrderSnapshot` |
| Reintento con backoff de la cola de comandos | `business-command-outbox.js` |
| Recuperación al reconectar, al volver del fondo y al recargar | `setupLifecycleRecovery` |

### Automático y **nuevo en este trabajo** (todo es dibujo, ninguna decisión)

| Qué | Dónde |
| --- | --- |
| Decidir qué tarjetas reemplazar, mover, insertar o quitar | `business-tray-patch.js` |
| Reemplazar sólo la región del workspace que cambió | `parchearWorkspaceDelNegocio` |
| Servir el grafo del Panel desde caché cuando la red no contesta | `sw.js` |
| Devolver el comando ganador cuando otra pestaña ganó la carrera | `business-command-outbox.js` |

### Sigue siendo humano, y no se tocó

Aceptar, cancelar con motivo, ofrecer o reasignar repartidor, devoluciones y
cancelaciones con impacto económico, emisión o autorización fiscal, apertura y
cierre de jornada, precios, stock y habilitación de cobros. **Nada de eso se
automatizó, ni se hizo más fácil de disparar sin querer.** Un conflicto de
revisión sigue frenando y esperando a una persona.

---

## 8. Interacción con #90 (y con los otros PR abiertos)

Todos los PR abiertos (#90, #89, #83, #41) salen de `cf793a6`. Esta rama
también.

### Cruces reales

| Archivo | #90 | Este trabajo | Integración |
| --- | --- | --- | --- |
| `js/production-operations.js` | reescribe el render y la tarjeta | reescribe el render y la tarjeta | **sustantivo**, ver abajo |
| `sw.js` | una línea: `CACHE_NAME` | esa línea **y** el bloque de `ASSETS` | trivial: se queda un nombre |
| `release-identity.json` | regenerado | regenerado | trivial: `node scripts/check-release-identity.mjs --write` |
| `scripts/preflight-staging-package.mjs` | literal del `CACHE_NAME` | el mismo literal | trivial: viaja con `sw.js` por diseño |
| `tests/github-pages.test.mjs` | literal del `CACHE_NAME` | el mismo literal | trivial: ídem |

Los últimos cuatro son el mismo cruce contado cuatro veces: el `CACHE_NAME` está
escrito en cuatro lugares a propósito —dos pruebas lo exigen— así que cualquier
cambio del grafo de precache los toca todos. Se resuelve eligiendo un nombre y
corriendo `--write`.

Archivos que toca este trabajo y **no** toca ningún otro PR:
`js/business/business-command-outbox.js`, `scripts/check-precache-graph.mjs`, y
todo lo nuevo.

### Cómo integrar el cruce sustantivo, en concreto

No mezclar a ciegas. Tres puntos, y los tres se resuelven en el mismo sentido:

1. **`patchWorkspaceStatus()` de #90 sobra.** Hace por caso especial —vaciar el
   contenedor de estado en el marcado y llenarlo aparte— lo que acá hace el
   parche por región para las siete regiones. Al integrar: conservar el parche
   por región y dar de baja el caso especial.
2. **El reloj vivo de #90 necesita entrar en la huella de la tarjeta, no en la
   del tablero.** #90 enmascara `<time data-elapsed-from>` con
   `markupFingerprint()` sobre el marcado completo. Con reconciliación por
   tarjeta, esa máscara tiene que aplicarse dentro de `huellaDeMarcado()` para
   las tarjetas; si no, el minuto que pasa marca como sucia a cada tarjeta y
   devuelve el problema por la ventana.
3. **Las secciones de `business-order-tray.js` cambian la estructura de la
   lista.** El reconciliador asume que las tarjetas son hijas **directas** de
   `[data-order-list]`. Si #90 las agrupa en contenedores por sección, hay que
   reconciliar por contenedor (una llamada por sección, misma función) o marcar
   cada sección como su propia región. **No** hay que abandonar la
   reconciliación: la sección es un nivel más, no un obstáculo.

Además, `scripts/business-panel-bench.mjs` de #90 genera UUID de 35 caracteres
(ver §1). Conviene corregirlo al integrar, aunque sus números publicados no
dependan de eso.

Nada de esto se resolvió acá: la rama queda lista para rebase, no mezclada.

---

## 9. Prueba prolongada y memoria

**500 pedidos · 300 cambios de estado seguidos · 12 idas y vueltas a «Qué
pasa» y de vuelta · recolección de basura forzada en cada muestra.** Es el
peor caso: la bandeja en el tope que sirve el repositorio, realtime caído todo
el tiempo y el sondeo de respaldo trabajando.

| ciclo | heap (MB) | elementos del documento | hijos del workspace (con texto) | tarjetas |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 10,71 | 21.165 | 13 | 500 |
| 50 | 15,05 | 21.165 | 13 | 500 |
| 100 | 13,49 | 21.165 | 13 | 500 |
| 150 | 19,11 | 21.165 | 13 | 500 |
| 200 | 19,06 | 21.165 | 13 | 500 |
| 250 | 19,14 | 21.165 | 13 | 500 |
| 300 | 19,09 | 21.165 | 13 | 500 |

**Elementos del documento: 21.165 al principio y 21.165 al final. Cero
crecimiento en 300 cambios.** Lo mismo los hijos directos del workspace
contando nodos de TEXTO —13 y 13—, que es la medida que destapa el defecto de
`outerHTML` sin recortar. Y 500 tarjetas al final: ni una duplicada, ni una
perdida.

El heap sube de 10,7 a 19,1 MB **y ahí se queda**: entre el ciclo 150 y el 300
la diferencia es de −0,02 MB. No es una fuga, es el calentamiento del proceso
llegando a su meseta. Promediar los 300 ciclos daría «29 KB por ciclo» y sería
un número falso: todo el aumento pasa en la primera mitad y después la curva es
plana.

### Qué se auditó buscando fugas

Temporizadores, escuchas, suscripciones, `BroadcastChannel` y observadores del
Panel, uno por uno:

| Qué | Se apaga en | Estado |
| --- | --- | --- |
| Sondeo del coordinador de pedidos | `stop()` del coordinador | limpio |
| Escuchas de ciclo de vida (`online`, `offline`, `pageshow`, `visibilitychange`) | `lifecycleStops` en `stop()` | limpio |
| `BroadcastChannel` entre pestañas | `stop()` | limpio |
| Refresco de pagos (15 s) | `stopPaymentRefresh`, y en `clearProductionOrders` al cerrar sesión | limpio |
| Refresco del centro de operación (30 s) | `stopOperationCenterRefresh` al cambiar de vista y al reconfigurar; sólo se re-arma si la vista sigue siendo esa | limpio |
| Suscripción del escáner | `unsubscribeScanner` | limpio |
| Controlador de GPS | `destroy()` | limpio |
| Escuchas del DOM en las tarjetas | no existen: el Panel usa delegación de eventos | **por eso reemplazar tarjetas no filtra escuchas** |

No se encontró ninguna fuga preexistente. La única que apareció la introdujo
este trabajo (§3, nodos de texto) y se cerró antes de salir.

---

## 10. Mobile: verificado contra el estado anterior, no de memoria

`scripts/business-panel-responsive.mjs` corrido dos veces —una en `cf793a6`, en
un worktree aparte, y otra en esta rama— sobre «Pedidos» y «Qué pasa», en los
once anchos del guion.

| | base `cf793a6` | esta rama |
| --- | ---: | ---: |
| desborde horizontal | 0 | **0** |
| áreas táctiles < 44 px | 0 | **0** |
| pares de contraste < 4,5:1 | 0 | **0** |
| errores | 0 | **0** |

Y la densidad de información, que es lo que se puede empeorar sin que nadie
avise:

| ancho | alto del encabezado | alto de la tarjeta | pedidos enteros a la vista |
| --- | ---: | ---: | ---: |
| 360×740 | 271 → 271 | 413 → 413 | 1 → 1 |
| 375×812 | 271 → 271 | 413 → 413 | 1 → 1 |
| 390×844 | 271 → 271 | 395 → 395 | 1 → 1 |
| 393×851 | 271 → 271 | 395 → 395 | 1 → 1 |
| 412×915 | 249 → 249 | 395 → 395 | 1 → 1 |
| 430×932 | 249 → 249 | 395 → 395 | 1 → 1 |
| 768×1024 | 218 → 218 | 372 → 372 | 1 → 1 |
| 1440×900 | 408 → 408 | 426 → 426 | 1 → 1 |

**Once anchos, cero diferencias.** Era lo esperable —este trabajo no toca una
sola regla de CSS ni una sola clase— pero «esperable» no es «medido».

Sobre **320 px**: el guion de este repositorio empieza en 360. El ancho de 320
lo agrega #90 a su prueba de navegador, y duplicarlo acá sería rehacer su
trabajo. Como esta rama no cambia CSS ni clases, el resultado a 320 es el mismo
que el de la base; la cobertura permanente de ese ancho queda en #90.

---

## 11. Riesgos que quedan abiertos

1. **La bandeja sigue sin sobrevivir a una recarga sin red.** El Panel ahora
   abre, pero los pedidos nunca se guardaron localmente: recargando sin señal, la
   bandeja arranca vacía y lo dice. Guardar un espejo local de la bandeja es un
   trabajo propio, con su propia decisión de autoridad —qué se puede mostrar de
   algo que no se pudo revalidar— y no se hizo acá por eso.
2. **El grafo del Panel entró entero al precache atómico.** Son 393 KB más en un
   `addAll` que es todo-o-nada. Si el borde sirve mal UN módulo del Panel, ahora
   falla la instalación completa del worker y el anterior sigue activo con su
   caché vieja. Es el comportamiento correcto —mejor la versión anterior entera
   que una mezcla— pero la superficie de fallo de instalación creció.
3. **La huella de tarjeta es un hash de 32 bits.** Una colisión dejaría una
   tarjeta sin repintar. La probabilidad es despreciable —el largo del marcado
   entra en la huella, así que dos marcados de largo distinto no pueden
   colisionar— pero no es cero. La alternativa era guardar el marcado completo
   de cada tarjeta: con 500 pedidos, ~900 KB retenidos permanentemente en el
   teléfono del mostrador. Se eligió el hash y se anota.
4. **Se sigue construyendo el marcado de las 500 tarjetas en cada render.** Lo
   que se ahorró es el DOM —parsear, maquetar, recalcular estilo— que era el
   costo dominante. Armar las cadenas quedó, y es lo que explica el piso de
   tiempo que todavía se ve con 500. Memoizar por pedido es posible pero exige
   una huella de entrada barata y confiable; no se hizo sin necesidad medida.
5. **Dos pestañas pueden enviar el mismo comando en paralelo.** La cola no toma
   un lock entre pestañas: sólo el encolado quedó a salvo. El envío duplicado lo
   absorbe la clave de idempotencia del servidor, que es la garantía real, pero
   el gasto de red doble existe. `Web Locks` está disponible y sería el próximo
   paso si molesta.
6. **El Panel sigue dependiendo de que cargue una herramienta de sandbox.** Se
   resolvió precacheando los 9 KB, que es el arreglo chico y verificable. El
   arreglo bueno es que `cargarBackOffice()` no ate la disponibilidad del Panel
   del comercio a `sandbox-tools.js`: hoy un `Promise.all` de cuatro hace que
   cualquiera de los cuatro pueda voltear los otros tres. Toca `back-office.js`,
   que es compartido con el cliente, y merece su propio cambio. Mientras tanto,
   el guard impide que la lista se desincronice.
7. **`businessPaymentsMarkup()` se sigue calculando y descartando** en cada
   render del workspace. Es O(pagos), no O(pedidos), así que no afecta la
   escalabilidad medida acá; #90 ya lo tenía anotado como limpieza aparte y se
   respetó esa decisión para no cruzar el mismo archivo dos veces.
8. **El banco corre contra un servidor simulado sin WebSocket**, así que realtime
   está caído durante toda la medición y el sondeo de respaldo es el que manda.
   Es el peor caso a propósito —un local con mala señal— y no el típico. Es la
   misma limitación que anotó #90 para su banco.
9. **Los 24 pares de contraste bajo 4,5:1** que anotó #90 en `login` y
   `team-access` siguen ahí. No se tocaron esas superficies.

---

## 12. Archivos y pruebas

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `js/production-operations.js` | El workspace pasa a siete regiones con `data-panel-region`; la tarjeta lleva `data-order-card`; render incremental (`parchearWorkspaceDelNegocio`) con reemplazo por región y reconciliación por tarjeta; el render completo de siempre queda como camino de respaldo y para las otras vistas |
| `js/business/business-command-outbox.js` | La carrera entre dos pestañas devuelve el comando ganador en vez de una excepción; el doble en memoria respeta el índice único de `idempotencyKey` |
| `sw.js` | Los 35 módulos del grafo del Panel **más `sandbox-tools.js`** entran al precache (137 → **173** archivos); `CACHE_NAME` nuevo |
| `scripts/check-precache-graph.mjs` | El grafo diferido pasó de aviso a **compuerta**, y ahora sigue los imports dinámicos de `back-office.js` |
| `release-identity.json` | Regenerado (`--write`) por el `CACHE_NAME` nuevo |
| `scripts/preflight-staging-package.mjs` · `tests/github-pages.test.mjs` | El literal del `CACHE_NAME`, que viaja con `sw.js` por diseño |

### Nuevos

| Archivo | Qué es |
| --- | --- |
| `js/business/business-tray-patch.js` | El plan de reconciliación (puro) y su aplicador sobre el DOM (tonto). Incluye la subsecuencia creciente más larga |
| `scripts/business-tray-scale-bench.mjs` | El banco: 50/100/300/500 pedidos, costo de UN cambio, continuidad y jornada larga |
| `tests/business-tray-patch.test.mjs` | 11 pruebas del plan |
| `tests/business-outbox-continuidad.test.mjs` | 7 pruebas de la cola en situaciones de jornada |
| `tests/e2e/panel-escalabilidad.spec.mjs` | 2 pruebas de navegador: arranque sin red y continuidad de la bandeja |
| `artifacts/taba2-panel-escalabilidad/` | Los resultados crudos, antes y después |

### Pruebas agregadas: 20

**`business-tray-patch.test.mjs` (11)** — sin cambios no hay operaciones · un
pedido que cambia reemplaza UNA tarjeta con 300 en la bandeja · alta en su
posición · alta al final · baja · reordenamiento que mueve una sola tarjeta ·
**el caso de 500 con un pedido que baja 165 posiciones y mueve UNA** · prueba de
propiedad con cien barajadas al azar contra un DOM mínimo · clave repetida ·
huella · listas vacías.

**`business-outbox-continuidad.test.mjs` (7)** — dos pestañas · corte de red a
mitad del toque · recarga con envío en vuelo · respuesta ambigua · backend lento
· reconexión con backoff · conflicto de revisión.

**`tests/e2e/panel-escalabilidad.spec.mjs` (2)** — el Panel entra con el borde
tirando todos los módulos (worker real, caché caliente, `js-503`), verificando
además que el grafo esté guardado · con 300 pedidos, un cambio conserva scroll,
borrador, cursor y foco, toca a lo sumo 12 tarjetas y **no deja nodos sueltos**.

---

## 13. Resultados completos

### Compuertas

| | resultado |
| --- | --- |
| `npm run check` | **verde** · 102 módulos del grafo del cliente y 48 del diferido, todos en `sw.js` · 173 archivos precacheados · sin secretos |
| `npm test` | **2.284 / 2.284** |
| Playwright chromium · superficies del Panel productivo | **31 / 31** |

Las 31 son todas las pruebas de navegador que tocan el workspace del Panel
productivo: `business-intake-reliability`, `business-windows-operations`,
`honesty-mode`, `panel-responsive` y las dos nuevas. Entre ellas, las tres que
más podían romperse con este cambio:

- «el Panel no le borra al operador lo que está escribiendo»,
- «la hoja de “Más” sobrevive a que entre un pedido» —que es exactamente el
  parche por región—,
- «el foco se ve y recorre la navegación con teclado».

Y el Panel sigue sin desbordar a 360/390/412/430 px, con el texto al 150 % y al
200 %.

Las dos pruebas que fallaron en la primera corrida completa —`github-pages` y
`preflight-staging-package`— eran el literal del `CACHE_NAME` en dos archivos
que tienen que viajar con `sw.js` por diseño. Se actualizaron y quedaron en
verde. No eran regresiones: son la compuerta funcionando.

### Los números, uno al lado del otro

| | 50 | 100 | 300 | 500 |
| --- | ---: | ---: | ---: | ---: |
| elementos del workspace | 2.084 | 4.108 | 12.171 | 20.234 |
| marcado | 99 KB | 191 KB | 558 KB | 924 KB |
| **elementos destruidos por un cambio · antes** | 12.523 | 24.667 | 36.519 | 60.708 |
| **elementos destruidos por un cambio · después** | **130** | **130** | **130** | **108** |
| **tarjetas tocadas · antes** | 600 | 1.200 | 1.800 | 3.000 |
| **tarjetas tocadas · después** | **4** | **4** | **4** | **4** |
| ms hasta la bandeja · antes | 294 | 378 | 1.552 | 3.115 |
| ms hasta la bandeja · después | **237** | **317** | **483** | **875** |
| ms hasta ver el cambio · antes | 1.121 | 1.283 | 2.276 | 2.433 |
| ms hasta ver el cambio · después | **1.029** | **1.010** | **1.107** | **962** |

Jornada larga (500 pedidos, 300 cambios, 12 cambios de vista): **elementos del
documento 21.165 → 21.165**, hijos del workspace **13 → 13**, tarjetas **500**,
heap con meseta en 19,1 MB desde el ciclo 150.

Los datos crudos están en `artifacts/taba2-panel-escalabilidad/`:
`BANDEJA-antes.json`, `BANDEJA-despues.json`, `BANDEJA-jornada.json`.

### Cómo reproducir

```
npm ci && npx playwright install chromium
node scripts/business-tray-scale-bench.mjs --label lo-que-sea
node scripts/business-tray-scale-bench.mjs --label jornada --pedidos 500 --jornada 300
npm run check && npm test
npx playwright test tests/e2e/panel-escalabilidad.spec.mjs
```

Para el «antes», el mismo guion sobre un worktree en `cf793a6`.

---

## 14. Lo que este trabajo NO tocó

Mercado Pago · secretos · `business_payment_settings` · alcohol · precios ·
stock comercial · catálogo · Rider · checkout del cliente · contratos fiscales ·
migraciones. Cero migraciones nuevas: no apareció ninguna necesidad
arquitectónica que las pidiera, y la investigación fiscal terminó **leyendo**
una migración existente para concluir que no había nada que construir.

No se automatizó ninguna decisión irreversible. No se desplegó nada. No se tocó
producción. El PR queda abierto y sin mergear.
