# Mapa de selectores — Customer de La Taba en producción

**Sitio:** https://la-taba.pages.dev
**Fecha del reconocimiento:** 2026-08-22
**Viewport:** 390 × 844 (Chromium, `serviceWorkers: 'block'`, `locale: 'es-AR'`)
**Sesión:** cliente anónimo, sin login, sin registro, sin confirmar pedido.

## Verificación de que el código local == el servido

Comparación byte a byte (SHA-256 de los primeros 16 hex, normalizando CRLF):

| Archivo | HTTP | Servido | Local | Resultado |
|---|---|---|---|---|
| `js/ui.js` | 200 | `65832e393fdf2008` (205 554 B) | `65832e393fdf2008` | **IDÉNTICO** |
| `js/cart.js` | 200 | `491993193e09211d` (20 634 B) | `491993193e09211d` | **IDÉNTICO** |
| `js/orders.js` | 200 | `11cbc1f7a1b4d089` (26 858 B) | `11cbc1f7a1b4d089` | **IDÉNTICO** |
| `js/app.js` | 200 | `d7867e09ed470be8` (87 362 B) | `d7867e09ed470be8` | **IDÉNTICO** |
| `js/core/order-timeline.js` | 200 | `a1dce3abcbad8d1a` | `a1dce3abcbad8d1a` | **IDÉNTICO** |
| `js/core/delivery-code.js` | 200 | `73bfb3c915f9f7bc` | `73bfb3c915f9f7bc` | **IDÉNTICO** |
| `js/core/order-status.js` | 200 | `b61940ebf5358592` | `b61940ebf5358592` | **IDÉNTICO** |

Los selectores que se leyeron del repo local valen tal cual contra producción.
`index.html` carga `js/app.js?v=46` (el `?v=` de los scripts de arranque es 2 y 4).

---

## 0. Cómo se navega (esto NO es lo que decía el encargo)

> **CORRECCIÓN IMPORTANTE:** no existen `#cart` ni `#tracking` como **id de elemento**.
> Las vistas son `<section class="app-view" data-view="...">` y sólo la activa lleva `.is-active`.
> `#cart` sí funciona como **ruta de hash** (otra cosa).

| Vista | Selector de la sección | Ruta hash | Botón de navegación |
|---|---|---|---|
| Inicio | `section.app-view[data-view="home"]` | `#home`, `#inicio` | `[data-nav-view="home"]` |
| Catálogo | `section.app-view[data-view="catalog"]` | `#catalog`, `#catalogo` | `[data-nav-view="catalog"]` |
| Carrito + Checkout | `section.app-view[data-view="cart"]` | `#cart`, `#carrito`, `#pedido` | `[data-nav-view="cart"]` |
| Seguir | `section.app-view[data-view="tracking"]` | `#tracking`, `#seguimiento`, `#seguir` | `[data-nav-view="tracking"]` |
| Cuenta / Perfil | `section.app-view[data-view="profile"]` | `#profile`, `#perfil`, `#local` | `[data-nav-view="profile"]` |

**Verificar la vista activa:**
```js
await page.evaluate(() => document.querySelector('.app-view.is-active')?.getAttribute('data-view'))
// o, más directo:
await expect(page.locator('[data-view="cart"]')).toHaveClass(/is-active/);
```

**Navegación recomendada para el harness — por hash, no por click:**
```js
await page.evaluate(() => { window.location.hash = '#cart'; });   // en caliente: OK
await page.goto('https://la-taba.pages.dev/#cart');                // en frío: OK
```
Ambas formas verificadas contra producción para `#catalog`, `#cart`, `#tracking`,
`#profile`, `#carrito`, `#seguir`. Es más estable que el click porque **hay 21 nodos
`[data-nav-view]` en la página** (tab bar inferior + nav de escritorio + CTAs), y la
mayoría están ocultos en 390 px.

> `#business` también resuelve (a la tarjeta de login del Panel). El harness **no debe
> ir ahí**.

---

## 1. Buscar un producto por nombre

Hay **tres** `[data-search-input]` en el DOM y **sólo uno está visible por vez**:

| # | Selector | Placeholder | Visible en | `data-search-jump` |
|---|---|---|---|---|
| 0 | `[data-search-input][data-search-jump]` (topbar) | `Buscar bebidas, marcas o presentaciones` | nunca en 390 px | sí |
| 1 | `[data-view="home"] [data-search-input]` | `Buscar bebidas, marcas y ofertas…` | vista **home** | sí |
| 2 | `[data-view="catalog"] [data-search-input]` | `Buscar productos, marcas y más…` | vista **catalog** | **no** |

| Acción | Selector exacto | Cómo verificar |
|---|---|---|
| Buscar desde la home | `[data-view="home"] [data-search-input]` → `.fill('Coca-Cola')` | La app **salta sola al catálogo** (`data-search-jump`): `.app-view.is-active` pasa a `catalog` |
| Buscar ya dentro del catálogo | `[data-view="catalog"] [data-search-input]` → `.fill('Coca-Cola')` | No cambia de vista; se repinta la grilla |
| Leer el título del resultado | `[data-catalog-title]` | Texto `"Resultados"` |
| Leer el conteo | `[data-catalog-count]` | Texto `"6 productos"` (`<p class="catalog-count">`) |
| Limpiar la búsqueda | `[data-clear-search]` | `<button class="search-clear" aria-label="Limpiar búsqueda">` |

