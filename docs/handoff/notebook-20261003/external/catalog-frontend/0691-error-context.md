# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-brand-home.spec.mjs >> el emblema de marca se ve entero, con y sin el aro de historias encendido
- Location: tests\e2e\taba2-brand-home.spec.mjs:185:1

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: locator('.brand-hero .brand-logo-action').locator('img')
Expected pattern: /taba2-emblem\.svg$/
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" with timeout 5000ms
  - waiting for locator('.brand-hero .brand-logo-action').locator('img')

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
  89  |   if (!foreground || !background) return null;
  90  |   const light = Math.max(luminance(foreground), luminance(background));
  91  |   const dark = Math.min(luminance(foreground), luminance(background));
  92  |   return {
  93  |     ratio: Number(((light + 0.05) / (dark + 0.05)).toFixed(2)),
  94  |     fontSize: parseFloat(getComputedStyle(node).fontSize),
  95  |     fontWeight: Number(getComputedStyle(node).fontWeight) || 400,
  96  |   };
  97  | }`;
  98  | 
  99  | async function contrast(page, selector) {
  100 |   return page.evaluate(new Function(`return ${CONTRAST_PROBE}`)(), selector);
  101 | }
  102 | 
  103 | // La entrada a historias existe en DOS lugares —el encabezado de la home y el
  104 | // de Perfil— y comparte marcado, así que cada aserción tiene que decir de cuál
  105 | // habla. Estos helpers evitan que un selector suelto vuelva a apuntar a las dos.
  106 | const HERO = '.brand-hero';
  107 | const PERFIL_HEAD = '.profile-page-head';
  108 | const entradaHome = (page) => page.locator(`${HERO} [data-stories-slot]`);
  109 | const logoHome = (page) => page.locator(`${HERO} .brand-logo-action`);
  110 | const logoEstaticoHome = (page) => page.locator(`${HERO} [data-stories-static]`);
  111 | 
  112 | async function openHome(page, { stories = null, viewport = PHONE } = {}) {
  113 |   await page.setViewportSize(viewport);
  114 |   await installBrowserStubs(page);
  115 |   // `null` = sin origen declarado: manda lo que traiga el modo (la demo siembra
  116 |   // sus fixtures). Un array —incluido `[]`— declara el origen real y gana
  117 |   // siempre, que es el contrato que consumirá el backend.
  118 |   if (Array.isArray(stories)) {
  119 |     await page.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, stories);
  120 |   }
  121 |   await gotoDemoReset(page, '/?reset=1&demo=1');
  122 |   await page.waitForSelector('[data-view="home"] .home-best-card');
  123 | }
  124 | 
  125 | test('el encabezado presenta la identidad real del comercio, no una escrita a mano', async ({ page }) => {
  126 |   const guards = installPageGuards(page);
  127 |   await openHome(page);
  128 | 
  129 |   // El "¡Bienvenido a" se retiró: era decoración de tres renglones encima del
  130 |   // primer producto. Lo que se fija sigue siendo lo mismo que fijaba antes —que
  131 |   // la identidad SALE de `businessConfig` y no está escrita a mano—, ahora
  132 |   // sobre el encabezado compacto.
  133 |   await expect(page.getByRole('heading', { name: 'La Taba', level: 1 })).toBeVisible();
  134 |   // Rubro y dirección salen de `businessConfig`: la vista sólo los concatena.
  135 |   // Este renglón dice QUÉ HACE el comercio y DÓNDE. Decía el rubro («Tienda de
  136 |   // bebidas»), que ya está en la barra superior, mientras la palabra «delivery»
  137 |   // no aparecía en 2.143 px de home: un cliente que llegaba por un enlace no
  138 |   // tenía cómo saber si le llevan la bebida. Sale de `businessConfig`, igual
  139 |   // que antes, y sin nada que decir del servicio vuelve el rubro.
  140 |   await expect(page.locator('[data-home-business-place]')).toHaveText('Delivery y retiro · Mendoza 827, Neuquén');
  141 |   await expect(page.locator('[data-open-status]')).toBeVisible();
  142 |   await expect(page.locator('[data-open-status]')).toHaveText('Pedidos disponibles');
  143 |   // Sin horario publicado no se inventa ninguno.
  144 |   await expect(page.locator('[data-home-business-hours]')).toBeHidden();
  145 |   await guards.assertClean();
  146 | });
  147 | 
  148 | // El origen productivo es el global que publica el backend. La demo siembra
  149 | // fixtures propias (`preview-stories-data.js`), así que para ejercitar el
  150 | // fail-closed hay que declarar explícitamente que el origen real está vacío:
  151 | // es exactamente lo que ocurre en producción antes del primer publicado.
  152 | test('sin historias publicadas el logo no se anuncia como botón', async ({ page }) => {
  153 |   await openHome(page, { stories: [] });
  154 | 
  155 |   // El fail-closed rige en TODAS las entradas, no sólo en la de la home.
  156 |   await expect(page.locator('[data-stories-slot]')).toHaveCount(2);
  157 |   for (const estado of await page.locator('[data-stories-slot]').evaluateAll(
  158 |     (nodos) => nodos.map((n) => n.dataset.storiesState),
  159 |   )) {
  160 |     expect(estado).toBe('empty');
  161 |   }
  162 |   await expect(logoHome(page)).toBeHidden();
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
> 189 |   await expect(logo.locator('img')).toHaveAttribute('src', /taba2-emblem\.svg$/);
      |                                     ^ Error: expect(locator).toHaveAttribute(expected) failed
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
  263 |   await expect(entradaHome(page)).toHaveAttribute('data-stories-state', 'unseen');
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
```