# Storefront comercial de TABA2 — informe de sesión

Sesión `TABA2_COMMERCIAL_STOREFRONT_PILOT` · worktree
`D:\1212\worktrees\taba2-storefront-pilot` · rama
`feature/taba2-storefront-commercial-pilot` · base `66ba221`.

## 0. Validación

| Qué | Resultado |
|---|---|
| `npm run check` (sintaxis, assets, higiene de release, contrato de ubicación) | verde |
| `npm test` | **1160 / 1160** |
| `npx playwright test` (Chromium + WebKit móvil) | **227 / 227** |
| Accesibilidad y navegación por teclado | **18 / 18** Chromium · **18 / 18** WebKit |
| Estabilidad (recarga, atrás, doble submit, red caída, SW, imágenes, overflow) | **29 / 29** Chromium · **29 / 29** WebKit |
| Stock y combos (agotado, últimas unidades, pausado, combo sin componente) | **11 / 11** |
| Revisión visual 320 / 360 / 390 / 432 px × Chromium y WebKit | sin overflow, sin errores de página, sin un solo asset 4xx |
| `npm run secrets:scan` | verde |
| `npm run catalog:prices:check` | planilla al día |

Lo que cubre cada bloque:

- **Estabilidad**: el carrito sobrevive a la recarga y al botón atrás; tres
  toques simultáneos sobre «Confirmar pedido» crean **un** pedido; una caída de
  red lo dice en pantalla, conserva el carrito y devuelve el botón usable; el
  service worker queda activo con una sola caché (`v55`) y la app sigue
  pintando tras recargar con él controlando la página.
- **Stock**: se fuerzan los tres estados que el catálogo de demostración nunca
  produce —agotado, últimas 3, pausado— y se verifica el rótulo, la clase y que
  el botón bloquee. Un combo al que se le acaba un componente desaparece del
  carrusel, deja de ser cobrable, **no anuncia precio** y explica el motivo.
- **Teclado**: ocho paradas desde el inicio hasta un botón «Agregar», todas
  visibles y con anillo de foco; Enter suma al carrito; Escape cierra la ficha.
- **Precios**: el importe de la tarjeta, el de la línea del carrito y el
  subtotal coinciden al peso (`3.900 + 3.576 + 2.925 = 10.401`), y el total suma
  el envío sin agregar nada más. No aparece ni un `$ 0` ni un precio inventado
  en ninguna superficie: un producto sin precio confirmado dice «Precio
  próximamente» y su botón no deja agregarlo.
- **Productos de QA**: cero en el catálogo local. Los dos fixtures que llegaron
  a la góndola publicada el 8 de agosto vivían en staging y ya están apagados;
  por qué pudieron llegar —y cuál es la corrección durable— está en el handoff.

---

## 1. Qué encontré

### El hallazgo que ordena todo lo demás

De los **80 productos** que ve un cliente, **11 se pueden comprar**. Los otros 69
esperan que el negocio confirme su precio. El desglose por categoría, el detalle
de qué bloquea cada SKU y los dos caminos para cargarlos están en
`STOREFRONT-COMERCIAL-HANDOFF.md`, dentro del worktree.

Que sigan visibles es la decisión correcta —el sistema nunca les inventa un
precio— pero **ninguna superficie que ordenaba los tenía en cuenta**, y de ahí
salieron los defectos de abajo.

### Defectos corregidos

| # | Qué pasaba | Dónde |
|---|---|---|
| 1 | «Precio: menor a mayor» abría con ocho productos sin precio. `Number(null)` vale 0, así que un precio pendiente ganaba el primer puesto | `js/ui.js` · `sortProducts` |
| 2 | Las categorías del catálogo abrían con Gaseosas y Mixers, sin un solo precio publicado: los dos primeros toques caían en «Precio próximamente» | `js/ui.js` · `renderCategories` |
| 3 | El chip «Enviar a» decía «Elegí tu dirección» con una dirección predeterminada confirmada al lado. En producción lo decía **siempre**, porque su única fuente era la copia local del perfil, que producción no usa por diseño | `js/ui.js`, `js/customer-delivery.js`, `js/app.js` |
| 4 | El formulario de entrega pedía ciudad, provincia y código postal: dos campos obligatorios cuya única respuesta posible ya sabíamos, entre la dirección y el mapa | `js/customer-profile-view.js` |
| 5 | El alcohol no se distinguía en la góndola: había que abrir la ficha, y el +18 aparecía recién en el checkout | `js/ui.js` · tarjeta de producto y de la home |
| 6 | El estado de stock se imprimía dos veces en la misma tarjeta | `js/ui.js` |
| 7 | El resumen de pago listaba «Pedido mínimo delivery $ 5.000» entre «Envío» y «Total», donde se leen los cargos | `js/ui.js` · `renderOrderSummary` |
| 8 | Dos funciones escribían el **mismo** nodo de la tira de categorías de la home con listas distintas; ganaba la última en correr | `js/ui.js` |
| 9 | «Tu pedido está protegido» no decía nada verificable | `js/app.js` · `checkoutModeCopy` |
| 10 | Categorías enteras sin un solo precio no lo decían: había que scrollear diecisiete tarjetas para entenderlo | `js/ui.js` · `renderCatalogMeta` |