**Recomendado para el harness** (una sola forma, sin depender de cuál está visible):
```js
await page.goto(`${BASE}/#catalog`);
await page.locator('[data-view="catalog"] [data-search-input]').fill('Coca-Cola');
await expect(page.locator('[data-catalog-count]')).toContainText('productos');
```

> **NO uses `[data-search-input]` pelado**: coincide con 3 nodos. `:visible` funciona pero
> depende de en qué vista estás; acotar por `[data-view="..."]` es determinista.

---

## 2. La tarjeta de producto

Contenedor de la grilla: **`[data-product-grid]`** (`div.product-grid`).
Tarjeta: **`[data-product-grid] article.product-card`**.

Modificadores de clase en la tarjeta: `out-of-stock`, `is-offer`, `in-cart`,
`is-motion-visible` (esta última la agrega la animación, **no** es semántica).

HTML real capturado en producción:

```html
<article class="product-card is-motion-visible" data-motion-reveal="card" style="--motion-index: 0;">
  <div class="product-media-frame">
    <button class="product-media" type="button" data-product-detail="44210832-…" aria-label="Ver Coca-Cola">
      <span class="thumb uses-placeholder …" role="img" aria-label="Producto sin imagen oficial: Coca-Cola">
        <img class="thumb-img is-placeholder" src="assets/products/beverage-placeholder.svg"
             data-product-name="Coca-Cola" …>
      </span>
      <span class="product-stock-tag" aria-hidden="true"></span>
    </button>
    <button class="product-favorite" data-favorite-toggle="44210832-…" …></button>
  </div>
  <div class="product-body">
    <h3>Coca-Cola</h3>
    <p>2,25 L · Original</p>
    <div class="product-foot">
      <div class="price"><div class="price-amounts"><strong>$&nbsp;5.900</strong></div></div>
      <div class="product-action">
        <button class="add-button" type="button" data-add-product="44210832-…"
                aria-label="Agregar Coca-Cola al pedido">
          <span class="add-plus">+</span><span class="add-text">Agregar</span>
        </button>
      </div>
    </div>
  </div>
</article>
```

| Dato | Selector relativo a `.product-card` | Notas |
|---|---|---|
| Nombre | `h3` | Texto visible |
| Presentación | `.product-body > p` | p. ej. `2,25 L · Original`, `Pack x12 · 500 ml` |
| Marca | `.product-brand` (vacío en los SKU auditados) | Suele no renderizarse |
| Precio | `.price strong` | **`$ 5.900`** (espacio duro U+00A0) |
| Precio tachado (oferta) | `.price s` | Sólo si hay precio regular mayor |
| Condición de promo | `.price .price-condition` | Opcional |
| Botón agregar | `[data-add-product]` | El valor es el **UUID del producto** |
| Abrir detalle | `[data-product-detail]` | Mismo UUID |
| Favorito | `[data-favorite-toggle]` | Mismo UUID |
| Pastilla de stock | `.product-stock-tag .stock-pill` | `Agotado` / `Últimas N` / `No disponible` / vacío |
| Marca +18 | `.product-age-tag` | Sólo alcohol |

### Localizar una tarjeta por su nombre visible

```js
// CORRECTO: por h3 exacto, acotado a la grilla
const card = page.locator('[data-product-grid] .product-card')
  .filter({ has: page.locator('h3', { hasText: /^Coca-Cola$/ }) });
```

O, si además tenés que desambiguar por presentación (ver el aviso de abajo):

```js
const card = page.locator('[data-product-grid] .product-card').filter({
  has: page.getByRole('heading', { level: 3, name: 'Coca-Cola', exact: true }),
}).filter({ hasText: '2,25 L · Original' });
```

---

## 3. Agregar 1 unidad y leer el contador

El botón **"Agregar" se reemplaza por el stepper** en el mismo hueco `.product-action`.

```html
<div class="product-action">
  <div class="qty-stepper is-just-added" aria-label="Cantidad de Coca-Cola en el pedido" data-added-flash>
    <button class="… qty-stepper-remove" data-cart-dec="44210832-…" aria-label="Quitar Coca-Cola del pedido">🗑</button>
    <strong aria-live="polite" class="motion-quantity-pop">1</strong>
    <button class="…" data-cart-inc="44210832-…" aria-label="Sumar uno de Coca-Cola">+</button>
  </div>
