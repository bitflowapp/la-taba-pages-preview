# Revisión adversarial de esta tanda

Fecha: 2026-10-02. Rama `feat/taba-frontend-commercial-polish`, PR #131.

Dos pasadas. En cada una, un agente por lente buscó defectos en el diff y otro
intentó refutarlos leyendo el código y corriendo comprobaciones chicas. Lo que
sigue es lo que sobrevivió, qué se hizo con cada cosa y lo que queda abierto a
propósito.

Ninguna revisión corrió Playwright: lo que acá dice «verificado en navegador»
lo verifiqué yo después, y está en `qa-results.md`.

## Primera pasada — diff completo, cinco lentes

19 hallazgos confirmados: 5 P2 y 14 P3 (la fila 4 reúne dos). Todos corregidos
antes del primer commit.

| # | Sev. | Qué pasaba | Qué se hizo |
|---|------|-----------|-------------|
| 1 | P2 | El aviso «Sin conexión» al confirmar también frenaba la demo y el sandbox, que arman el pedido en el dispositivo | La guarda corre sólo en producción |
| 2 | P2 | Afinar una búsqueda desde la home pegaba las palabras («coca» + « zero» → «cocazero», 0 resultados) | Lo tipeado viaja tal cual al buscador del catálogo; prueba E2E |
| 3 | P2 | Sin conexión y con un diálogo abierto, el toast se estiraba de arriba a abajo de la pantalla | La regla de apilado no aplica con un diálogo abierto |
| 4 | P2 | Dos pruebas E2E nuevas pasaban por motivos ajenos a lo que decían (un toast viejo; una consulta que no era la mía) | Reescritas para medir lo que afirman |
| 5 | P3 | Una ficha abierta mientras se cerraba otra se cerraba sola | Marca de «entrada en retirada»; prueba E2E |
| 6 | P3 | Con un filtro puesto, «Favoritos» vacío culpaba al filtro | Sólo se culpa a los filtros si sin ellos habría algo |
| 7 | P3 | La configuración del comercio se publicaba antes de reconciliar la compuerta | Se invirtió el orden |
| 8 | P3 | En teléfono la columna de texto de la franja no cedía los 20 px que se corrió la escena | La regla estaba muerta por orden de cascada; se movió |
| 9 | P3 | Una pieza que cruzaba el umbral con la pestaña oculta quedaba en su primer cuadro para siempre | Arranca al volver la pestaña |
| 10 | P3 | La pieza de la góndola no se enteraba cuando la lista quedaba vacía | El controlador se refresca también ahí |
| 11 | P3 | A 1366 × 768 la pieza medía 2,7 px menos que la puerta editorial | Mismo interlineado; medido 164,48 px las dos; aserción E2E |
| 12 | P3 | El filtro de texto dejaba pasar «2 mil», «2 lucas», «2k», y cifras en el rótulo | Multiplicadores y forma de precio en el rótulo |
| 13 | P3 | El filtro rechazaba texto honesto («Para regalar», «Queda bien con todo») | Raíces acotadas al reclamo |
| 14 | P3 | Una fecha imposible (31 de noviembre) pasaba como vigencia | Ida y vuelta por el calendario |
| 15 | P3 | Sin conexión, el apilado pisaba los desplazamientos propios del Panel | La regla es sólo de la tienda |
| 16 | P3 | El botón neutro «Ver detalle» se pintaba de rojo de compra al tocarlo | Excluido |
| 17 | P3 | La fila de identidad se medía antes de existir | La prueba espera a que se vea |
| 18 | P3 | La consulta de disponibilidad no reintentaba tras fallar | Rediseñado (ver abajo) |

### Lo que la revisión me hizo rediseñar

Yo había agregado una consulta de disponibilidad al volver a la pestaña, con un
tope de dos minutos. La revisión mostró que el repositorio **ya** vuelve a
preguntar en cada vuelta, y que lo que faltaba era otra cosa: nadie dibujaba la
respuesta. Mi consulta competía con esa, y según cuál llegara última el rótulo
podía quedar viejo.

