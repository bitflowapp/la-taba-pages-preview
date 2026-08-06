# HANDOFF · Storefront comercial TABA2

Entrega del worktree exclusivo `la-taba2-commercial-storefront`, rama
`feature/taba2-commercial-storefront`.

| | |
| --- | --- |
| Base | `6294a98` — *fix(mercadopago): close the checkout without depending on a webhook* |
| HEAD final | `e3d40d3` (ver `git log 6294a98..HEAD`) |
| Commits | 10, todos locales. Sin push, sin merges, sin cherry-picks. |
| Archivos | 45 (+3.383 / −497) |
| Git | Limpio. Sin `amend`, `reset`, `clean`, `stash` ni `git add .`. |

---

## 1. Qué cambió y por qué

### 1.1 La identidad: de dos idiomas visuales a uno

La app estaba partida en dos. La home era una vidriera premium sobre grafito;
al tocar "Carrito", "Categorías" o "Perfil" aparecía papel beige con tinta
azulada, verde de éxito y foco azul de sistema. El beige no está en la paleta
comercial de TABA2 —negro/grafito, blanco, rojo intenso, dorado sutil— y el
salto se leía como dos aplicaciones dentro del mismo pedido.

La familia de superficie del cliente (`--cream-*`) pasó a `--shelf-*` con
valores grafito. **El nombre cambió porque el anterior habría quedado
mintiendo.** El producto no se movió: sigue sobre el plato blanco, que ahora es
el acento de más contraste de la pantalla y hace que el packshot sea lo primero
que se ve.

El mecanismo es un **remapeo de tokens en el scope del cliente**, no una lista
de excepciones: los componentes compartidos siguen pidiendo `--taba-muted` y
reciben el gris medido contra grafito. Negocio y Rider conservan su paleta de
papel intacta —lo verifica un test del contrato visual—.

Tres lugares usaban `--taba-ink` como **superficie** y ahí el remapeo habría
invertido tinta y fondo a la vez; se resolvieron explícito:

| Componente | Antes | Ahora | Por qué |
| --- | --- | --- | --- |
| Chip de categoría activo | Tinta sobre blanco | **Blanco** sobre grafito | Rojo lo habría convertido en ocho botones de "Agregar" |
| Toast | Pastilla grafito | **Pastilla blanca** | Es el mensaje más efímero; se lee de una pasada |
| Barra de carrito | Gris grafito | **Rojo de acción** | Sobre grafito desaparecía; es la única conversión que existe |

Se cerraron además los colores fuera de identidad que **encima no se leían**:
verde de éxito (3,1:1) y ámbar de aviso → dorado; rojo usado como texto
(2,97:1) → su variante de tinta (5,2:1); foco azul del sistema → dorado.

### 1.2 La ficha de producto tenía todo menos comprar

La única acción del pie era "Guardar para después". El control de compra vivía
arriba, entre los campos, como un disco de 44 px al lado del rótulo "Cantidad"
—el mismo control que la grilla, donde el espacio manda—. En un producto con
descripción y presentaciones ese disco quedaba **fuera de pantalla**: había que
scrollear y adivinar que la compra seguía más abajo.

Ahora el pie es la barra de acción. En teléfono la ficha es una hoja de tres
piezas —packshot fijo, cuerpo que scrollea, barra anclada—, así que la compra
está siempre visible. En escritorio el packshot ocupa la columna entera: antes
el plato blanco se quedaba en su alto natural y el producto flotaba entre dos
bandas grises.

**Sin precio publicado el pie no ofrece comprar: lo dice.** Antes renderizaba un
disco con el texto "Precio pendiente" desbordado adentro, y un botón
deshabilitado que había que tocar para descubrir que no hacía nada.

### 1.3 Los retornos de pago eran ilegibles

`/pago/resultado`, `/pago/pendiente` y `/pago/error` eran cuatro párrafos
sueltos centrados sobre el shell, con la tinta de papel: **el título del estado
daba 1,3:1 sobre el fondo oscuro**. El cliente volvía de pagar a una pantalla
donde no se leía si el pago había salido bien. Y no tenían marca: se salía de
TABA2 y se volvía a una página que podía ser de cualquiera.

Ahora son una tarjeta de góndola con emblema, sello de estado, detalle, estado y
una sola acción. **El sello no se pinta en el marcado**: se deriva por CSS del
`data-state` que `mercadopago-return.js` ya escribe, así que la página no puede
afirmar un estado distinto del que se verificó contra el repositorio. La lógica
de pago no se tocó.

Los cinco estados —verificando, confirmado, pendiente, revisión manual,
rechazado— están capturados a 320 y 390 px.

---

## 2. Catálogo

### 2.1 La góndola se agrupó al vocabulario comercial