</div>
```

| Acción | Selector exacto | Cómo verificar |
|---|---|---|
| Agregar | `[data-product-grid] [data-add-product="<uuid>"]` | Aparece `.qty-stepper` en esa tarjeta |
| Leer cantidad **en la tarjeta** | `.product-card .qty-stepper strong` | Texto `"1"` |
| Sumar | `[data-product-grid] [data-cart-inc="<uuid>"]` | El `strong` pasa a `"2"` (verificado) |
| Restar | `[data-product-grid] [data-cart-dec="<uuid>"]` | Vuelve a `"1"` (verificado) |
| Quitar del todo | mismo `[data-cart-dec]` con cantidad 1 | El stepper vuelve a ser `[data-add-product]` |
| Marca de "recién agregado" | `.qty-stepper[data-added-flash]` | Efímero; **no lo uses para aserciones** |

**El icono del botón izquierdo cambia según la cantidad:** con `1` es un tacho de basura
(`aria-label="Quitar X del pedido"`, texto visible **vacío**); con `≥2` es un `−`
(`aria-label="Restar uno de X"`). El selector `[data-cart-dec]` no cambia — apoyate en él,
nunca en el texto del botón.

### Contadores globales tras agregar (todos verificados)

| Dato | Selector | Valor observado |
|---|---|---|
| Contador del carrito (×3 nodos) | `[data-cart-count]` | `"1"` |
| Nav "Pedidos" | `[data-nav-view="cart"]` | innerText `"Pedidos 1"` |
| Barra flotante | `[data-floating-cart]` (también tiene `data-open-cart`) | — |
| Unidades | `[data-floating-cart-count]` | `"1 producto"` |
| Total flotante | `[data-floating-cart-summary]` | `"$ 5.900"` |
| Total chico del topbar | `[data-cart-total-small]` | `"$ 5.900"` |

---

## 4. El carrito

Vista: `[data-view="cart"]`. Lista: **`[data-cart-list]`**. Línea: **`.cart-item`**.

```html
<div data-cart-list>
  <div class="cart-item">
    <span class="thumb …"><img class="thumb-img" data-product-name="Coca-Cola" …></span>
    <div class="cart-item-info">
      <div class="cart-title">Coca-Cola</div>
      <div class="cart-meta">2,25 L · Original · $&nbsp;5.900 c/u</div>
    </div>
    <div class="cart-item-side">
      <div class="quantity-control" aria-label="Cantidad de Coca-Cola en el pedido">
        <button data-cart-dec="44210832-…">−</button>
        <strong aria-live="polite">2</strong>
        <button data-cart-inc="44210832-…">+</button>
      </div>
      <div class="cart-line">$&nbsp;11.800</div>
    </div>
  </div>
</div>
```

| Dato | Selector relativo a `.cart-item` | Notas |
|---|---|---|
| Nombre | `.cart-title` | |
| Presentación + unitario | `.cart-meta` | **Formato variable**, ver aviso |
| Cantidad | `.quantity-control strong` | ⚠️ acá es `.quantity-control`, **no** `.qty-stepper` |
| Sumar / restar | `[data-cart-inc]` / `[data-cart-dec]` | El valor es el UUID → **la única forma de sacar el productId de una línea** |
| Total de la línea | `.cart-line` | `$ 11.800` |
| Problema en la línea | `.cart-item.has-issue` + `.cart-item-issue` + `[data-cart-fit]` | Sin stock / no disponible |
| Línea de **combo** | `.cart-item.cart-item-combo[data-cart-combo="<comboId>"]` | Los combos **sí** llevan `data-*`; los productos sueltos **no** |

### Totales

Contenedor: **`[data-order-summary]`** (`div.summary-box`). Filas: `.summary-row`, con
`<span>` etiqueta + `<strong>` valor. El total es `.summary-row.total`.

```html
<div class="summary-box" data-order-summary>
  <div class="summary-row"><span>Subtotal</span><strong>$&nbsp;17.700</strong></div>
  <div class="summary-row"><span>Envío a domicilio</span><strong>$&nbsp;0</strong></div>
  <div class="summary-row total"><span>Total</span><strong>$&nbsp;17.700</strong></div>
</div>
```

| Dato | Cómo leerlo | Notas |
|---|---|---|
| Total | `[data-order-summary] .summary-row.total strong` | **El único con selector propio y estable** |
| Subtotal | fila cuyo `<span>` es `Subtotal` | ⚠️ sin `data-*`; buscar por texto de la etiqueta |
| Envío | fila cuyo `<span>` es `Envío a domicilio` (o `Retiro en local` en pickup) | valor `A coordinar` cuando el envío se coordina |
| Descuentos | `.summary-row.discount` | combos, promos, cupón, envío gratis |
| Promos pendientes | `.summary-row.muted` | |

Lectura robusta:
```js
const rowValue = (label) => page.locator('[data-order-summary] .summary-row')
  .filter({ has: page.locator('span', { hasText: new RegExp(`^${label}`) }) })
  .locator('strong').innerText();
```

### Otros nodos de la vista carrito

| Nodo | Selector | Estado observado (anónimo) |
|---|---|---|
| Vaciar carrito | `[data-clear-cart]` → confirma con `[data-clear-cart-confirm]` / `[data-clear-cart-dismiss]` | modal |
| Aviso del carrito | `[data-cart-notice]` | vacío |
| Progreso de mínimo | `[data-cart-minimum-progress]` | **vacío** — no hay mínimo activo en producción |
| Recomendados | `[data-cart-recommendations]` | |
| Seguir comprando | `[data-view="cart"] [data-nav-view="catalog"]` | |
| Carrito vacío | `[data-cart-list]` sin `.cart-item`; texto `"Tu pedido está vacío"` | `[data-checkout-submit]` **sigue existiendo**, oculto |

---

## 5. El checkout

**Está en la MISMA vista `[data-view="cart"]`.** No hay pantalla aparte ni paso extra.
El formulario es `[data-checkout-form]` y `[data-checkout-phase]` vale `"full"`.

### Método de pago — es un `<select>`, NO radios

```html
<label class="checkout-payment-field">
  Forma de pago
  <select name="paymentMethod" aria-label="Forma de pago" data-mercadopago-available="false">
    <option value="coordinate">A coordinar con el local</option>
    <option value="cash">Efectivo al recibir</option>
  </select>