Quedó así: el almacén de disponibilidad avisa cuando la respuesta **cambia**
(`subscribeCommerceAvailability`) y la tienda repinta el rótulo, la home, el
carrito y la tarjeta de entrada. Saqué mi consulta duplicada y el tope. Y el
repositorio ahora recuerda por qué dirección se preguntó: antes la reconciliación
preguntaba «sin dirección» y esa respuesta pisaba el envío y el mínimo ya
resueltos (defecto anterior a esta tanda).

> El mensaje del commit `21c14fa` todavía describe la primera versión («se
> vuelve a pedir… o si pasaron dos minutos»). El código es el de este párrafo.
> No reescribí el commit: la regla del trabajo es no enmendar.

## Segunda pasada — sólo lo que cambió después de la primera

13 hallazgos: 8 confirmados, 5 parciales. Varios son anteriores a esta tanda.

| # | Sev. | Origen | Qué pasaba | Qué se hizo |
|---|------|--------|-----------|-------------|
| 1 | P2 | Anterior | Agregarle el barrio a una dirección ya guardada no volvía a preguntar la cobertura: el aviso de cambio de dirección no miraba el barrio ni el punto, y el carrito quedaba bloqueado en «no realizamos entregas en esta zona» | La clave del aviso lleva barrio, latitud y longitud; prueba |
| 2 | P2 | Anterior | El filtro de texto de campañas dejaba pasar «Sólo hoy», «Últimas latas», «Dos por uno», «Llevá 2», «Envío sin costo», «Lata 2500», «A 99» | Formas cortas y con letras; y una regla nueva: **una cifra en la pieza sólo puede venir del nombre o la marca del producto** |
| 3 | P3 | Esta tanda | Una vigencia con microsegundos (como la escribe una base de datos) se leía como fecha inválida | Acepta cualquier fracción y lee hasta el milisegundo |
| 4 | P3 | Anterior | Una pieza abandonada a mitad de su entrada volvía a correr entera al regresar a la vista | Vuelve en su cuadro final |
| 5 | P3 | Esta tanda | La marca de «entrada en retirada» se soltaba a los 400 ms aunque la vuelta no hubiera llegado | Espera mientras el historial siga en la entrada de la ficha |
| 6 | P3 | Esta tanda | Tocar otra vista mientras se cerraba la ficha podía devolver a la vista anterior | La navegación más nueva manda |
| 7 | P3 | Anterior | Con la pestaña siempre a la vista, a la hora de apertura el rótulo pasaba de «Abrimos a las 19:00» a «Ahora estamos cerrados» y ahí quedaba | A esa hora se vuelve a preguntar; prueba E2E |
| 8 | P3 | Esta tanda | Una consulta fallida cambiaba «Cerrado» por «Estamos tomando pedidos» en el acto y nada reintentaba | Un reintento a los 8 s; prueba E2E. El «no sé» sigue sin bloquear (ver abierto 1) |
| 9 | P3 | Esta tanda | El repintado no alcanzaba a la tarjeta de entrada de la tienda | Incluida |
| 10 | P3 | Esta tanda | Si sólo cambiaba la compuerta (misma configuración), no había render hasta el contacto | Se escribe también cuando cambia la compuerta |
| 11 | P3 | Esta tanda | El texto de los tres campos se revisaba pegado: «Fernet 1882» + «Menos hielo…» se leía «1882 menos» | Cada campo por separado |
| 12 | P3 | Esta tanda | La prueba de «la reconciliación recuerda la dirección» no pasaba por la reconciliación | Ahora sí |
| 13 | P3 | Anterior | Ver abierto 2 | Documentado |

## El rojo del CI — defecto propio, encontrado por una prueba propia

Corrida 36974637300 sobre `0197ba5`: 723 E2E en verde, 1 en rojo, dos veces
seguidas: «la escena llena la banda que tiene», a 360 px, en Chromium.