`gin`, `vodka` y `whisky` eran tres estantes propios con 3, 1 y 1 SKU. Tres
estantes casi vacíos se leen como un catálogo incompleto, no como una góndola:
pasaron a ser **subcategorías de DESTILADOS** y la distinción se conserva en
cada SKU. `complementos` pasó a llamarse **HIELO**, que es lo que contiene.

`snacks` y `golosinas` quedaron declarados en la taxonomía y **no tienen ningún
SKU relevado**: la generación sólo publica categorías con producto, así que no
aparecen en la app —ninguna categoría vacía llega a la góndola— y su motivo está
en `catalog-pending.csv`.

Góndola publicada hoy: `gaseosas · mixers · energizantes · cervezas · aguas ·
aguas saborizadas · isotónicas · fernet y amargos · aperitivos · vinos ·
espumantes y sidras · destilados · hielo`.

No se inventó ni un dato. El runtime se regeneró por el pipeline existente
(`node scripts/taba2-catalog-authority.mjs --runtime-only`), sin volver a
descargar activos.

### 2.2 Estado real de la góndola

| | |
| --- | --- |
| Registros en `catalog/products.json` | 92 |
| Visibles en la góndola | 80 |
| **Comprables hoy** | **11** |
| Pendientes registrados | 96 |

**Los 11 comprables son 7 cervezas y 4 energizantes.** Este es el hallazgo
comercial más caro de la entrega y conviene leerlo antes que nada: hoy la tienda
no puede vender una sola gaseosa.

### 2.3 `catalog/catalog-pending.csv`

Se **genera**, no se escribe a mano: un pendiente escrito a mano envejece y el
día que el negocio confirma un precio la fila sigue afirmando un bloqueo que ya
no existe. Un test falla si el archivo committeado se desvía del generador.

```
npm run catalog:pending
```

Columnas: `sku, gondola, brand, name, presentation, blocked_field,
blocking_reason, evidence, next_action`.

| Familia | Filas | Motivo |
| ---: | ---: | --- |
| Precio sin confirmar | 60 | Identidad e imagen verificadas; entra a la góndola como "Precio próximamente" y no es comprable |
| Packs de abastecimiento | 10 | La góndola publica unidades de venta minorista; el pack existe para surtir el local |
| **Unidades derivadas sin precio unitario** | **9** | El precio confirmado es el del PACK. Dividirlo por seis sería inventar el precio de venta: incluye el margen minorista que fija el local |
| Rechazos de revisión visual | 10 | Cada uno con lo que la ficha mostraba: tabla nutricional, dorso, pieza gráfica, conflicto de capacidad |
| Rubros sin relevar | 2 | `snacks` y `golosinas`: no hay identidad, precio, imagen ni código de barras de ningún SKU |
| Combos que no cierran | 5 | Con el componente exacto que falta |

**Ningún precio, stock ni código de barras fue inventado.** `publicable=true`
sólo donde los tres datos estaban confirmados.

---

## 3. Combos

### 3.1 Qué había

Una función `renderCombos` que buscaba productos con `combo: true`. Ningún
producto traía esa bandera y su contenedor ni siquiera existía en el shell:
código muerto que rendía cero combos.

### 3.2 Qué hay

Siete combos armados sobre los once productos con precio **y** stock
confirmados, con **$ 14.902 de ahorro total ofrecido**:

| Combo | Componentes | Individual | Combo | Ahorro | +18 | Stock |
| --- | --- | ---: | ---: | ---: | :-: | ---: |
| Previa Imperial | 6× Imperial Golden | $ 18.000 | $ 15.800 | $ 2.200 (12,2 %) | sí | 16 |
| Heineken x6 | 6× Heineken | $ 23.400 | $ 21.000 | $ 2.400 (10,3 %) | sí | 16 |
| Corona Extra x6 | 6× Corona Extra | $ 21.600 | $ 19.400 | $ 2.200 (10,2 %) | sí | 16 |
| Birra y energía | 4× Imperial Golden · 2× Speed | $ 17.850 | $ 15.700 | $ 2.150 (12,0 %) | sí | 24 |
| Tabla de cervezas | 6 cervezas distintas | $ 19.100 | $ 17.100 | $ 2.000 (10,5 %) | sí | 99 |
| Noche larga | 4× Heineken · 2× Red Bull | $ 22.752 | $ 20.000 | $ 2.752 (12,1 %) | sí | 24 |
| Cuatro para arrancar | 4× Speed Unlimited | $ 11.700 | $ 10.500 | $ 1.200 (10,3 %) | no | 24 |

### 3.3 El manifiesto no guarda precios

`data/combos.csv` declara componentes, cantidades, sustituciones y el descuento
decidido. **No declara precios** —hay un test que lo verifica leyendo el
archivo—. El precio individual, el promocional, el ahorro, el stock y el +18 se
derivan del catálogo vivo en cada render.

