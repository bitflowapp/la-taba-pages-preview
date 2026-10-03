# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-brand-home.spec.mjs >> Perfil ofrece la misma entrada a historias que la home, sincronizada
- Location: tests\e2e\taba2-brand-home.spec.mjs:311:1

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
  - button "ENVIAR A Avenida Argentina 450":
    - text: ENVIAR A
    - strong: Avenida Argentina 450
  - button "Ver mi pedido"
- main:
  - button "Ver la historia nueva de La Taba"
  - paragraph: Tu cuenta
  - heading "Mi perfil" [level=1]
  - paragraph: Tus datos se usarán para preparar y entregar tus pedidos.
  - region "Datos personales":
    - heading "Datos personales" [level=2]
    - text: Quién recibe el pedido
    - button "Editar"
    - term: Nombre y apellido
    - definition: Cliente Demo
    - term: Teléfono
    - definition: 299 000 0001
  - region "¿Dónde lo llevamos?":
    - heading "Tus direcciones" [level=2]
    - text: Elegí a dónde llevamos tu pedido
    - article:
      - strong: Casa
      - text: Predeterminada
      - paragraph: Avenida Argentina 450, Neuquén Capital
      - text: Portón negro, timbre 2 Ubicación confirmada
      - button "Editar"
      - button "Eliminar"
      - text: En uso
    - article:
      - strong: Trabajo
      - paragraph: Julio Argentino Roca 1220, Neuquén Capital
      - text: Oficina 4B Ubicación confirmada
      - button "Editar"
      - button "Eliminar"
      - button "Usar esta"
    - article:
      - strong: Casa de mamá
      - paragraph: Diagonal 9 de Julio 87, Neuquén Capital
      - text: Ubicación confirmada
      - button "Editar"
      - button "Eliminar"
      - button "Usar esta"
    - article:
      - strong: Depto centro
      - paragraph: General Manuel Belgrano 333, Neuquén Capital · Piso 3, Dpto. B
      - text: Ubicación confirmada
      - button "Editar"
      - button "Eliminar"
      - button "Usar esta"
    - button "Agregar nueva dirección"
  - complementary:
    - strong: TABA no necesita tu DNI.
    - paragraph: Solo guardamos los datos necesarios para identificar al destinatario y entregar tus pedidos. Del punto de entrega guardamos uno por dirección, no un historial de dónde estuviste.
  - group: Información del local
- navigation "Navegación móvil":
  - button "Inicio"
  - button "Catálogo"
  - button "Mis pedidos"
  - button "Perfil"
```

# Test source

```ts
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
> 334 |   await expect(entradaHome(page)).toHaveAttribute('data-stories-state', 'unseen');
      |                                   ^ Error: expect(locator).toHaveAttribute(expected) failed
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
  364 |   // energizantes: las botellas sueltas de gaseosas y mixers esperan precio.
  365 |   expect(ids).toContain('cervezas');
  366 |   expect(ids).toContain('energizantes');
  367 |   expect(ids).not.toContain('gaseosas');
  368 |   // Sin precio publicado un rubro no puede ser protagonista de la home.
  369 |   expect(ids).not.toContain('whisky');
  370 |   expect(ids).not.toContain('fernet');
  371 | 
  372 |   // Ninguna categoría de la fila lleva a un catálogo vacío.
  373 |   for (const id of ids.filter((candidate) => candidate !== 'all')) {
  374 |     await page.locator(`[data-home-category-strip] [data-category-id="${id}"]`).click();
  375 |     await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  376 |     await page.goBack();
  377 |     await expect(page.locator('[data-view="home"]')).toBeVisible();
  378 |   }
  379 | });
  380 | 
  381 | test('el banner editorial lleva a un destino con producto comprable y no afirma un descuento', async ({ page }) => {
  382 |   await openHome(page);
  383 |   const banner = page.locator('.home-brand-banner').first();
  384 |   await expect(banner).toBeVisible();
  385 |   await expect(banner).not.toContainText('%');
  386 |   await expect(banner).not.toContainText('$');
  387 | 
  388 |   // El destino puede ser de rubro (`data-category-id`) o de marca
  389 |   // (`data-brand-query`); lo que NO puede es prometer una compra que el
  390 |   // catálogo no respalda (P1-2): al tocarlo tiene que aparecer al menos un
  391 |   // producto con "Agregar" habilitado, no una góndola de precios pendientes.
  392 |   const destino = await banner.evaluate((node) => node.dataset.categoryId || node.dataset.brandQuery);
  393 |   expect(destino).toBeTruthy();
  394 |   await banner.click();
  395 |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  396 |   await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();
  397 | });
  398 | 
  399 | test('el shell de marca es continuo entre las vistas del cliente', async ({ page }) => {
  400 |   await openHome(page);
  401 |   const leer = () => page.evaluate(() => ({
  402 |     vista: document.body.dataset.activeView,
  403 |     body: getComputedStyle(document.body).backgroundColor,
  404 |     topbar: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
  405 |     nav: getComputedStyle(document.querySelector('.mobile-nav')).backgroundColor,
  406 |   }));
  407 | 
  408 |   const home = await leer();
  409 |   // Fondo de marca oscuro, producto sobre GONDOLA. El blanco puro se retiró: sobre
  410 |   // grafito recortaba la pantalla como un papel pegado y, sobre todo, era el
  411 |   // origen del salto "home premium → formulario blanco genérico", porque cada
  412 |   // hoja elegía su propio blanco. Ahora hay una sola superficie de contenido y
  413 |   // este test la fija en su valor resuelto, no en un token.
  414 |   expect(home.body).toBe(brandSurfaceRgb());
  415 |   expect(await page.locator('.home-best-card').first().evaluate((n) => getComputedStyle(n).backgroundColor))
  416 |     .toBe(GONDOLA);
  417 | 
  418 |   // Navegar NO puede producir un salto negro → blanco: el shell se conserva.
  419 |   for (const vista of ['catalog', 'cart', 'profile', 'tracking']) {
  420 |     await page.locator(`.mobile-nav [data-nav-view="${vista}"]`).click();
  421 |     await expect(page.locator(`[data-view="${vista}"]`)).toBeVisible();
  422 |     const actual = await leer();
  423 |     expect(actual.vista, `vista ${vista}`).toBe(vista);
  424 |     expect(actual.body, `fondo en ${vista}`).toBe(home.body);
  425 |     expect(actual.topbar, `barra en ${vista}`).toBe(home.topbar);
  426 |     expect(actual.nav, `navegación en ${vista}`).toBe(home.nav);
  427 |   }
  428 | });
  429 | 
  430 | // Lo que hacía sentir "otra aplicación" al tocar Carrito no era el fondo —el
  431 | // shell ya era continuo— sino la SUPERFICIE del contenido: la home mostraba una
  432 | // vidriera y el carrito un formulario blanco puro, con otra sombra y otro radio.
  433 | // Esto fija que la tarjeta de producto, la del carrito y la del perfil sean
  434 | // exactamente la misma superficie.
```