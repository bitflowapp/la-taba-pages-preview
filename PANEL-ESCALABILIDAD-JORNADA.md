# Panel del negocio: una jornada completa, con la bandeja llena y mala señal

**Rama**: `claude/business-panel-scalability-itt1zi` · **base**: `cf793a6` (`main`)
**No mergear. No desplegar. No tocar producción.**

Este trabajo NO rehace la bandeja operativa: eso es el PR #90. Toma los riesgos
que #90 dejó anotados y abiertos —el 1, el 3 y el 4— y los cierra con medición.

---

## 0. Resumen en una tabla

| Riesgo abierto de #90 | Qué era en realidad | Cómo quedó |
| --- | --- | --- |
| **1 · el Panel no arranca sin red** (34 imports estáticos fuera del precache) | Real, y peor de lo anotado: eran **35** módulos y **393 KB** | Cerrado. Entran al precache; el guard pasó de aviso a **compuerta** |
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

- Los 35 módulos entraron a `ASSETS` en `sw.js` (137 → 172 archivos
  precacheados). La instalación sigue siendo atómica y validada: si el borde
  está incompleto, el worker anterior sigue activo con su caché intacta.
- `scripts/check-precache-graph.mjs` pasó de **aviso a compuerta**. El aviso
  existía desde antes de #90 y no lo leyó nadie durante meses; dejarlo como
  aviso era garantizar que se rompiera de nuevo con el próximo módulo.
  Verificado a mano: sacando una entrada, `npm run check` corta con el nombre
  del módulo y quién lo importa.

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
6. **`businessPaymentsMarkup()` se sigue calculando y descartando** en cada
   render del workspace. Es O(pagos), no O(pedidos), así que no afecta la
   escalabilidad medida acá; #90 ya lo tenía anotado como limpieza aparte y se
   respetó esa decisión para no cruzar el mismo archivo dos veces.
7. **El banco corre contra un servidor simulado sin WebSocket**, así que realtime
   está caído durante toda la medición y el sondeo de respaldo es el que manda.
   Es el peor caso a propósito —un local con mala señal— y no el típico. Es la
   misma limitación que anotó #90 para su banco.
8. **Los 24 pares de contraste bajo 4,5:1** que anotó #90 en `login` y
   `team-access` siguen ahí. No se tocaron esas superficies.

---

## 12. Archivos y pruebas

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `js/production-operations.js` | El workspace pasa a siete regiones con `data-panel-region`; la tarjeta lleva `data-order-card`; render incremental (`parchearWorkspaceDelNegocio`) con reemplazo por región y reconciliación por tarjeta; el render completo de siempre queda como camino de respaldo y para las otras vistas |
| `js/business/business-command-outbox.js` | La carrera entre dos pestañas devuelve el comando ganador en vez de una excepción; el doble en memoria respeta el índice único de `idempotencyKey` |
| `sw.js` | Los 35 módulos del grafo del Panel entran al precache (137 → 172 archivos); `CACHE_NAME` nuevo |
| `scripts/check-precache-graph.mjs` | El grafo diferido pasó de aviso a **compuerta** |
| `release-identity.json` | Regenerado (`--write`) por el `CACHE_NAME` nuevo |

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