No es elegancia: un precio guardado envejece en silencio, y el día que sube la
lata la tarjeta sigue prometiendo un ahorro que ya no existe.

Reglas verificadas por test:

- un componente sin precio confirmado **bloquea** el combo en vez de completarlo
  con un número inventado;
- el **stock es el del componente limitante** — prometer más es prometer un
  combo que el mostrador no puede armar;
- el **+18 de cualquier componente se propaga al combo entero**: no existe un
  combo medio alcohólico;
- una **sustitución sólo se ofrece si existe, se puede comprar y vale lo mismo**;
- el redondeo del precio promocional baja a la centena, así que el ahorro
  anunciado nunca es menor que el real.

### 3.4 Dos correcciones que vale la pena conocer

**Los packs no eran componentes.** Los dos primeros combos de gaseosa cerraban
contra el catálogo crudo y **no existían en la app**: los packs de 1,5 L son de
abastecimiento y la góndola no los publica como unidad de venta. Se
reemplazaron, el motivo quedó en `catalog-pending.csv` y el test ahora corre
contra el catálogo **del cliente**, que es donde el error se veía.

**Las fotos editoriales mentían.** La primera versión ilustraba "Previa
Imperial" con botellas de Patagonia y "Corona Extra x6" con una Heineken. En una
tienda de bebidas eso no es licencia estética: es mostrar una marca y entregar
otra. La imagen del combo pasó a ser la fila de packshots de sus propios
componentes sobre el plato blanco.

---

## 4. Validación

### 4.1 Auditor de superficie

```
node scripts/realtime-relay.mjs 8231 &
npm run qa:taba2:commercial-audit
ENGINE=webkit WIDTHS=320,375,390,414,432,1280 npm run qa:taba2:commercial-audit
```

Mide sobre el color **realmente pintado** —resolviendo el fondo opaco subiendo
por los ancestros—, no sobre el token: un token correcto que llega tapado sigue
siendo texto ilegible. Reporta contraste bajo WCAG AA, superficies claras fuera
de identidad, overflow horizontal y objetivos táctiles bajo 44 px.

Empezó con ~50 hallazgos en nueve vistas.

| Motor | 320 | 375 | 390 | 414 | 432 | Escritorio |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| Chromium | 0 | 0 | 0 | 0 | 0 | 0 |
| WebKit (Safari/iPhone) | 0 | 0 | 0 | 0 | 0 | 0 |

Vistas recorridas: home, catálogo, búsqueda con y sin resultados, filtros, ficha
de producto, carrito vacío, carrito con productos, checkout, validaciones del
checkout, perfil, editor de dirección y seguimiento.

Overflow horizontal 0 px también en iPhone 13 (WebKit) y Pixel 7 (Chromium) con
sus descriptores de dispositivo reales.

### 4.2 Capturas

```
npm run qa:taba2:commercial-screenshots
```

**151 PNG** en `artifacts/taba2-commercial-audit/final/`, a `deviceScaleFactor
2`:

- `chromium/{320,375,390,414,432,desktop}/` — 15 vistas cada uno;
- `webkit/{320,390,432}/` — las mismas 15;
- `{chromium,webkit}/pago/` — los cinco estados del retorno;
- `dispositivos/` — iPhone 13 y Pixel 7.

**Las imágenes no se versionan** (28 MB) y `.gitignore` las excluye, siguiendo
la convención que el repo ya tenía para artefactos. Lo que se versiona es cómo
regenerarlas.

### 4.3 Suites

| Suite | Resultado |
| --- | --- |
| `npm run check` | Pasa |
| `npm test` | **1.028 pasan**, 0 fallan |
| `npx playwright test` | **204 pasan**, 0 fallan |

Se sumaron `tests/combos.test.mjs` (12), `tests/catalog-pending.test.mjs` (5) y
`tests/e2e/combos.spec.mjs` (8).

Cinco specs existentes se actualizaron al contrato nuevo. En los cinco, lo que
el test protegía **no cambió** —superficie única, ficha honesta sin precio,
composición de la góndola—; cambió el valor concreto. El detalle está en el
mensaje de cada commit.

---

## 5. Riesgos de integración

Ordenados por lo que puede salir mal.

### 5.1 Los combos todavía no se cobran a precio de combo — BLOQUEANTE

**El precio promocional no lo aplica nadie.** El descuento es una propuesta
armada sobre precios de componente confirmados; quien tiene que aplicarlo al
total es el backend de pedidos, que está fuera del alcance de esta rama.

Por eso los siete combos están en `PENDIENTE_APROBACION_COMERCIAL` y la ficha
**no ofrece "Agregar combo"**: hacerlo cobraría la suma de los precios de lista
y el ahorro anunciado sería mentira. El pie lo dice y lleva a los componentes.