</label>
```

| Acción | Selector exacto | Valor |
|---|---|---|
| Selector de pago | `[data-checkout-form] select[name="paymentMethod"]` | por defecto `"coordinate"` |
| "A coordinar con el local" | `.selectOption('coordinate')` | |
| "Efectivo al recibir" | `.selectOption('cash')` | |
| Disponibilidad de MP | `select[name="paymentMethod"][data-mercadopago-available]` | `"false"` en producción hoy |
| Nota bajo el pago | `[data-payment-note]` | |
| Nota de modo | `[data-checkout-mode-note]` | `"El pago se coordina directamente con el local."` |

> Sólo existen **dos** opciones. `transfer` y `mercadopago` no están en el DOM
> (el `<select>` lleva un comentario HTML explicando que agregar una opción fuera del
> CHECK `orders_payment_method_valid` rompía el insert).

### Modo de entrega

| Nodo | Selector | Estado |
|---|---|---|
| Radios | `input[name="deliveryMode"][value="delivery"]` / `[value="pickup"]` | `delivery` marcado; `pickup` **no visible** |
| Etiquetas clicables | `[data-fulfillment-option="delivery"]` / `[data-fulfillment-option="pickup"]` | textos `Delivery` / `Retiro en local` |

### Bloque de dirección / perfil

| Nodo | Selector |
|---|---|
| Contenedor de direcciones | `[data-customer-addresses]` |
| Sección "Tus datos" | `[data-profile-checkout]` (`section.profile-checkout`, `data-checkout-phase="full"`) |
| Título | `#profile-checkout-title` / `.profile-checkout-title` |
| Estado de dirección guardada | `.saved-address-status` (`aria-live="polite"`) |
| Campos ocultos del form | `[data-checkout-form] input[name="customerName" \| "customerPhone" \| "customerStreetAddress" \| "customerNeighborhood" \| "customerReference" \| "customerAddress" \| "customerAddressId" \| "deliveryStreet" \| "deliveryLatitude" \| …]` | todos `type="hidden"` |
| Indicaciones | `textarea[name="customerNotes"]` |
| Confirmación +18 | `[data-age-confirmation]` con `input[name="ageConfirmed"]` | **oculto** (`hidden aria-hidden="true"`) salvo carrito con alcohol |

---

## 6. EL GATE (cliente anónimo sin perfil)

### ⛔ Lo más importante de todo este documento

**`[data-checkout-submit]` NO está deshabilitado.** Medido en producción:

```json
{
  "outer": "<button class=\"primary-button confirm-button\" type=\"submit\" data-checkout-submit>Confirmar pedido</button>",
  "text": "Confirmar pedido",
  "disabled": false,
  "ariaDisabled": null,
  "visible": true,
  "type": "submit"
}
```

Es `disabled: false` **también con el carrito vacío** (ahí sólo está oculto) y **también
sin perfil ni dirección**. El gate **no es un atributo**: es la validación que corre
*después* del submit. En `js/app.js:1777` el handler de `submit` va directo a
`getOrderRepository().createOrder(values)` — o sea, **una RPC real contra la base de
producción**. No existe ninguna guarda en el cliente que lo frene antes.

> **REGLA PARA EL HARNESS: `[data-checkout-submit]` es un botón armado.**
> Tocarlo "para ver qué pasa" intenta crear un pedido real. Nunca hagas `.click()` sobre
> él ni `form.requestSubmit()` salvo en el paso deliberado de crear el pedido. Cuidado
> también con `page.keyboard.press('Enter')` dentro de `[data-checkout-form]`: dispara el
> mismo submit.

### Lo que sí bloquea (visualmente) a un anónimo

Dos tarjetas dentro de `[data-profile-checkout]`, ambas con `role="status"`:

| Bloque | Selector | Título (texto exacto) | Botón |
|---|---|---|---|
| Perfil incompleto | `[data-profile-block="incomplete"]` | `Completá tu perfil para continuar` | `[data-profile-checkout-action="edit-profile"]` → **"Completar Perfil"** |
| Sin dirección | `[data-profile-block="no-address"]` | `Agregá una dirección para recibir el pedido` | `[data-profile-checkout-action="add-address"]` → **"Agregar dirección en Perfil"** |

Textos secundarios:
- `Necesitamos tu nombre y teléfono para que el local pueda entregarte el pedido.`
- `Guardás la dirección una vez en tu Perfil y después la elegís en cada compra.`

| Nodo | Selector | Estado observado |
|---|---|---|
| **Botón final** | `[data-checkout-submit]` | `Confirmar pedido`, **habilitado** |
| Caja de error/aviso | `[data-checkout-warning]` (`#checkout-error`, `role="alert"`) | clase `hidden`, texto residual `"Pedido listo para confirmar."` |
| Título de confianza | `[data-checkout-trust-title]` | `Pedido online al local.` |
| Copy de confianza | `[data-checkout-trust-copy]` | `Al confirmar, el pedido se registra en el sistema del comercio.` |

