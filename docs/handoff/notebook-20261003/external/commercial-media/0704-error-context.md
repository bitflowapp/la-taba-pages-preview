# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-commercial-p1-closure.spec.mjs >> P1-3: bajo el mínimo, Confirmar muestra el error real y nunca un upsell
- Location: tests\e2e\taba2-commercial-p1-closure.spec.mjs:149:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator: locator('.mobile-nav [data-cart-count]')
Expected: "1"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('.mobile-nav [data-cart-count]')

```

```yaml
- banner:
  - button "Ir al inicio del comercio":
    - strong: La Taba
  - button "ENVIAR A Avenida Argentina 450":
    - text: ENVIAR A
    - strong: Avenida Argentina 450
  - button "Ver mi pedido"
- main:
  - heading "Tu pedido" [level=1]
  - button "Seguir comprando"
  - button "Vaciar carrito"
  - status
  - heading "Productos" [level=3]
  - 'img "Producto sin imagen oficial: Heineken"'
  - text: Heineken 473 ml · Lata
  - button "Quitar Heineken 473 ml · Lata del pedido"
  - strong: "1"
  - button "Sumar uno de Heineken 473 ml · Lata"
  - text: $ 3.900
  - complementary:
    - strong: Te faltan $ 1.100 para llegar al mínimo
    - text: El mínimo de delivery es $ 5.000. El costo de envío se informa por separado.
  - text: Para entregarte el pedido
  - heading "Datos de entrega" [level=3]
  - radio "Delivery" [checked]
  - text: Delivery
  - radio "Retiro en local"
  - text: Retiro en local
  - region "Tus datos":
    - heading "Tus datos" [level=4]
    - strong: Cliente Demo
    - text: 299 000 0001
    - button "Editar en Perfil"
    - text: ¿Dónde lo llevamos?
    - button "Administrar en Perfil"
    - radiogroup "¿Dónde lo llevamos?":
      - radio "Casa Principal Avenida Argentina 450, Neuquén Capital Portón negro, timbre 2 Ubicación confirmada" [checked]
      - strong: Casa
      - text: Principal Avenida Argentina 450, Neuquén Capital Portón negro, timbre 2 Ubicación confirmada
      - radio "Trabajo Julio Argentino Roca 1220, Neuquén Capital Oficina 4B Ubicación confirmada"
      - strong: Trabajo
      - text: Julio Argentino Roca 1220, Neuquén Capital Oficina 4B Ubicación confirmada
      - radio "Casa de mamá Diagonal 9 de Julio 87, Neuquén Capital Ubicación confirmada"
      - strong: Casa de mamá
      - text: Diagonal 9 de Julio 87, Neuquén Capital Ubicación confirmada
    - button "Ver las 4 direcciones (1 más)"
    - button "+ Nueva dirección"
  - text: Forma de pago
  - combobox "Forma de pago":
    - option "A coordinar con el local" [selected]
    - option "Efectivo al recibir"
  - text: El medio se confirma antes de preparar el pedido.
  - group: Agregar indicaciones
  - checkbox "Confirmo que soy mayor de 18 años Presentaremos esta validación únicamente para productos con alcohol."
  - strong: Confirmo que soy mayor de 18 años
  - text: Presentaremos esta validación únicamente para productos con alcohol. Subtotal
  - strong: $ 3.900
  - text: Envío a domicilio
  - strong: $ 1.990
  - text: Total
  - strong: $ 5.890
  - alert: Te faltan $ 1.100 para llegar al pedido mínimo de delivery. También podés elegir retiro en local.
  - strong: Revisá antes de confirmar.
  - text: Al confirmar, el pedido queda tomado y podés seguirlo desde Seguimiento.
  - button "Confirmar pedido"
  - paragraph: El medio de pago se coordina con el local.
- navigation "Navegación móvil":
  - button "Inicio"
  - button "Catálogo"
  - button "Mis pedidos"
  - button "Perfil"
