# STORYBOARD — cómo está armado cada plano

---

## 1. La decisión de fondo

El video se filmó en **una sola pasada por escena**. No hay capas montadas después:
la interfaz real corre dentro de un marco de dispositivo y el texto se anima encima,
en el mismo fotograma. Todo lo que se ve —marco, tipografía, subtítulo, rótulo— vive
en una página de 1920×1080 que Playwright graba mientras maneja la aplicación.

Eso tiene una consecuencia que importa más de lo que parece: **no se puede afirmar
una cosa y mostrar otra.** El plano y la frase son inseparables.

---

## 2. Lenguaje visual

Todo sale de los tokens del producto (`styles/tokens.css`). El video usa la misma
paleta que la app, no una paleta «de presentación».

| Elemento | Valor | Rol |
| --- | --- | --- |
| Fondo | `#090b0e` | superficie de marca de TABA2 |
| Superficie | `#171a20` | marcos, burbujas, chips |
| Tinta | `#f5f5f5` / `#a8abb2` | titular / apoyo |
| Rojo | `#d0000d` · `#ff4d55` (texto) | acento y marca |
| Dorado | `#c9953e` | advertencia, homologación, sintético |
| Verde | `#3ecf8e` | «esto es real» (evidencia de dispositivo) |
| Tipografía | Segoe UI Variable Display / Text | display 66 px · apoyo 26 px · subtítulo 28 px |

**Fondo:** dos halos difusos (rojo arriba a la izquierda, dorado abajo a la derecha),
una grilla de 64 px al 3 % con máscara radial y una viñeta. Está para dar profundidad,
no para llamar la atención.

---

## 3. Los cuatro encuadres

```
A · TELÉFONO A LA DERECHA          B · TELÉFONO A LA IZQUIERDA
┌──────────────────────────┐        ┌──────────────────────────┐
│ marca            chips   │        │ marca            chips   │
│                          │        │  ┌────┐                  │
│  EYEBROW         ┌────┐  │        │  │    │      EYEBROW     │
│  TITULAR         │APP │  │        │  │APP │      TITULAR     │
│  apoyo           │432 │  │        │  │432 │      apoyo       │
│                  │×912│  │        │  │×912│                  │
│                  └────┘  │        │  └────┘                  │
│ ▓ subtítulo ▓      pie   │        │ ▓ subtítulo ▓      pie   │
└──────────────────────────┘        └──────────────────────────┘
   escenas 1 · 4                       escenas 3 · 7

C · VENTANA (1120×630 útil)         D · VENTANA PROTAGONISTA (1408×792)
┌──────────────────────────┐        ┌──────────────────────────┐
│ marca            chips   │        │ ░░ RÓTULO DE AMBIENTE ░░ │
│           ┌────────────┐ │        │ marca            chips   │
│ EYEBROW   │  ▁▁▁▁▁▁▁▁  │ │        │ ┌──────────────────────┐ │
│ TITULAR   │            │ │        │ │      ▁▁▁▁▁▁▁▁        │ │
│ apoyo     │   PANEL    │ │        │ │       PANEL          │ │
│           └────────────┘ │        │ └──────────────────────┘ │
│ ▓ subtítulo ▓      pie   │        │ ▓ subtítulo ▓      pie   │
└──────────────────────────┘        └──────────────────────────┘
   escenas 2 · «la prueba»              escenas 5 · 6
```

**Por qué el teléfono va a tamaño real (432×912 CSS px, 1:1 en el cuadro).**
Si se escalara hacia arriba, la interfaz se vería interpolada. A escala natural, cada
pixel de la app es un pixel del video: el texto de los precios se lee.

**Por qué la ventana va reducida y no ampliada.** El iframe mide 1600×900 y se reduce
con `transform: scale()`. Chromium vuelve a rasterizar a la escala final, así que el
Panel —que es denso— sale nítido en vez de borroso.

---

## 4. Elementos recurrentes

**Chip de honestidad (arriba a la derecha).** Cambia con lo que se está mostrando y
nunca desaparece:

| Chip | Color | Cuándo |
| --- | --- | --- |
| Modo demostración | gris | app real con catálogo de demostración |
| Mercado Pago · modo prueba | azul | capturas de la compra de prueba |
| App Android real | verde | capturas del Moto G15 |
| Datos de prueba | azul | Panel con fixtures |
| Sintético · homologación | dorado | facturación |
| Probado en pruebas | azul | WhatsApp |

**Rótulo de ambiente (banda superior).** Sólo en la escena 6, de punta a punta:
franjas diagonales doradas con «DEMOSTRACIÓN SINTÉTICA · HOMOLOGACIÓN — NO ES
PRODUCCIÓN». Ocupa el ancho completo y empuja la marca hacia abajo. No se puede pasar
por alto ni sacando una captura del video.

**Pie (abajo a la derecha).** La letra chica de cada escena: «Interfaz real de TABA2 ·
catálogo y datos de demostración», «Capturas del dispositivo real · Moto G15 ·
Android 15», etc.

**Banda de subtítulo (abajo a la izquierda).** Es la narración, escrita. El video se
entiende completo sin sonido: es la forma en que se va a ver la primera vez.

**Puntero.** Un círculo claro con un anillo que pulsa al tocar. Existe porque el
navegador headless no dibuja cursor, y sin él la interfaz parece operarse sola. Viaja
hasta el elemento, golpea, y recién ahí se dispara el click de verdad.

**Llamadas.** Etiqueta con una línea que apunta a un elemento **real** de la interfaz.
La posición no está escrita a mano: se lee la caja del elemento dentro del iframe y se
ancla ahí. Si la interfaz cambia, la llamada se mueve con ella.

---

## 5. Escena por escena