> ⚠️ `[data-checkout-warning]` dice **"Pedido listo para confirmar."** aun con el gate
> abierto. Está con clase `hidden`, así que hay que mirar la clase, no el texto:
> `await expect(page.locator('[data-checkout-warning]')).toHaveClass(/hidden/)`.

**Aserción correcta del gate (sin tocar el botón):**
```js
await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
await expect(page.locator('[data-profile-checkout-action="edit-profile"]'))
  .toHaveText('Completar Perfil');
await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
// El botón existe y está habilitado: eso NO es "listo para confirmar".
await expect(page.locator('[data-checkout-submit]')).toBeEnabled();
```

Cuando el perfil está completo, `[data-profile-block="incomplete"]` y
`[data-profile-block="no-address"]` desaparecen: **su ausencia es la señal de gate
cerrado**, no el estado del botón.

---

## 7. El PIN / código de entrega

Renderizado por `trackingDeliveryCodeCard()` — `js/ui.js:3625-3646`, verificado presente
en el `ui.js` servido.

```html
<section class="delivery-code-card" data-delivery-code-card>
  <span class="delivery-code-icon" aria-hidden="true">…</span>
  <div class="delivery-code-copy">
    <span>Código de entrega</span>
    <strong data-delivery-code="1234" aria-label="Código de entrega: 1 2 3 4">12 34</strong>
    <small>Decile este código al repartidor cuando recibas el pedido</small>
  </div>
</section>
```

| Dato | Selector exacto | Cómo leerlo |
|---|---|---|
| Tarjeta del PIN | `[data-delivery-code-card]` | Su presencia = el PIN está en pantalla |
| **PIN crudo (4 dígitos)** | `[data-delivery-code-card] strong[data-delivery-code]` → atributo `data-delivery-code` | `"1234"` — **usá el atributo, no el texto** |
| PIN formateado (visible) | mismo nodo, `.innerText` | `"12 34"` (`formatDeliveryCode`: `NN NN`, con espacio en el medio) |
| Etiqueta | `[data-delivery-code-card] .delivery-code-copy span` | `Código de entrega` |
| Instrucción | `[data-delivery-code-card] small` | `Decile este código al repartidor cuando recibas el pedido` |

```js
const pin = await page.locator('[data-delivery-code-card] [data-delivery-code]')
  .getAttribute('data-delivery-code');   // "1234"
```

### ⚠️ Cuándo aparece — no es "durante todo el pedido"

`trackingDeliveryCodeCard()` devuelve `''` (nada) salvo que se cumplan **las tres**:

1. `order.deliveryMode === 'delivery'` (en `pickup` **nunca** hay PIN),
2. `order.status ∈ {'arrived', 'arriving'}`,
3. el pedido trae `deliveryCode` con 4 dígitos.

O sea: **el cliente ve el PIN recién cuando el rider marcó que llegó.** Antes de eso no
existe en el DOM. Y `mergePublicTracking` (`supabase_order_repository.js:2553-2580`)
**borra** el `deliveryCode` en cuanto el estado es `delivered`, así que después de la
entrega tampoco está.

> El harness tiene una ventana acotada para leer el PIN de la UI: entre `arrived` y
> `delivered`. Si necesita el PIN antes, no hay superficie de cliente que lo muestre —
> y sacarlo de la base rompe la regla de leerlo de la UI.
> El único otro render del código en todo el repo es el del **Rider** (`[data-delivery-code-input]`,
> `js/delivery.js:426`) y el del **Panel** (`[data-delivery-code-summary]`, `js/business.js:965`;
> `[data-production-delivery-code]`, `js/production-operations.js:2462`) — superficies de otro rol.

### La vista "Seguir" SIN pedido (capturado en producción)

`[data-tracking-status="idle"]`. El mapa MapLibre está presente igual (es la sección
entera, no un cartel).

```
La Taba · Cobertura no publicada
Seguí tu pedido
Cuando hagas una compra, vas a poder seguir el recorrido del Rider desde acá.
[ Ver el catálogo ]
```

| Nodo | Selector |
|---|---|
| Panel raíz | `[data-tracking-panel]` |
| Estado | `[data-tracking-status="idle"]` |
| Tarjeta de vacío | `[data-tracking-idle-card]` |
| Título | `.tracking-idle-title` — `Seguí tu pedido` |
| CTA | `.tracking-idle-cta` (`[data-nav-view="catalog"]`) — `Ver el catálogo` |
| Hoja inferior | `[data-bottom-sheet]` |
| Nombre del local | `[data-business-name]` — `La Taba` |
| Mapa | `[data-real-map][data-map-role="tracking"]`, canvas en `[data-map-canvas]` |
| Frescura del mapa | `[data-map-freshness]`, `[data-tracking-map-freshness]` |

---

## 8. Estados del pedido que ve el cliente

### ⚠️ El cliente NO ve 8 estados: ve 7, y tres del encargo no existen en su UI

Los dos mapeadores que alimentan la vista del cliente
(`normalizePublicTrackingDto` línea 2466 y `rowToDemoOrder` línea 2693 de
`supabase_order_repository.js`) aplican `toDemoOrderStatus()`, que **colapsa** el
vocabulario de workflow:

| Estado en la base (workflow) | `order.status` en la UI del cliente |
|---|---|
| `draft`, `submitted` | **`received`** |
| **`accepted`** | **`preparing`** ← se pierde |
| `preparing` | `preparing` |
| `ready` | `ready` |
| **`assigned`** | **`ready`** ← se pierde |
| **`picked_up`** | **`on_the_way`** ← se pierde |
| `on_the_way` | `on_the_way` |
| `arrived` | **`arriving`** |
| `delivered` | `delivered` |
| `canceled` | `cancelled` |

> **`accepted`, `assigned` y `picked_up` son indistinguibles desde la UI del cliente.**
> Si el harness tiene que certificar esas transiciones, la evidencia tiene que salir del
> Panel o del Rider, no del Customer.

### Qué se pinta en cada estado

Raíz: `[data-tracking-status="<estado>"]` (`div.track-layout`, además `class="status-<estado>"`
y `has-rider`/`no-rider`), con `[data-tracking-freshness]`.

| `order.status` | `[data-tracking-title]` (h1) | `[data-tracking-arrival]` (p) | Paso `aria-current="step"` | Tarjeta del rider `[data-rider-status]` | PIN |
|---|---|---|---|---|---|
| `received` | `Tu pedido fue confirmado` | `Recibimos tu pedido y te avisaremos cada avance.` | **Confirmado** | `Repartidor aún no asignado` | no |
| `preparing` (incl. `accepted`) | `Estamos preparando tu pedido` | `El local ya está preparando tu pedido.` / `Tiempo estimado de preparación: N min.` | **Preparando** | `Repartidor aún no asignado` o `Rider asignado` | no |
| `ready` (incl. `assigned`) | `Tu pedido está listo` | `Está listo para salir con el repartidor.` | **Preparando** | `Esperando repartidor` / `Rider asignado` | no |
| `on_the_way` (incl. `picked_up`) | `Tu pedido está en camino` | `Llega en N min` (con GPS fresco) o `Calculando llegada` | **En camino** | `En camino` — `Tu pedido va con él` | no |
| `arriving` (= `arrived`) | `Tu pedido llegó` | `El repartidor está en tu domicilio` | **En camino** (ver nota) | `En la puerta` — `Prepará el código de entrega` | **SÍ** |
| `delivered` | `Pedido entregado` | `La entrega fue confirmada. Gracias por comprar en La Taba.` | **Entregado** | (sin tarjeta) | no (se borra) |
| `cancelled` | `Pedido cancelado` | `El local canceló este pedido.` / `Motivo: …` | ninguno (todos `pending`) | (sin tarjeta) | no |

En `pickup` (retiro) el h1 en `received` es `Tu pedido fue confirmado` /
`Te avisaremos cuando esté listo para retirar.`, y en `ready` el subtítulo es
`Te esperamos en <dirección del local>.`

### La línea de tiempo pública

`renderPublicOrderTimeline` — 4 pasos fijos, **sin `data-*`**:

```html
<div class="track-steps customer-progress public" role="list" aria-label="Progreso del pedido">
  <div class="track-step done"    role="listitem"><span class="track-dot"></span><small>Confirmado</small></div>
  <div class="track-step current" role="listitem" aria-current="step"><span class="track-dot"></span><small>Preparando</small></div>
  <div class="track-step pending" role="listitem"><span class="track-dot"></span><small>En camino</small></div>
  <div class="track-step pending" role="listitem"><span class="track-dot"></span><small>Entregado</small></div>
</div>
```

| Dato | Selector |
|---|---|
| La línea | `[data-tracking-panel] .track-steps.public` (o `.customer-progress`) |
| Paso actual | `.track-steps.public .track-step[aria-current="step"] small` |
| Pasos completados | `.track-steps.public .track-step.done` |
| Pedido cancelado | `.track-steps[aria-label="Pedido cancelado"]`, todos los pasos en `.pending` |

> **Defecto detectado (menor):** `renderPublicOrderTimeline` reetiqueta el 3er paso a
> **"Llegó"** sólo si recibe `'arriving'`, pero `renderTracking` (`js/ui.js:3899`) le pasa
> `timelineStatus`, que convierte `'arriving'` → `'arrived'` justo antes. Resultado: **la
> etiqueta "Llegó" nunca se pinta en la vista del cliente**; en `arriving` la línea sigue
> diciendo "En camino" mientras el h1 dice "Tu pedido llegó". No asertes "Llegó".

### Banner de pedido en curso (home)

| Nodo | Selector | Texto |
|---|---|---|
| Contenedor | `[data-home-active-order]` | `hidden` si no hay pedido activo |
| Banner | `.active-order-banner` (`[data-nav-view="tracking"]`) | `Tenés un pedido en curso` |
| Detalle | `.active-order-banner small` | `<orderId> · <statusLabel> · tocá para seguirlo` |

> ⚠️ `statusLabel()` usa `ORDER_STATUS_LABELS` (`js/core/order-status.js`) y cae al
> **enum crudo en inglés** cuando el estado no está en esa tabla. La tabla cubre los 7
> estados colapsados, pero **no** `accepted`, `assigned` ni `picked_up`: si alguno llegara
> sin colapsar, el banner imprimiría `accepted` tal cual. Con el mapeo actual no debería
> pasar — igual, no asertes contra este texto: usá `[data-tracking-status]`.

Etiquetas disponibles: `received→Recibido`, `preparing→Preparando`,
`ready→Listo para enviar`, `on_the_way→En camino`, `arriving→Llegando`,
`delivered→Entregado`, `cancelled→Cancelado`.

