# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-brand-home.spec.mjs >> con historias vigentes el logo es botón, el aro se enciende y el acceso dice cuántas hay
- Location: tests\e2e\taba2-brand-home.spec.mjs:260:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: locator('.brand-hero [data-stories-slot]')
Expected: "unseen"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('.brand-hero [data-stories-slot]')

```

```yaml
- banner:
  - button "Ir al inicio del comercio":
    - strong: La Taba
  - button "Avenida Argentina 450":
    - strong: Avenida Argentina 450
  - button "Ver mi pedido"
- main:
  - region "La Taba":
    - heading "La Taba" [level=1]
    - paragraph: Delivery y retiro · Mendoza 827, Neuquén
    - paragraph: Pedidos disponibles
  - searchbox "Buscar productos o marcas"
  - button "Todas"
  - button "Cervezas"
  - button "Energizantes"
  - button "Bien fría, como tiene que ser. La selección de cervezas del local, lista para llevar. Ver cervezas":
    - text: La vidriera
    - strong: Bien fría, como tiene que ser
    - text: Ver cervezas
  - region "Destacados":
    - heading "Destacados" [level=2]
    - button "Ver todos"
    - article:
      - button "Guardar Heineken 473 ml · Lata de favoritos"
      - button "Ver Heineken. Venta exclusiva a mayores de 18 años":
        - img "Heineken"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Heineken
      - text: 473 ml · Lata $ 3.900
      - button "Agregar Heineken 473 ml · Lata al pedido"
    - article:
      - button "Guardar Corona Extra 330 ml de favoritos"
      - button "Ver Corona Extra. Venta exclusiva a mayores de 18 años":
        - img "Corona Extra"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Corona Extra
      - text: 330 ml $ 3.600
      - button "Agregar Corona Extra 330 ml al pedido"
    - article:
      - button "Guardar Red Bull Energy Drink 250 ml · Lata de favoritos"
      - button "Ver Red Bull Energy Drink":
        - img "Red Bull Energy Drink"
      - strong: Red Bull Energy Drink
      - text: 250 ml · Lata $ 3.576
      - button "Agregar Red Bull Energy Drink 250 ml · Lata al pedido"
    - article:
      - button "Guardar Monster Mango Loco 473 ml · Lata de favoritos"
      - button "Ver Monster Mango Loco":
        - img "Monster Mango Loco"
      - strong: Monster Mango Loco
      - text: 473 ml · Lata $ 3.390
      - button "Agregar Monster Mango Loco 473 ml · Lata al pedido"
    - article:
      - button "Guardar Speed Unlimited 473 ml · Lata de favoritos"
      - button "Ver Speed Unlimited Original":
        - img "Speed Unlimited Original"
      - strong: Speed Unlimited
      - text: 473 ml · Lata $ 2.925
      - button "Agregar Speed Unlimited 473 ml · Lata al pedido"
    - article:
      - button "Guardar Imperial APA 473 ml · Lata de favoritos"
      - button "Ver Imperial APA. Venta exclusiva a mayores de 18 años":
        - img "Imperial APA"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Imperial APA
      - text: 473 ml · Lata $ 3.000
      - button "Agregar Imperial APA 473 ml · Lata al pedido"
    - article:
      - button "Guardar Schneider Rubia 710 ml · Lata de favoritos"
      - button "Ver Schneider Rubia. Venta exclusiva a mayores de 18 años":
        - img "Schneider Rubia"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Schneider Rubia
      - text: 710 ml · Lata $ 3.500
      - button "Agregar Schneider Rubia 710 ml · Lata al pedido"
    - article:
      - button "Guardar Speed Unlimited Zero Sugar 473 ml · Lata de favoritos"
      - button "Ver Speed Unlimited Zero Sugar":
        - img "Speed Unlimited Zero Sugar"
      - strong: Speed Unlimited Zero Sugar
      - text: 473 ml · Lata $ 2.925
      - button "Agregar Speed Unlimited Zero Sugar 473 ml · Lata al pedido"
    - article:
      - button "Guardar Imperial Cream Stout 473 ml · Lata de favoritos"
      - button "Ver Imperial Cream Stout. Venta exclusiva a mayores de 18 años":
        - img "Imperial Cream Stout"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Imperial Cream Stout
      - text: 473 ml · Lata $ 3.000
      - button "Agregar Imperial Cream Stout 473 ml · Lata al pedido"
    - article:
      - button "Guardar Imperial Extra Lager 473 ml · Lata de favoritos"
      - button "Ver Imperial Extra Lager. Venta exclusiva a mayores de 18 años":
        - img "Imperial Extra Lager"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Imperial Extra Lager
      - text: 473 ml · Lata $ 3.000
      - button "Agregar Imperial Extra Lager 473 ml · Lata al pedido"
    - article:
      - button "Guardar Imperial Golden 473 ml · Lata de favoritos"
      - button "Ver Imperial Golden. Venta exclusiva a mayores de 18 años":
        - img "Imperial Golden"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Imperial Golden
      - text: 473 ml · Lata $ 3.000
      - button "Agregar Imperial Golden 473 ml · Lata al pedido"
  - button "Ver las 2 historias nuevas de La Taba"
  - button "Ver la historia Combo de la semana. Cervezas de La Taba. Nueva": Cervezas
  - button "Ver la historia Siempre frío. Energizantes de La Taba. Nueva": Energizantes
  - region "Combos":
    - heading "Combos" [level=2]
    - text: Armados por el local · hasta $ 2.752 de ahorro
    - article:
      - button "Ver el combo Previa Imperial":
        - emphasis: ×6
        - text: Ahorrás $ 2.200
      - strong: Previa Imperial
      - text: Seis latas bien frías para arrancar
      - paragraph: 6× Imperial Golden
      - text: $ 18.000
      - strong: $ 15.800
      - emphasis: −12.2%
      - text: +18 6 unidades Quedan 16
      - button "Ver qué trae"
    - article:
      - button "Ver el combo Heineken x6":
        - emphasis: ×6
        - text: Ahorrás $ 2.400
      - strong: Heineken x6
      - text: La verde, por media docena
      - paragraph: 6× Heineken
      - text: $ 23.400
      - strong: $ 21.000
      - emphasis: −10.3%
      - text: +18 6 unidades Quedan 16
      - button "Ver qué trae"
    - article:
      - button "Ver el combo Corona Extra x6":
        - emphasis: ×6
        - text: Ahorrás $ 2.200
      - strong: Corona Extra x6
      - text: Seis porrones de 330 ml
      - paragraph: 6× Corona Extra
      - text: $ 21.600
      - strong: $ 19.400
      - emphasis: −10.2%
      - text: +18 6 unidades Quedan 16
      - button "Ver qué trae"
    - article:
      - button "Ver el combo Birra y energía":
        - emphasis: ×4
        - emphasis: ×2
        - text: Ahorrás $ 2.150
      - strong: Birra y energía
      - text: Cuatro latas y dos para aguantar
      - paragraph: 4× Imperial Golden · 2× Speed Unlimited Original
      - text: $ 17.850
      - strong: $ 15.700
      - emphasis: −12%
      - text: +18 6 unidades Quedan 24
      - button "Ver qué trae"
    - article:
      - button "Ver el combo Tabla de cervezas": +2 Ahorrás $ 2.000
      - strong: Tabla de cervezas
      - text: Una de cada una, seis en total
      - paragraph: 1× Imperial Golden · 1× Imperial Extra Lager · 1× Imperial APA · 1× Imperial Cream Stout · 1× Schneider Rubia · 1× Corona Extra
      - text: $ 19.100
      - strong: $ 17.100
      - emphasis: −10.5%
      - text: +18 6 unidades Quedan 99
      - button "Ver qué trae"
    - article:
      - button "Ver el combo Noche larga":
        - emphasis: ×4
        - emphasis: ×2
        - text: Ahorrás $ 2.752
      - strong: Noche larga
      - text: Cuatro Heineken y dos Red Bull
      - paragraph: 4× Heineken · 2× Red Bull Energy Drink
      - text: $ 22.752
      - strong: $ 20.000
      - emphasis: −12.1%
      - text: +18 6 unidades Quedan 24
      - button "Ver qué trae"
    - article:
      - button "Ver el combo Cuatro para arrancar":
        - emphasis: ×4
        - text: Ahorrás $ 1.200
      - strong: Cuatro para arrancar
      - text: Speed por cuatro
      - paragraph: 4× Speed Unlimited Original
      - text: $ 11.700
      - strong: $ 10.500
      - emphasis: −10.3%
      - text: 4 unidades Quedan 24
      - button "Ver qué trae"
  - region "Cervezas":
    - heading "Cervezas" [level=2]
    - button "Ver todos"
    - article:
      - button "Guardar Heineken 473 ml · Lata de favoritos"
      - button "Ver Heineken. Venta exclusiva a mayores de 18 años":
        - img "Heineken"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Heineken
      - text: 473 ml · Lata $ 3.900
      - button "Agregar Heineken 473 ml · Lata al pedido"
    - article:
      - button "Guardar Corona Extra 330 ml de favoritos"
      - button "Ver Corona Extra. Venta exclusiva a mayores de 18 años":
        - img "Corona Extra"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Corona Extra
      - text: 330 ml $ 3.600
      - button "Agregar Corona Extra 330 ml al pedido"
    - article:
      - button "Guardar Imperial APA 473 ml · Lata de favoritos"
      - button "Ver Imperial APA. Venta exclusiva a mayores de 18 años":
        - img "Imperial APA"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Imperial APA
      - text: 473 ml · Lata $ 3.000
      - button "Agregar Imperial APA 473 ml · Lata al pedido"
    - article:
      - button "Guardar Imperial Cream Stout 473 ml · Lata de favoritos"
      - button "Ver Imperial Cream Stout. Venta exclusiva a mayores de 18 años":
        - img "Imperial Cream Stout"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Imperial Cream Stout
      - text: 473 ml · Lata $ 3.000
      - button "Agregar Imperial Cream Stout 473 ml · Lata al pedido"
    - article:
      - button "Guardar Imperial Extra Lager 473 ml · Lata de favoritos"
      - button "Ver Imperial Extra Lager. Venta exclusiva a mayores de 18 años":
        - img "Imperial Extra Lager"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Imperial Extra Lager
      - text: 473 ml · Lata $ 3.000
      - button "Agregar Imperial Extra Lager 473 ml · Lata al pedido"
    - article:
      - button "Guardar Imperial Golden 473 ml · Lata de favoritos"
      - button "Ver Imperial Golden. Venta exclusiva a mayores de 18 años":
        - img "Imperial Golden"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Imperial Golden
      - text: 473 ml · Lata $ 3.000
      - button "Agregar Imperial Golden 473 ml · Lata al pedido"
    - article:
      - button "Guardar Schneider Rubia 710 ml · Lata de favoritos"
      - button "Ver Schneider Rubia. Venta exclusiva a mayores de 18 años":
        - img "Schneider Rubia"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Schneider Rubia
      - text: 710 ml · Lata $ 3.500
      - button "Agregar Schneider Rubia 710 ml · Lata al pedido"
  - region "Energizantes":
    - heading "Energizantes" [level=2]
    - button "Ver todos"
    - article:
      - button "Guardar Red Bull Energy Drink 250 ml · Lata de favoritos"
      - button "Ver Red Bull Energy Drink":
        - img "Red Bull Energy Drink"
      - strong: Red Bull Energy Drink
      - text: 250 ml · Lata $ 3.576
      - button "Agregar Red Bull Energy Drink 250 ml · Lata al pedido"
    - article:
      - button "Guardar Monster Mango Loco 473 ml · Lata de favoritos"
      - button "Ver Monster Mango Loco":
        - img "Monster Mango Loco"
      - strong: Monster Mango Loco
      - text: 473 ml · Lata $ 3.390
      - button "Agregar Monster Mango Loco 473 ml · Lata al pedido"
    - article:
      - button "Guardar Speed Unlimited 473 ml · Lata de favoritos"
      - button "Ver Speed Unlimited Original":
        - img "Speed Unlimited Original"
      - strong: Speed Unlimited
      - text: 473 ml · Lata $ 2.925
      - button "Agregar Speed Unlimited 473 ml · Lata al pedido"
    - article:
      - button "Guardar Speed Unlimited Zero Sugar 473 ml · Lata de favoritos"
      - button "Ver Speed Unlimited Zero Sugar":
        - img "Speed Unlimited Zero Sugar"
      - strong: Speed Unlimited Zero Sugar
      - text: 473 ml · Lata $ 2.925
      - button "Agregar Speed Unlimited Zero Sugar 473 ml · Lata al pedido"
  - button "Heineken bien fría. Ver Heineken en el catálogo":
    - text: La marca
    - strong: Heineken bien fría
    - text: Ver Heineken
  - region "Selección del local":
    - heading "Selección del local" [level=2]
    - text: Bodega y destilados
    - button "Ver todos"
    - article:
      - button "Guardar Rutini Malbec 750 ml de favoritos"
      - button "Ver Rutini Malbec. Venta exclusiva a mayores de 18 años":
        - img "Rutini Malbec"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Rutini Malbec
      - text: 750 ml Precio próximamente
      - button "Ver la ficha de Rutini Malbec. Este producto todavía no está disponible para compra.": Ver detalle
    - article:
      - button "Guardar Buhero Negro 450 ml de favoritos"
      - button "Ver Buhero Negro. Venta exclusiva a mayores de 18 años":
        - img "Buhero Negro"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Buhero Negro
      - text: 450 ml Precio próximamente
      - button "Ver la ficha de Buhero Negro. Este producto todavía no está disponible para compra.": Ver detalle
    - article:
      - button "Guardar Cinzano Rosso 950 ml de favoritos"
      - button "Ver Cinzano Rosso. Venta exclusiva a mayores de 18 años":
        - img "Cinzano Rosso"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Cinzano Rosso
      - text: 950 ml Precio próximamente
      - button "Ver la ficha de Cinzano Rosso. Este producto todavía no está disponible para compra.": Ver detalle
    - article:
      - button "Guardar Chandon Délice 750 ml de favoritos"
      - button "Ver Chandon Délice. Venta exclusiva a mayores de 18 años":
        - img "Chandon Délice"
        - text: Venta exclusiva a mayores de 18 años
      - strong: Chandon Délice
      - text: 750 ml Precio próximamente
      - button "Ver la ficha de Chandon Délice. Este producto todavía no está disponible para compra.": Ver detalle
  - button "Ver catálogo completo"
