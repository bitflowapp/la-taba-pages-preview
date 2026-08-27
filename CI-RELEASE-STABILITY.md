# Estabilidad de CI y de despliegue

Misión del 2026-08-27 sobre `main = 820ad4e` (runtime de producción v91).
Objetivo: que un release sano deje de fallar, **sin aflojar ninguna compuerta**.
No se tocó umbral, ni reintentos globales, ni se silenció ni excluyó nada.

El problema no era que CI fuera demasiado estricto. Era que CI **no medía lo que
decía medir** en cinco lugares distintos, y las cinco veces el error empujaba
hacia el mismo lado: rojo cuando el producto estaba bien.

---

## A · El despliegue quedaba rojo con producción perfecta

`wrangler pages deploy` vuelve cuando el deployment terminó de subir, **no**
cuando `la-taba.pages.dev` lo apunta. En el medio —segundos— el alias sigue
sirviendo el despliegue anterior, entero y coherente consigo mismo.

El 2026-08-27 el paso `Smoke en vivo` corrió **un segundo** después de publicar,
leyó `31c900b`/v90 esperando `820ad4e`/v91, y dejó en rojo un despliegue que
estaba bien. El mismo guion, a mano y sin cambiar nada, daba verde minutos
después.

El nombre del parámetro —`--esperar-commit`— prometía una espera que el código
no hacía: era **una sola mirada**.

**Ahora:** `esperarConvergencia()` consulta cada 5 s hasta 180 s, y registra por
intento el número de vuelta, el tiempo transcurrido, el SHA observado y el
esperado. Vencer el techo **no** da verde: baja como fallo real.

**Lo que NO se hizo:** un `sleep` fijo. Nadie sabe cuánto tarda la propagación, y
un número generoso paga el peor caso en CADA release para cubrir el que casi
nunca pasa —y si algún día tarda un segundo más, vuelve el rojo—.

**Y se reintenta sólo lo que una propagación puede causar.** Un runtime-config
apuntando a staging, un catálogo que no contesta o un shell que no llega no
mejoran esperando: fallan en el primer intento, sin gastar el plazo. Ésa es la
diferencia entre esperar una propagación y tapar un error.

**Se agregó `--esperar-runtime`,** que antes no se comprobaba contra nada
externo. El commit dice qué código se construyó; el runtime es el nombre de la
caché del service worker, o sea lo que decide si al visitante le llega la versión
nueva o la que ya tenía guardada. Un artefacto con el commit correcto y el
runtime viejo se publica sin que nadie lo note y no invalida ninguna caché.

---

## B · Las cuatro pruebas inestables

Ninguna se arregló tocando el umbral. Las cuatro tenían una causa concreta, y en
una de ellas la causa **era un defecto del producto**.

### 1 · `business-windows-operations` — DEFECTO DEL PRODUCTO

El mostrador se redibuja entero con cada cambio, y también cuando termina un
refresco fiscal que arrancó solo. El carrito sobrevivía —vive en el estado del
módulo— pero el tilde de «Solicitar comprobante fiscal» vivía **sólo en el
marcado**, así que cualquier repintado lo borraba.

En silencio. Sin aviso. Con el checkbox mostrándose destildado como si la persona
nunca lo hubiera tocado, y la venta confirmándose **sin el comprobante que había
pedido**.

En CI aparecía como inestable porque el refresco fiscal caía a veces antes y a
veces después del clic. La inestabilidad era el síntoma; el defecto es que una
decisión del operador se perdía sola.

El archivo ya tenía el cuidado exacto para esto, aplicado a otra cosa: *«La frase
de autorización se conserva para que un refresco no la borre a mitad de
escribirla»*. Al checkbox nunca se lo aplicaron.

**Arreglo:** la elección vive en el estado del módulo (`posRequestFiscal`), se
dibuja tildada si lo está, se lee del estado —no del marcado— al confirmar, y se
limpia junto con el borrador. Se agregó un test que provoca el repintado a
propósito (un segundo escaneo, que es además lo que hace cualquiera que carga dos
artículos) y comprueba las dos mitades: que el tilde se ve, y que
`p_request_fiscal: true` viaja de verdad al servidor.

### 2 · `panel-responsive` — el `NaN` no era un problema visual

`getComputedStyle` sobre un nodo **desconectado** no falla: devuelve cadenas
vacías. Medido:

| | `outlineWidth` | `outlineStyle` | `parseFloat` |
|---|---|---|---|
| conectado | `"3px"` | `"solid"` | `3` |
| desconectado | `""` | `""` | `NaN` |

El workspace se repinta solo —lleva la marca de la última sincronización— y
desconectaba el botón entre que se resolvía el localizador y se lo medía.

Lo importante es que fallaba **la mitad menos grave**: `outlineWidth` daba `NaN`
y saltaba, pero `outlineStyle` daba `""`, que **no** es `'none'`, así que la
comprobación del estilo pasaba sin haber mirado nada. La prueba estaba medio
ciega y el rojo lo daba la otra mitad.

**Arreglo:** se informa la desconexión y se vuelve a medir sobre el nodo nuevo.
Y el foco se establece con una pulsación de teclado real antes del `focus()`: el
anillo lo pinta `:focus-visible`, que sólo aparece cuando el navegador cree que
la persona vino por teclado —que es, además, lo que el título de la prueba dice
que se está probando—.