```

# Test source

```ts
  72  |   // La puerta de marca Heineken sigue: su búsqueda trae una lata comprable.
  73  |   const heineken = page.locator('.home-brand-banner[data-brand-query="Heineken"]');
  74  |   await expect(heineken).toBeVisible();
  75  |   await heineken.click();
  76  |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  77  |   await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();
  78  |   await page.goBack();
  79  |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  80  |   await guards.assertClean();
  81  | });
  82  | 
  83  | test('P1-2: en demo la historia de whisky (sin comprables) se apaga y ninguna promete lo invendible', async ({ page }) => {
  84  |   const guards = installPageGuards(page);
  85  |   await openHome(page);
  86  | 
  87  |   // De las 4 historias sembradas quedan las que tienen destino comprable. La
  88  |   // de Jack Daniel's apuntaba a `whisky` (1 producto, sin precio, y de otra
  89  |   // marca). Desde la publicación minorista también se apagó la de Schweppes:
  90  |   // mixers dejó de tener comprables cuando el pack de seis salió de la góndola
  91  |   // y la botella suelta todavía espera precio. El contrato es el mismo —una
  92  |   // historia no promete lo que no se puede comprar— y sigue al catálogo.
  93  |   const historiasEsperadas = 2;
  94  |   await page.locator('.brand-hero .brand-logo-action').click();
  95  |   const modal = page.locator('[data-stories-modal]');
  96  |   await expect(modal).toBeVisible();
  97  |   await expect(modal.locator('.stories-progress span')).toHaveCount(historiasEsperadas);
  98  |   for (let index = 0; index < historiasEsperadas; index += 1) {
  99  |     await expect(modal.locator('h2')).not.toContainText('Jack');
  100 |     await expect(modal.locator('[data-story-cta]')).toBeVisible();
  101 |     if (index < historiasEsperadas - 1) await modal.locator('[data-story-next]').click();
  102 |   }
  103 |   await page.keyboard.press('Escape');
  104 |   await guards.assertClean();
  105 | });
  106 | 
  107 | test('P1-2: el contrato aplica a cualquier origen — historia con destino no comprable se apaga, la editorial sin CTA sigue', async ({ page }) => {
  108 |   const guards = installPageGuards(page);
  109 |   const media = 'assets/products/beverage-placeholder.svg';
  110 |   const base = {
  111 |     business_id: 'la-taba-2',
  112 |     media_type: 'image',
  113 |     media_url: media,
  114 |     thumbnail_url: media,
  115 |     starts_at: null,
  116 |     expires_at: null,
  117 |     priority: 1,
  118 |     is_highlight: false,
  119 |     published: true,
  120 |   };
  121 |   await openHome(page, {
  122 |     stories: [
  123 |       { ...base, id: 's-whisky', title: 'Whisky del bueno', cta_type: 'category', cta_target: 'whisky' },
  124 |       { ...base, id: 's-editorial', title: 'Postal del local' },
  125 |     ],
  126 |   });
  127 | 
  128 |   // Sólo sobrevive la editorial sin CTA: promete mirar, no comprar.
  129 |   const entrada = page.locator('.brand-hero [data-stories-slot]');
  130 |   await expect(entrada).toHaveAttribute('data-stories-state', 'unseen');
  131 |   // Un solo círculo en la fila: la que apunta a un whisky sin precio no se
  132 |   // publica, y la fila no puede mostrar más historias que las que existen.
  133 |   await expect(page.locator('.brand-hero .brand-story-circle')).toHaveCount(1);
  134 |   await expect(page.locator('.brand-hero .brand-story-circle[data-story-seen="false"]')).toHaveCount(1);
  135 | 
  136 |   await page.locator('.brand-hero .brand-logo-action').click();
  137 |   const modal = page.locator('[data-stories-modal]');
  138 |   await expect(modal).toBeVisible();
  139 |   await expect(modal.locator('.stories-progress span')).toHaveCount(1);
  140 |   await expect(modal.locator('h2')).toHaveText('Postal del local');
  141 |   // El visor no fabrica una CTA para la pieza editorial.
  142 |   await expect(modal.locator('[data-story-cta]')).toHaveCount(0);
  143 |   await page.keyboard.press('Escape');
  144 |   await guards.assertClean();
  145 | });
  146 | 
  147 | // ── P1-3 ─────────────────────────────────────────────────────────────────────
  148 | 
  149 | test('P1-3: bajo el mínimo, Confirmar muestra el error real y nunca un upsell', async ({ page }) => {
  150 |   const guards = installPageGuards(page);
  151 |   await openHome(page);
  152 | 
  153 |   // Una Heineken ($3.900) queda bajo el mínimo de delivery ($5.000). Con
  154 |   // alcohol y sin acompañamiento, éste era exactamente el carrito que antes
  155 |   // disparaba el modal "ANTES DE PAGAR" por delante del error.
  156 |   await page.locator('[data-add-product="heineken-original-lata-473ml"]').first().click();
  157 |   await page.locator('[data-open-cart]').first().click();
  158 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  159 | 
  160 |   await page.locator('[data-checkout-submit]').click();
  161 | 
  162 |   // Cero upsell: ningún diálogo abierto. El error del mínimo, visible y con
  163 |   // el foco en el bloque del aviso.
  164 |   await expect(page.locator('dialog[open]')).toHaveCount(0);
  165 |   const warning = page.locator('[data-checkout-warning]');
  166 |   await expect(warning).toBeVisible();
  167 |   await expect(warning).toContainText('pedido mínimo');
  168 |   expect(await page.evaluate(() => document.activeElement?.className || '')).toContain('warning-box');
  169 | 
  170 |   // El pedido NO se envió y el carrito conserva sus datos.
  171 |   expect(await ordersInState(page)).toBe(1); // sólo la semilla LT-0001
> 172 |   await expect(page.locator('[data-floating-cart-count]')).toHaveText('1 producto');
      |                                                               ^ Error: expect(locator).toHaveText(expected) failed
  173 |   await guards.assertClean();
  174 | });
  175 | 
  176 | test('P1-3: con alcohol sin confirmar edad, el error llega antes que cualquier venta', async ({ page }) => {
  177 |   const guards = installPageGuards(page);
  178 |   await openHome(page);
  179 | 
  180 |   await page.locator('[data-add-product="heineken-original-lata-473ml"]').first().click();
  181 |   // Segunda unidad para superar el mínimo: el control ya es un stepper.
  182 |   await page.locator('[data-cart-inc="heineken-original-lata-473ml"]').first().click();
  183 |   await page.locator('[data-open-cart]').first().click();
  184 | 
  185 |   await page.locator('[data-checkout-submit]').click();
  186 |   await expect(page.locator('dialog[open]')).toHaveCount(0);
  187 |   await expect(page.locator('[data-checkout-warning]')).toContainText('mayor de edad');
  188 |   expect(await ordersInState(page)).toBe(1);
  189 | 
  190 |   // Con la edad confirmada el pedido sale: el camino feliz no cambió.
  191 |   await page.locator('[data-checkout-form] input[name="ageConfirmed"]').check();
  192 |   await page.locator('[data-checkout-submit]').click();
  193 |   await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  194 |   await expect(page.locator('[data-view="tracking"]')).toContainText('Tu pedido fue confirmado');
  195 |   await expect(page.locator('dialog[open]')).toHaveCount(0);
  196 |   expect(await ordersInState(page)).toBe(2);
  197 |   await guards.assertClean();
  198 | });
  199 | 
  200 | test('P1-3: el doble tap del CTA crea exactamente un pedido y ningún modal', async ({ page }) => {
  201 |   const guards = installPageGuards(page);
  202 |   await openHome(page);
  203 | 
  204 |   // Dos energizantes: superan el mínimo y no exigen edad. (Antes alcanzaba un
  205 |   // pack de gaseosa; desde la publicación minorista los packs abastecen y no
  206 |   // se venden, y las botellas sueltas todavía esperan precio.)
  207 |   await page.locator('[data-add-product="red-bull-original-lata-250ml"]').first().click();
  208 |   await page.locator('[data-add-product="monster-mango-loco-lata-473ml"]').first().click();
  209 |   await page.locator('[data-open-cart]').first().click();
  210 |   await expect(page.locator('[data-view="cart"]')).toBeVisible();
  211 | 
  212 |   await page.evaluate(() => {
  213 |     const button = document.querySelector('[data-checkout-submit]');
  214 |     button.click();
  215 |     button.click();
  216 |   });
  217 | 
  218 |   await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  219 |   await expect(page.locator('dialog[open]')).toHaveCount(0);
  220 |   expect(await ordersInState(page)).toBe(2); // semilla + UN pedido nuevo
  221 |   await guards.assertClean();
  222 | });
  223 | 
```