---

## 9. Selectores frágiles o ambiguos — leer antes de escribir el harness

| # | Riesgo | Detalle | Mitigación |
|---|---|---|---|
| **F1** | 🔴 **`[data-checkout-submit]` está SIEMPRE habilitado** | `disabled:false` incluso sin perfil, sin dirección y con carrito vacío. El submit llama `createOrder()` = RPC real contra producción. | Nunca `.click()`. Nunca `Enter` dentro de `[data-checkout-form]`. Asertá el gate por `[data-profile-block]`. |
| **F2** | 🔴 **El mismo producto está 3 veces en el DOM** | `[data-add-product="44210832-…"]` devuelve **3 nodos**: el de la grilla + los carruseles de la home (`.home-add-button`), ocultos pero presentes. `.first()` agarró el oculto y el click quedó colgado 30 s. | Acotá **siempre**: `[data-product-grid] [data-add-product="<uuid>"]`. |
| **F3** | 🔴 **Los nombres visibles NO son únicos** | En la búsqueda "Coca-Cola": `Coca-Cola` ×2 (2,25 L y 354 ml) y `Coca-Cola Zero` ×3 (2,25 L, Pack x12, 354 ml). | Desambiguá con `h3` **+** `.product-body > p`, o resolvé el UUID una vez y trabajá por `data-add-product`. |
| **F4** | 🔴 **`data-product-name` está en el `<img>`, no en la tarjeta** | `[data-product-name="Coca-Cola"]` selecciona un `img.thumb-img`. Y con el placeholder genérico ese atributo es lo único que lo identifica. | Para llegar a la tarjeta: `page.locator('[data-product-name="X"]').locator('xpath=ancestor::article[contains(@class,"product-card")]')`. Preferí `h3`. |
| **F5** | 🟠 **`[data-search-input]` coincide con 3 nodos** | Uno por vista; sólo uno visible. | `[data-view="catalog"] [data-search-input]`. |
| **F6** | 🟠 **`[data-nav-view]` coincide con 21 nodos** | Tab bar + nav de escritorio + CTAs; la mayoría ocultos en 390 px. `[data-nav-view="cart"]` sin `:visible` da timeout. | Navegá por hash (`window.location.hash = '#cart'`). |
| **F7** | 🟠 **`.cart-item` no tiene ningún `data-*`** | La única llave estable de la línea es el UUID dentro de `[data-cart-inc]` / `[data-cart-dec]`. Los combos sí llevan `[data-cart-combo]`. | `line.locator('[data-cart-inc]').getAttribute('data-cart-inc')`. |
| **F8** | 🟠 **Las filas del resumen no tienen `data-*` y son variables** | Entre Subtotal y Envío se insertan `.summary-row.discount` (combos, promos, cupón, envío gratis) y `.summary-row.muted`. Indexar por `nth-child` rompe. | Sólo el total tiene ancla propia (`.summary-row.total strong`); el resto, por texto del `<span>`. |
| **F9** | 🟠 **`.qty-stepper` en la tarjeta vs `.quantity-control` en el carrito** | Es el mismo componente con `className` distinto. `.qty-stepper strong` **no existe** dentro de `[data-cart-list]`. | Usá `.qty-stepper strong` en la grilla y `.quantity-control strong` en el carrito, o el común: `[data-cart-inc]` como ancla y `strong` hermano. |
| **F10** | 🟠 **Los precios llevan ` `** | `$ 5.900`, no `$ 5.900`. Un `toHaveText('$ 5.900')` falla. | Normalizá: `.replace(/ /g, ' ')`, o usá `toContainText('5.900')`. |
| **F11** | 🟠 **`[data-checkout-warning]` miente** | Con el gate abierto dice `"Pedido listo para confirmar."` — sólo la clase `hidden` lo desmiente. | Asertá la clase, nunca el texto. |
| **F12** | 🟠 **El PIN existe en una ventana angosta** | Sólo con `deliveryMode='delivery'` y `status ∈ {arrived, arriving}`. En `delivered` el mapeador lo borra. | Leelo apenas `[data-tracking-status="arriving"]`; usá el **atributo** `data-delivery-code`, no el texto `"12 34"`. |
| **F13** | 🟡 **El botón izquierdo del stepper cambia de forma** | Con qty=1 es un tacho con `innerText` **vacío** y `aria-label="Quitar X del pedido"`; con qty≥2 es `−` y `aria-label="Restar uno de X"`. | Anclá en `[data-cart-dec]`. |
| **F14** | 🟡 **La línea "Llegó" nunca se pinta** | Ver §8. | No asertes "Llegó" en la línea de tiempo. |
| **F15** | 🟡 **`.is-motion-visible` / `[data-added-flash]` / `.is-just-added` son efímeros** | Los pone la animación. | No los uses en aserciones. |
| **F16** | 🟡 **La hoja de instalación PWA puede robar taps** | Modal a los pocos segundos si el navegador no decidió. Ya mordió a otras suites. | Sembrá `localStorage['TABA_INSTALL_PROMPT_V1']` en un `addInitScript` (como hacen estos scripts). |
| **F17** | 🟡 **`[data-cart-minimum-progress]` está vacío hoy** | No hay mínimo de compra configurado en producción. Si el comercio lo activa, aparece una barra que puede frenar la confirmación. | No asumas que va a seguir vacío. |
| **F18** | 🟡 **`[data-age-confirmation]` está oculto hoy** | Aparece sólo con alcohol en el carrito. Suma un `input[name="ageConfirmed"]` obligatorio. | Si el pedido de prueba lleva alcohol, hay que tildarlo. |