### Heredado, no causado por esta rama

`npm test` estaba **en rojo en la base `66ba221`**:
`tests/github-pages.test.mjs` afirmaba la caché del service worker
`la-taba-runtime-v53-…` mientras `sw.js` ya decía `v54`. La sesión vecina bumpeó
el worker y no actualizó su test. Corregido acá al pasar a `v55`.

---

## 2. Qué NO toqué, y por qué

- **Staging, producción, despliegue, Mercado Pago, ARCA, WhatsApp, LT-0030.**
  Fuera de alcance por encargo.
- **El Moto G15.** Su lock estaba ACTIVO a nombre de
  `TABA2_FIRST_HUMAN_PHYSICAL_ORDER` durante toda la sesión. No se desplazó.
- **Las categorías Vodka, Gin y Snacks.** Las dos primeras partirían
  `destilados` —4 productos, los 4 sin precio— en dos categorías vacías;
  la tercera no tiene ni un producto que clasificar.
- **Los combos que pide el encargo** (Fernet+Coca+hielo, Gin+tónica+hielo,
  six-pack+snack, Gancia+gaseosa, vino+snack). Todos tienen al menos un
  componente sin precio, así que quedarían bloqueados y no se mostrarían;
  y declarar un descuento que nadie aprobó sería comprometer al negocio.
- **El área de cobertura.** El sistema no tiene polígono. Inventar un radio
  sería afirmar una regla comercial que el negocio no declaró.
- **Un filtro por nombre para los fixtures de QA.** El repositorio usa «QA» en
  sus propios fixtures de prueba, y taparía el síntoma en vez del agujero: la
  corrección durable es del lado del servidor.
- **El orden de la home.** El encargo sugiere promos/combos antes de las
  categorías. Se midió: a 390 px, «Destacados» pone dos tarjetas con precio y
  botón sobre el pliegue, y una tarjeta de combo mide ~700 px, así que subirla
  dejaría la primera pantalla con un combo cortado. Se conserva el orden actual,
  que además ya está justificado en el propio markup.

---

## 3. Decisiones de UX

1. **La localidad se informa, no se pregunta.** «Guardamos la localidad como
   Neuquén Capital. Lo que usa quien reparte es el punto que confirmás acá
   abajo.» El dato sigue viajando al pedido, al Panel, al Rider y al payer de
   Mercado Pago. Una dirección guardada que diga otra localidad **no se
   reescribe**: el valor propio gana sobre el canónico, así que su huella de
   confirmación no se invalida sola.
2. **El encabezado nombra el destino real.** Es la señal de entrega más visible
   del storefront; contradecir al checkout es lo único que no puede hacer.
3. **El +18 es señalización, no control.** Chico y en dorado, el mismo lenguaje
   que el chip de los combos. Casi la mitad del catálogo lleva alcohol: una
   cinta grande sería ruido en media góndola.
4. **El estado de stock se dice una vez.** Pastilla sobre la foto para quien
   mira; nombre accesible del botón para quien escucha.
5. **El resumen suma sólo lo que se cobra.** El mínimo vive en la barra de
   progreso, que además dice cuánto falta.
6. **Las categorías sin precio no se esconden, se posponen.** Son productos
   reales que el local va a vender. Van detrás, y la cabecera lo dice.

---

## 4. Deuda que queda abierta