### Apertura · placa
Fondo con degradado radial propio, filete rojo, volanta, titular en tres líneas,
apoyo y firma. Entra en cuatro tiempos escalonados (filete → titular → apoyo → firma).

> **Un cliente compra. El negocio entrega. *El sistema hace el resto.***

### Escena 1 · El cliente — encuadre A, en vivo
Home → desplazamiento por la vidriera → sección de combos → ficha del combo (con el
ahorro calculado por el producto) → dos productos al carrito → carrito → llamada sobre
la dirección guardada → llamada sobre la forma de pago → confirmación de mayoría de
edad → confirmar → **pedido LT-0002 confirmado, con número, total y estado.**

El titular cambia dos veces dentro de la escena: «Compra desde el teléfono» → «El
pedido se arma solo» → «Listo. El pedido ya existe.»

### La prueba · encuadre C, capturas
Tres capturas de la compra real contra el entorno de pruebas: el checkout de Mercado
Pago, el pedido confirmado **LT-0096** y ese mismo pedido en la bandeja del Panel.
Titular: **«Esto ya pasó.»** Está acá, y no al final, porque es la objeción que
Walter va a tener después de ver una demo: *¿esto anda de verdad?*

### Escena 2 · El negocio — encuadre C, en vivo
El Panel con el pedido de la escena 1. Llamada sobre la tarjeta: cliente, dirección,
productos y **total**. Después el puntero avanza el pedido: **Aceptar → Preparando →
Listo**, y la llamada final marca «Listo para retirar».

### Escena 3 · El reparto — encuadre B, capturas del teléfono real
Nueve pantallas del Moto G15 encadenadas con fundido y una deriva lenta (7 s, escala
1 → 1.045): cola, nuevo pedido, retiro, retirado, el mapa del pedido con el retiro en
Mendoza 827, llegada, código, entrega completada y **sin conexión**.

Las nueve salen de **una sola corrida** sobre el build aislado de revisión, así que la
escena es internamente coherente: el mismo pedido de prueba de punta a punta. Antes
venían de dos corridas y dos épocas del producto, y se notaba.

Ese último plano es deliberado: un video comercial no suele mostrar el modo degradado.
Acá se muestra porque es el argumento —la app encola y no se pierde nada—, y porque es
lo que va a pasar la primera noche de trabajo real.

### Escena 4 · El seguimiento — encuadre A, en vivo
El mapa oscuro de TABA2 con la ruta, el negocio, el repartidor y el ETA, más la línea
de estados **Confirmado · Preparando · En camino · Entregado**. Llamada sobre el mapa:
«Última posición del repartidor». Cierre: si el repartidor deja de reportar, el sistema
lo dice; nunca inventa una posición.

### Escena 5 · La operación — encuadre D + C
**Primera parte (D):** Centro de operación. Los mosaicos —pedidos nuevos, demorados,
pagos en camino, a revisar, preparaciones abiertas, envíos en la calle, comprobantes
pendientes, impresiones con problema, para conciliar— y abajo **«Qué resolver»**, con
la alerta escrita como se la explicaría a una persona: qué se conserva, cuál es el
riesgo, qué conviene hacer. Después, «Abrir el negocio»: la revisión de internet,
cobros, facturación, repartidores y colas.

**Segunda parte (C):** Métricas de la jornada —ventas del turno, ticket promedio, más
vendidos— y el catálogo editable con el stock.

### Escena 6 · La facturación — encuadre D, con rótulo permanente
Banda de ambiente arriba durante toda la escena. Pantalla «Se configura una vez.
Después las ventas se facturan solas»: el tablero del día, la bandeja de excepciones
con un caso real («falta un dato fiscal de esta venta») y los seis pasos con su estado.

Después, el comprobante: la página del PDF que genera el propio sistema, en dos planos
—encabezado y detalle, y después el bloque del CAE con su QR—, con el rótulo del propio
archivo a la vista: *COMPROBANTE SINTÉTICO — NO EMITIDO POR ARCA.*

Cierre de la escena, y es a propósito el único titular del video que habla de lo que
falta: **«Lo que falta se dice.»**

### Escena 7 · WhatsApp — encuadre B, diagrama
Dentro del teléfono, un diagrama con la identidad de TABA2 —**no** una captura de
WhatsApp, y el encabezado lo dice— con los textos y los importes que produjo el canal
certificado. Las filas aparecen de a una. Cierre: **«Falta una sola cosa»** — conectar
el número oficial.

### Cierre · tres placas
1. **TABA2 fue diseñada, integrada y operada por Marco Luna.**
2. **Desarrollo · automatización · mantenimiento · integraciones · soporte operativo**
3. **TABA2 no es el final. Es la base para seguir digitalizando el negocio.**

Sin música creciente, sin logo girando, sin cifras. Tres frases y negro.

---

## 6. Ritmo

Cada escena se filmó en tiempo real y se ajustó después, escena por escena
(entre ×1.00 y ×1.22; ver `clips/CLIPS.md`). Las que muestran una interfaz densa
aguantan más marcha; la apertura y el seguimiento van en tiempo real porque ahí el
espectador está leyendo un mapa.

Entre escena y escena hay un fundido a negro corto. No hay transiciones de plantilla:
el negro es la puntuación.

---

## 7. Sonido

Una cama sonora a −28 dBFS: un acorde sostenido filtrado por debajo de 1,3 kHz con un
trémolo muy lento. No se escucha, se siente; está para que el video no suene muerto.

Se entrega también **`TABA2-WALTER-DEMO-sin-musica.mp4`**, que es el mismo video sin
audio, pensado para que Marco grabe su propia voz encima (ver `clips/CLIPS.md`).
Si Walter va a ver el video con Marco al lado, la versión sin música y con Marco
hablando en vivo es mejor que cualquier locución.