---

## 10. Recorrido completo, listo para copiar

```js
const BASE = 'https://la-taba.pages.dev';

const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  serviceWorkers: 'block',
  locale: 'es-AR',
});
// F16: quien ya respondió a la invitación de instalar
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('TABA_INSTALL_PROMPT_V1',
      JSON.stringify({ dismissedAt: Date.now(), choice: 'later' }));
  } catch (e) {}
});
const page = await ctx.newPage();

// 1. Buscar
await page.goto(`${BASE}/#catalog`, { waitUntil: 'networkidle' });
await page.locator('[data-view="catalog"] [data-search-input]').fill('Coca-Cola');
await expect(page.locator('[data-catalog-count]')).toContainText('productos');

// 2. Localizar la tarjeta (F3: nombre + presentación)
const card = page.locator('[data-product-grid] .product-card')
  .filter({ has: page.getByRole('heading', { level: 3, name: 'Coca-Cola', exact: true }) })
  .filter({ hasText: '2,25 L · Original' });
await expect(card.locator('.price strong')).toContainText('5.900');
const productId = await card.locator('[data-add-product]').getAttribute('data-add-product');

// 3. Agregar (F2: SIEMPRE acotado a la grilla)
await page.locator(`[data-product-grid] [data-add-product="${productId}"]`).click();
await expect(card.locator('.qty-stepper strong')).toHaveText('1');
await page.locator(`[data-product-grid] [data-cart-inc="${productId}"]`).click();
await expect(card.locator('.qty-stepper strong')).toHaveText('2');

// 4. Carrito (F6: por hash)
await page.evaluate(() => { window.location.hash = '#cart'; });
await expect(page.locator('[data-view="cart"]')).toHaveClass(/is-active/);
const line = page.locator('[data-cart-list] .cart-item')
  .filter({ has: page.locator(`[data-cart-inc="${productId}"]`) });   // F7
await expect(line.locator('.cart-title')).toHaveText('Coca-Cola');
await expect(line.locator('.quantity-control strong')).toHaveText('2');   // F9
await expect(line.locator('.cart-line')).toContainText('11.800');          // F10
await expect(page.locator('[data-order-summary] .summary-row.total strong'))
  .toContainText('17.700');                                                // F8

// 5. Checkout (misma vista)
await page.locator('select[name="paymentMethod"]').selectOption('cash');
await expect(page.locator('select[name="paymentMethod"]')).toHaveValue('cash');

// 6. Gate — SIN tocar el botón (F1)
await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
await expect(page.locator('[data-profile-checkout-action="edit-profile"]'))
  .toHaveText('Completar Perfil');
await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
await expect(page.locator('[data-checkout-warning]')).toHaveClass(/hidden/);  // F11

// 7-8. Seguimiento y PIN (con un pedido en curso)
await page.evaluate(() => { window.location.hash = '#tracking'; });
const status = await page.locator('[data-tracking-status]').getAttribute('data-tracking-status');
const step   = await page.locator('.track-steps.public .track-step[aria-current="step"] small').innerText();
// El PIN sólo cuando status === 'arriving' (F12)
const pin = await page.locator('[data-delivery-code-card] [data-delivery-code]')
  .getAttribute('data-delivery-code');
```

---

## 11. Archivos de este reconocimiento

| Archivo | Qué contiene |
|---|---|
| `recon-01-home.mjs` / `.txt` | Vistas, inputs, navegación y censo de `data-*` de la home |
| `recon-02-flow.mjs` / `.txt` | Búsqueda, tarjeta, agregar/sumar/restar, contadores |
| `recon-03-cart-checkout.mjs` / `.txt` | Carrito, checkout, gate, tracking sin pedido, perfil anónimo |
| `recon-04-verificacion.mjs` / `.txt` | Servido vs local, buscador del catálogo, ambigüedad de nombres, carrito vacío |
| `recon-05-rutas.mjs` / `.txt` | Navegación por hash, lectura de líneas y totales tal como la hará el harness |
| `01-home.png`, `01-home-full.png` | Home |
| `02-busqueda-coca.png` | Resultados de "Coca-Cola" |
| `03-agregado.png` | Tarjeta con el stepper |
| `04-carrito.png`, `11-carrito-con-items.png` | Carrito con 2 líneas |
| `05-checkout-gate.png`, `12-gate-perfil.png` | El gate de perfil/dirección |
| `06-boton-confirmar.png` | "Confirmar pedido" habilitado sin perfil |
| `07-seguir-sin-pedido.png` | "Seguir" en `idle` |
| `08-perfil-anonimo.png` | Cuenta sin datos |
| `09-catalogo-busqueda.png` | Buscador dentro del catálogo |
| `10-carrito-vacio.png` | Carrito vacío |

Todos los scripts son **read-only**: agregan al carrito (localStorage) y abren el checkout;
ninguno toca `[data-checkout-submit]`, ni se registra, ni se loguea, ni escribe en la base.