| Deuda | Por qué no se cerró |
|---|---|
| Los fixtures de QA pueden volver a la góndola si alguien los publica con `is_verified` | La corrección durable es una línea en la vista que publica el catálogo, y eso exige mutar staging: su lock lo tiene otra sesión |
| El servidor acepta un punto de entrega en cualquier parte del planeta | Anotado por la sesión vecina; la corrección de cliente cierra el camino, no el agujero |
| `js/customer-delivery.js` tiene ~400 líneas muertas: el editor de direcciones dentro del checkout, su panel de ubicación, sus sugerencias y su panel de duplicados no los llama nadie | Borrarlas no cambia nada para el usuario y toca un archivo que otras sesiones están mirando |
| El Panel y el Rider no se auditaron | Fuera de alcance por encargo |
| «Seguir» (seguimiento) convive en pantalla con «Seguir comprando» (volver al catálogo) | Todas las alternativas cortas colisionan con «Carrito»; se deja anotado en vez de cambiar una etiqueta de navegación sin poder medir la alternativa con gente |

---

## 5. Commits y archivos

Tres commits locales, sin push, sobre una rama nueva creada desde `66ba221`.
La rama ajena de la que sale esa base **no se tocó**.

| Commit | Qué cierra |
|---|---|
| `a790854` | La ciudad y la provincia dejan de preguntarse; el chip «Enviar a» deja de contradecir al checkout |
| `e63a4ff` | La góndola lleva primero a lo comprable: orden por precio, categorías, +18, stock, resumen de pago |
| `a49a88c` | Aviso de categoría sin precio publicado y dos correcciones de accesibilidad |

Archivos de producto tocados:

```
js/core/business-location.js     +19   OPERATING_AREA
js/customer-profile-view.js      +58   formulario de dirección
js/customer-delivery.js          +36   getActiveDeliveryAddress y su evento
js/ui.js                        +190   góndola, tarjetas, resumen, chip
js/app.js                        +11   evento del chip y copy del checkout
styles/catalog.css               +22   marca +18
styles/brand-home.css            +14   marca +18 en la vidriera
styles/profile.css               +27   nota de localidad y área táctil
index.html / sw.js                     versión de assets v44→v45, caché v54→v55
```

Pruebas nuevas o actualizadas:

```
tests/e2e/gondola-comprable.spec.mjs        NUEVO · 6 pruebas
tests/e2e/customer-profile.spec.mjs         ciudad/provincia ya no existen
tests/e2e/delivery-location-confirmation.spec.mjs
tests/e2e/demo-realtime-profile.spec.mjs
tests/e2e/business-setup.spec.mjs           el mínimo migró a la barra de progreso
tests/customer-profile-completion.test.mjs
tests/github-pages.test.mjs · pwa.test.mjs · startup-recovery.test.mjs
tests/e2e/ios-blank-screen.spec.mjs         versión del módulo
```

---

## 6. Incidente de entorno

A mitad de sesión el disco **E: quedó al 100 % (299 GB, 0 bytes libres)** y el
harness dejó de poder escribir hasta la salida de un comando: ningún proceso
podía correr.

E: es el disco **personal** del usuario —fotos, videos, ISOs, backups—, así que
no se borró ni uno de sus archivos. Se liberaron 213 MB borrando **583 perfiles
temporales huérfanos de Playwright** en `E:\DevCache\Temp` (mayores a 30
minutos, descartables por definición) y se movió la evidencia propia a
`D:\1212\artifacts\taba2-storefront-comercial\evidencia`. Desde entonces la
sesión corre con `TEMP`/`TMP` en `D:\1212\_claude-tmp\storefront-pilot`.

**Esto necesita una decisión humana:** E: sigue prácticamente lleno con datos
personales. Mientras siga siendo el destino de `%TEMP%`, cualquier corrida larga
lo vuelve a llenar.

---

## 7. Evidencia

```
evidencia/baseline/                 el storefront ANTES de tocar nada
evidencia/after/                    capturas intermedias por corrección
evidencia/final/chromium-320|360|390|432/
evidencia/final/webkit-320|360|390|432/
     8 pantallas por ancho: home ×3, catálogo, carrito,
     checkout, perfil y editor de dirección
evidencia/final/stability/          doble submit y caída de red (Chromium)
evidencia/final/stability-webkit/   lo mismo en WebKit
evidencia/final/stock/              agotado, últimas unidades y combos
evidencia/a11y/                     recorrido por teclado
pw-full-final.log                   suite completa 227/227
pw-full-cierre.log                  corrida de cierre sobre el árbol final
```

---

## 8. Qué NO se declara

No se declara *production ready*. Lo que esta sesión sostiene con medición es
que el storefront es coherente, estable y probado en los dos motores móviles,
con el catálogo que hoy existe.

Lo que falta para un piloto comercial de verdad **no es software**: son los
precios de 83 SKU, los snacks que no existen todavía, las promociones sin
vigencia declarada, el área de reparto que nadie publicó y la confirmación
humana del pin del local contra la puerta.