**Clasificación: PRODUCT_BUG.** La tienda usa la letra del sistema
(`system-ui`). En el runner de Linux esa letra es más ancha que la de este
equipo, la leyenda legal de alcohol no entraba en un renglón y partía en dos; como
estaba posicionada sobre la banda, el segundo renglón caía encima de la base
del vaso. Medido acá forzando una letra ancha: pasaba lo mismo en la puerta
editorial, donde el segundo renglón caía sobre «Ver cervezas →». Y a 320 px
pasaba con **cualquier** letra.

La leyenda la agrandé yo en esta tanda (de 9 a 9,5 px) y a la puerta editorial
se la agregué yo. La aserción no se tocó.

Arreglo: en el teléfono la leyenda va en flujo, subida exactamente un renglón.
Donde entra en uno queda donde estaba, píxel por píxel. Donde parte en dos, la
banda crece ese renglón y no pisa nada.

Dos cambios en las pruebas, y por qué no son un aflojamiento:

- La altura de la banda se mide ahora sobre la banda entera y no sobre su
  primer hijo. La leyenda de la puerta es un hermano del botón: medir sólo el
  botón la dejaba fuera de la cuenta mientras que en la pieza quedaba dentro.
  Con un renglón los dos números son idénticos a los de antes.
- Prueba nueva a 320 px, donde la leyenda parte en dos con cualquier letra, así
  que no depende de las fuentes de la máquina: ni cortada, ni sobre la acción,
  ni sobre la escena, y la pieza no más alta que la puerta.

## Lo que queda abierto a propósito

Son decisiones, no olvidos. Ninguna la resolví en silencio.

1. **Cuando la consulta de disponibilidad falla, la tienda no bloquea.** Es una
   decisión anterior y está escrita en el módulo («por qué no bloquea cuando no
   sabe»): sin respuesta no se afirma nada y decide el alta del pedido. La
   consecuencia visible es que, tras una falla, el rótulo dice «Estamos tomando
   pedidos» hasta que el reintento contesta. La alternativa —conservar el último
   «cerrado»— puede frenar una venta con un dato viejo. Es del dueño del
   producto.
2. **Una respuesta mal formada se lee como «cerrado» en el carrito y no en la
   home.** Anterior, y fijado por una prueba existente. Las dos superficies
   deberían usar el mismo criterio.
3. **La hora de cierre no dispara una consulta.** Calcularla acá sería evaluar
   el horario en el cliente, que es justo lo que el módulo no hace. Hoy quien
   compra un minuto después del cierre recibe el rechazo del backend, con su
   texto.
4. **El filtro de texto de campañas falla cerrado.** Una frase honesta con una
   palabra de la lista («El regalo perfecto», «Mitad y mitad») no se muestra, y
   hoy nadie se entera del motivo: el código de problema no se le enseña a quien
   escribe la campaña. Importa cuando exista el panel.
5. **Un número en el botón de la pieza sigue rechazado aunque sea de la marca**
   («Ver Fernet 1882»). Hoy ningún producto del catálogo lo necesita.

## De la auditoría anterior, sin cambios en esta tanda

Encontrados al auditar, fuera del alcance acordado (pagos, pedidos, backend).
No se tocaron.

- La vuelta de Mercado Pago deja en el carrito los combos ya pagados.
- `normalizeOrder` recalcula los totales de un pedido que ya trae el backend.
- La tienda queda inerte hasta que terminan las consultas del perfil.
- Un refresco fallido de la fila del comercio cierra la tienda.
- El camino de Mercado Pago reduce todos los rechazos a un solo mensaje, y no
  es idempotente si se pierde la respuesta.
- Un cambio de precio o una revalidación del carrito ocurren sin aviso.
- «Tienda 24/7» está escrito a mano en el código.
- `cuenta/index.html` sigue apuntando a `styles.css?v=50`.