### 3 · `pwa-update-lifecycle` — se preguntaba mientras el mundo cambiaba

«Actualizar ahora» dispara `skipWaiting()`, y el `controllerchange` que sigue
**recarga la pestaña**. Leer `sessionStorage` justo después corría contra esa
navegación: si la pregunta caía en el medio, el contexto de ejecución ya no
existía.

**Arreglo:** `sessionStorage` sobrevive a la recarga, así que se vuelve a
preguntar hasta que la página esté de nuevo en pie. Tolerar esa excepción no
afloja nada: el número sigue teniendo que ser **exactamente 2**, y si el aviso
multiplicara las recargas se queda en 3 y falla igual.

### 4 · `catalog-card-glow` — medía en el filo del umbral

El brillo llega a 0 cuando el borde superior del **estante** queda una pantalla
entera por encima del viewport. La prueba bajaba a «tope de la primera
**tarjeta** + una pantalla + 24 px». Dos discrepancias juntas: medía desde la
tarjeta y no desde el estante que decide, y el colchón contra el umbral era de
**24 píxeles exactos**.

Medido en WebKit local: estante en `-688`, viewport `664`. Veinticuatro píxeles
de margen. Cualquier imagen que termine de decodificar después de calcular el
destino corre el estante más que eso, y entonces el brillo **todavía no es 0
porque no tiene que serlo**.

Se revisó lo que pedía la consigna: el brillo **no** queda encendido de más. El
producto cumple su contrato; la prueba lo medía en el filo.

**Arreglo:** se recalcula desde el estante, con media pantalla de margen, se
reintenta si el layout se corrió, y **se verifica la geometría antes de mirar el
color**: si la página no pudo bajar lo suficiente, lo que falla es eso y lo dice,
en vez de acusar al brillo. Se sigue bajando lo mínimo necesario: scrollear de
más en la home obliga a WebKit a decodificar los rails intermedios, y esta prueba
llegó a tardar 42 s contra un timeout de 45.

---

## El segundo pase sobre `catalog-card-glow`

La primera corrida de CI de este PR bajó el censo de **4 inestables a 1**, y esa
1 volvía a ser `catalog-card-glow`. Pero el error **había cambiado**: ya no era
«el brillo no se apagó al bajar» sino `toEqual`, la comparación final entre los
alfas de la llegada y los del regreso. El arreglo del umbral sacó un fallo y dejó
al descubierto otra fragilidad que estaba debajo.

**No se pudo reproducir localmente.** Se intentó de tres maneras y las tres
fallaron en reproducirlo:

| intento | resultado |
|---|---|
| ida y vuelta ×4 midiendo geometría y alfas | 4/4 idénticos (`[0.1, 0.22]`, `top=286`) |
| fotos servidas con 700 ms de retardo, para correr la geometría | 8/8 pasaron; el test viejo **no** falló |
| 12 cuadros seguidos tras volver arriba, sin colchón | 12/12 idénticos |

La primera hipótesis —que las fotos al decodificar corrían el estante— quedó
**descartada por su propia prueba**. No se sostiene.

Lo que sí se puede afirmar es más chico y más útil: la comparación final mira
**geometría y alfas**, y la condición de estabilidad sólo cubría la geometría. El
token `--card-glow` lo escribe el módulo en un cuadro POSTERIOR al scroll, así
que era posible medir con la geometría ya quieta y el brillo todavía en tránsito.

**Ahora se espera a que quede quieto todo lo que después se compara** —tres
lecturas seguidas idénticas, muestreadas por cuadro de animación y no por reloj,
con `document.fonts.ready` antes—, y la igualdad exacta se exige sólo después de
comprobar que los dos lados se midieron sobre la misma geometría. Si el estante
no volvió a su posición, falla eso y lo dice, en vez de acusar al brillo.

Esperar a que cada lado se quede quieto **no vuelve circular la comprobación**:
que A y B estén estables no obliga a que coincidan. Si el brillo volviera con
otro valor, sigue fallando.

El veredicto real lo da el censo de CI, no la máquina de desarrollo. Esto queda
anotado como *no reproducido localmente*, no como cerrado.

---

## Causalidad con PR #86

`business-windows-operations` no había fallado en 13 corridas previas y empezó
justo después de #86. Que #86 no tocara el archivo **no alcanza** como prueba.

Se verificó de las dos maneras:

1. **Por código.** `business-operations-center.js`, `production-operations.js` y
   `supabase-pos-repository.js` son **byte a byte idénticos** entre `31c900b` y
   `820ad4e`. El único delta de `js/app.js` está en el bloque de perfil del
   checkout del cliente —el texto del mensaje y a qué elemento va el foco—, sin
   tocar la delegación de `input`/`change`.

2. **Por reproducción.** Se dejó el árbol completo en `31c900b` —los diez
   archivos que #86 cambió, más el del defecto sin arreglar— y se corrió el test
   nuevo: **falla igual**, con el mismo `Expected: checked / Received: unchecked`.

El defecto es anterior a #86. Lo que cambió fue con qué frecuencia la carga de CI
hace caer el refresco fiscal del lado malo del clic.