- navigation "Navegación móvil":
  - button "Inicio"
  - button "Catálogo"
  - button "Mis pedidos"
  - button "Perfil"
```

# Test source

```ts
  163 |   await expect(page.locator(`${PERFIL_HEAD} .brand-logo-action`)).toBeHidden();
  164 |   // La fila de círculos es la entrada nueva: sin historias queda vacía y no
  165 |   // sobrevive ni un círculo prometiendo contenido.
  166 |   await expect(page.locator('.brand-story-circle')).toHaveCount(0);
  167 |   /*
  168 |    * Y la fila ENTERA desaparece, emblema incluido. Antes el emblema se quedaba
  169 |    * solo, como identidad del comercio: 88 px de la primera pantalla para
  170 |    * repetir la marca por TERCERA vez —ya está en la barra superior y en el h1—
  171 |    * justo encima del primer producto. Medido el 2026-08-25, 383 de los 844 px
  172 |    * del pliegue eran cromo antes de la primera bebida.
  173 |    */
  174 |   await expect(page.locator(`${HERO} .brand-stories-strip`)).toBeHidden();
  175 |   await expect(logoEstaticoHome(page)).toBeHidden();
  176 |   // El aro no se pinta: nada promete contenido inexistente.
  177 |   const ringPainted = await page.locator(`${HERO} [data-stories-static] .brand-logo-ring`)
  178 |     .evaluate((node) => getComputedStyle(node).backgroundImage !== 'none');
  179 |   expect(ringPainted).toBe(false);
  180 | });
  181 | 
  182 | // El emblema de marca es el elemento de identidad de la home. Lo que se fija no
  183 | // es su dibujo sino que se PINTE: el aro de historias es `position: absolute` y
  184 | // basta que la cara pierda su `z-index` para que le tape "LA TABA".
  185 | test('el emblema de marca se ve entero, con y sin el aro de historias encendido', async ({ page }) => {
  186 |   await openHome(page, { stories: STORY_FIXTURES });
  187 | 
  188 |   const logo = logoHome(page);
  189 |   await expect(logo.locator('img')).toHaveAttribute('src', /taba2-emblem\.svg$/);
  190 | 
  191 |   const capas = await logo.evaluate((nodo) => {
  192 |     const cara = nodo.querySelector('.brand-logo-face');
  193 |     const aro = nodo.querySelector('.brand-logo-ring');
  194 |     const caja = cara.getBoundingClientRect();
  195 |     const imagen = cara.querySelector('img').getBoundingClientRect();
  196 |     // Punto justo dentro del borde superior del emblema, donde vive "LA TABA".
  197 |     const x = Math.round(caja.left + caja.width / 2);
  198 |     const y = Math.round(caja.top + 6);
  199 |     return {
  200 |       encima: document.elementFromPoint(x, y)?.className || '',
  201 |       caraZ: getComputedStyle(cara).zIndex,
  202 |       caraPos: getComputedStyle(cara).position,
  203 |       aroPos: getComputedStyle(aro).position,
  204 |       emblemaLleno: Math.round(imagen.width) === Math.round(caja.width),
  205 |       caraDentroDelSlot: Math.round(caja.width) < Math.round(nodo.getBoundingClientRect().width),
  206 |     };
  207 |   });
  208 | 
  209 |   // Quien recibe el toque sobre el emblema no puede ser el aro.
  210 |   expect(capas.encima, 'algo tapa el emblema').not.toContain('brand-logo-ring');
  211 |   expect(capas.aroPos).toBe('absolute');
  212 |   expect(capas.caraPos).toBe('relative');
  213 |   expect(capas.caraZ).not.toBe('auto');
  214 |   expect(capas.emblemaLleno, 'el emblema no llena su caja').toBe(true);
  215 |   // El aro corre por fuera: si la cara midiera lo mismo que el slot, no habría
  216 |   // lugar donde pintarlo.
  217 |   expect(capas.caraDentroDelSlot).toBe(true);
  218 | 
  219 |   /*
  220 |    * Sin historias la fila ENTERA se va, emblema incluido. Antes el emblema se
  221 |    * quedaba solo sobre el shell oscuro; medido el 2026-08-25, esos 88 px eran
  222 |    * la tercera repetición de la marca —ya está en la barra superior y en el
  223 |    * h1— justo encima del primer producto, en una primera pantalla donde 383 de
  224 |    * 844 px eran cromo antes de la primera bebida.
  225 |    *
  226 |    * Lo que sigue valiendo, y es lo que se fija acá: el emblema se dibuja entero
  227 |    * CUANDO se dibuja, con su cara dentro del slot y su sombra propia. Eso se
  228 |    * verifica arriba, con historias publicadas.
  229 |    */
  230 |   const limpio = await page.context().browser().newContext({ viewport: PHONE });
  231 |   const sinHistorias = await limpio.newPage();
  232 |   await installBrowserStubs(sinHistorias);
  233 |   await sinHistorias.addInitScript(() => { window.TABA2_STORIES = []; });
  234 |   await gotoDemoReset(sinHistorias, '/?reset=1&demo=1');
  235 |   // La fila entera queda oculta, así que el slot se espera ATTACHED y no
  236 |   // visible: pedir 'visible' esperaría para siempre justo lo que este cambio
  237 |   // vino a sacar de la primera pantalla.
  238 |   await sinHistorias.waitForSelector('[data-stories-slot][data-stories-state="empty"]', { state: 'attached' });
  239 |   await expect(sinHistorias.locator(`${HERO} .brand-stories-strip`)).toBeHidden();
  240 |   await limpio.close();
  241 | });
  242 | 
  243 | test('la caja del logo no se mueve entre estados: sin historias y con historias mide igual', async ({ page }) => {
  244 |   await openHome(page);
  245 |   const empty = await entradaHome(page).boundingBox();
  246 | 
  247 |   const context = await page.context().browser().newContext({ viewport: PHONE });
  248 |   const withStories = await context.newPage();
  249 |   await installBrowserStubs(withStories);
  250 |   await withStories.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, STORY_FIXTURES);
  251 |   await gotoDemoReset(withStories, '/?reset=1&demo=1');
  252 |   await withStories.waitForSelector(`${HERO} .brand-logo-action:not([hidden])`);
  253 |   const filled = await entradaHome(withStories).boundingBox();
  254 | 
  255 |   expect(Math.round(filled.width)).toBe(Math.round(empty.width));
  256 |   expect(Math.round(filled.height)).toBe(Math.round(empty.height));
  257 |   await context.close();
  258 | });
  259 | 
  260 | test('con historias vigentes el logo es botón, el aro se enciende y el acceso dice cuántas hay', async ({ page }) => {
  261 |   await openHome(page, { stories: STORY_FIXTURES });
  262 | 
> 263 |   await expect(entradaHome(page)).toHaveAttribute('data-stories-state', 'unseen');
      |                                   ^ Error: expect(locator).toHaveAttribute(expected) failed
  264 |   const logo = logoHome(page);
  265 |   await expect(logo).toBeVisible();
  266 |   await expect(logo).toHaveAttribute('aria-label', /2 historias nuevas de La Taba/);
  267 |   // El estado no viaja sólo en el color del aro: hay un círculo por historia y
  268 |   // cada uno declara si ya se vio. Antes esto lo decía un rótulo suelto de una
  269 |   // tarjeta ancha que no mostraba ninguna historia.
  270 |   await expect(page.locator('.brand-story-circle')).toHaveCount(2);
  271 |   await expect(page.locator('.brand-story-circle[data-story-seen="false"]')).toHaveCount(2);
  272 | 
  273 |   await logo.click();
  274 |   const modal = page.locator('[data-stories-modal]');
  275 |   await expect(modal).toBeVisible();
  276 |   await expect(modal.getByRole('heading', { name: 'Combo de la semana' })).toBeVisible();
  277 |   await expect(modal.locator('[data-story-cta]')).toHaveText('Ver categoría');
  278 | 
  279 |   // La CTA usa una acción que ya existe: filtra el catálogo real.
  280 |   await modal.locator('[data-story-cta]').click();
  281 |   await expect(modal).toBeHidden();
  282 |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  283 |   await expect(page.locator('[data-catalog-title]')).toHaveText('Cervezas');
  284 |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  285 | });
  286 | 
  287 | test('las historias vistas atenúan el aro en vez de desaparecer', async ({ page }) => {
  288 |   await openHome(page, { stories: STORY_FIXTURES });
  289 |   await logoHome(page).click();
  290 |   await page.locator('[data-story-next]').click();
  291 |   await page.locator('[data-close-stories]').click();
  292 | 
  293 |   await expect(entradaHome(page)).toHaveAttribute('data-stories-state', 'seen');
  294 |   // Vistas las dos, los dos círculos quedan apagados —no desaparecen— igual
  295 |   // que el aro del emblema.
  296 |   await expect(page.locator('.brand-story-circle[data-story-seen="true"]')).toHaveCount(2);
  297 |   await expect(logoHome(page)).toBeVisible();
  298 | });
  299 | 
  300 | test('el foco vuelve al logo al cerrar el visor', async ({ page }) => {
  301 |   await openHome(page, { stories: STORY_FIXTURES });
  302 |   const logo = logoHome(page);
  303 |   await logo.click();
  304 |   await page.locator('[data-close-stories]').click();
  305 |   await expect(logo).toBeFocused();
  306 | });
  307 | 
  308 | // Perfil es la segunda entrada. Lo que se fija es que NO sea una copia con vida
  309 | // propia: mismo estado, misma cuenta de nuevas y el visor devuelve el foco al
  310 | // logo que se tocó, no al de la home.
  311 | test('Perfil ofrece la misma entrada a historias que la home, sincronizada', async ({ page }) => {
  312 |   await openHome(page, { stories: STORY_FIXTURES });
  313 |   await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  314 |   await expect(page.locator('[data-view="profile"]')).toBeVisible();
  315 | 
  316 |   const enPerfil = page.locator(`${PERFIL_HEAD} .brand-logo-action`);
  317 |   await expect(enPerfil).toBeVisible();
  318 |   await expect(page.locator(`${PERFIL_HEAD} [data-stories-slot]`))
  319 |     .toHaveAttribute('data-stories-state', 'unseen');
  320 |   // La etiqueta sale del MISMO estado que la de la home: si divergen, una de las
  321 |   // dos le está mintiendo al cliente sobre cuántas historias le faltan.
  322 |   await expect(enPerfil).toHaveAttribute('aria-label', /2 historias nuevas de La Taba/);
  323 | 
  324 |   await enPerfil.click();
  325 |   const modal = page.locator('[data-stories-modal]');
  326 |   await expect(modal).toBeVisible();
  327 |   await page.locator('[data-close-stories]').click();
  328 |   // El foco vuelve al control que se tocó, no al de la otra vista.
  329 |   await expect(enPerfil).toBeFocused();
  330 | 
  331 |   // Ver una historia en Perfil tiene que apagarla también en la home.
  332 |   await expect(page.locator(`${PERFIL_HEAD} [data-stories-slot]`))
  333 |     .toHaveAttribute('data-stories-state', 'unseen');
  334 |   await expect(entradaHome(page)).toHaveAttribute('data-stories-state', 'unseen');
  335 |   await expect(enPerfil).toHaveAttribute('aria-label', /la historia nueva de La Taba/);
  336 |   await expect(logoHome(page)).toHaveAttribute('aria-label', /la historia nueva de La Taba/);
  337 | });
  338 | 
  339 | test('el buscador ocupa el ancho útil, es táctil y no dispara el zoom de iOS', async ({ page }) => {
  340 |   await openHome(page);
  341 |   const search = page.locator('[data-view="home"] .taba-home-search');
  342 |   const input = search.locator('input');
  343 | 
  344 |   const [box, home] = await Promise.all([search.boundingBox(), page.locator('[data-view="home"]').boundingBox()]);
  345 |   expect(box.width).toBeGreaterThan(home.width * 0.88);
  346 |   expect(box.height).toBeGreaterThanOrEqual(48);
  347 |   expect(await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  348 |   // Un solo texto para las tres cajas de búsqueda, y corto: a 320 px los tres
  349 |   // anteriores se cortaban dentro de su propia caja.
  350 |   await expect(input).toHaveAttribute('placeholder', 'Buscar productos o marcas');
  351 | 
  352 |   await input.fill('coca');
  353 |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  354 |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  355 | });
  356 | 
  357 | test('la fila de categorías sólo ofrece rubros que hoy se pueden comprar', async ({ page }) => {
  358 |   await openHome(page);
  359 |   const chips = page.locator('[data-home-category-strip] [data-category-id]');
  360 |   const ids = await chips.evaluateAll((nodes) => nodes.map((node) => node.dataset.categoryId));
  361 | 
  362 |   expect(ids[0]).toBe('all');
  363 |   // Desde la publicación minorista los rubros con comprables son cervezas y
```