**Para integrar hace falta**, en orden: (1) que Operaciones apruebe los siete
descuentos; (2) que pedidos sepa representar una línea de combo y aplicar su
precio; (3) que stock descuente los componentes según cantidad. Recién ahí tiene
sentido habilitar la compra del combo. **Publicar los combos sin (2) es cobrar
de más.**

### 5.2 Las nueve unidades de gaseosa y mixer no tienen precio unitario

El precio confirmado es el del pack. Dividirlo por seis sería inventar el precio
de venta, que incluye el margen que fija el local. Hasta que el negocio confirme
precio unitario, **la tienda sólo vende cerveza y energizantes**.

Es el bloqueo comercial más caro y de los más baratos de resolver: son nueve
números que alguien del local ya conoce.

### 5.3 La taxonomía cambió y hay ids que ya no existen

`gin`, `vodka`, `whisky` y `complementos` dejaron de ser categorías. Si algún
sistema externo —panel operativo, importador, reportes— filtra por esos ids,
deja de encontrar producto. Los glifos de la app mantienen alias para los ids
heredados, pero **eso es cosmética, no compatibilidad de datos**.

`scripts/validate-product-catalog.mjs` conserva su vocabulario de importación
sin tocar (`Gins y vodkas`, `Whisky y destilados`, `Picadas y deli`, …): es el
contrato con el importador y no era de esta rama cambiarlo. **La taxonomía de
visualización y la de importación hoy no coinciden**, y conviene unificarlas
antes de que una tercera se sume.

### 5.4 El service worker cambió de versión

`CACHE_NAME` pasó a `la-taba-runtime-v45-gondola` y todas las hojas a `?v=41`.
Es lo que hace que un cliente con la app instalada reciba la identidad nueva en
vez de servir grafito con tinta de papel desde caché. Si el deploy no publica
`sw.js` junto con los estilos, la mezcla es peor que cualquiera de las dos
versiones enteras.

### 5.5 `:has()` en los retornos de pago

El sello de estado usa `:has()` (Safari 15.4+, Chrome 105+). Sin soporte queda
el sello neutro, que es el estado honesto de "todavía verificando" — degrada,
no rompe. El título, el detalle y la acción no dependen de `:has()`.

### 5.6 Combos y promociones son dos motores distintos

`core/promotions.js` sigue manejando las promociones y `core/combos.js` es
nuevo. No se tocaron entre sí, pero **la home ya tiene dos secciones que pueden
mostrar un descuento**. Si Operaciones publica una promoción sobre un producto
que además está en un combo, hoy nada las concilia.

---

## 6. Fuera de alcance, respetado

Sin tocar: `supabase/migrations/**`, `supabase/functions/**`, pagos, checkout
backend, pedidos, stock, RLS, `styles/business.css`, `styles/rider.css`,
`js/business.js`, `js/delivery.js`, `js/pos/**`, secretos.

Sin deploy a `taba2-staging.pages.dev`. Todo el trabajo se hizo contra un preview
local aislado (`node scripts/realtime-relay.mjs 8231`). No se aplicó ningún
cambio a la base remota.

El panel operativo conserva su superficie clara certificada, verificado por
test: *«el panel operativo conserva su superficie clara»* en
`tests/e2e/taba2-brand-home.spec.mjs`.

---

## 7. Archivos de la entrega

**Identidad y componentes**
`styles/tokens.css` · `styles/brand-home.css` · `styles/catalog.css` ·
`styles/checkout.css` · `styles/profile.css` · `styles/storefront.css` ·
`styles/tracking.css` · `styles/common.css` · `styles/responsive.css` ·
`styles.css` · `index.html` · `js/ui.js` · `js/app.js` · `sw.js`

**Retornos de pago**
`pago/resultado/index.html` · `pago/pendiente/index.html` · `pago/error/index.html`

**Catálogo**
`scripts/taba2-catalog-authority.mjs` · `catalog/products.json` ·
`catalog/products.csv` · `js/taba2-commercial-pending-data.js` ·
`js/core/beverage-home-sections.js` · `catalog/catalog-pending.csv` ·
`scripts/build-catalog-pending.mjs`

**Combos**
`data/combos.csv` · `js/combos-data.js` · `js/core/combos.js`

**Validación**
`scripts/taba2-commercial-audit.mjs` · `scripts/taba2-commercial-screenshots.mjs` ·
`tests/combos.test.mjs` · `tests/catalog-pending.test.mjs` ·
`tests/e2e/combos.spec.mjs` · cinco specs actualizados

---

TABA2_COMMERCIAL_STOREFRONT_AND_CATALOG_READY_FOR_INTEGRATION
