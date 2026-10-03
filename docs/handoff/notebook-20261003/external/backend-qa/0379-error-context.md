# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-brand-home.spec.mjs >> las historias vistas atenúan el aro en vez de desaparecer
- Location: tests\e2e\taba2-brand-home.spec.mjs:168:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('[data-stories-cta-detail]')
Expected: "Ver historias"
Received: "Mirar historias"
Timeout:  5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('[data-stories-cta-detail]')
    14 × locator resolved to <small data-stories-cta-detail="">Mirar historias</small>
       - unexpected value "Mirar historias"

```

```yaml
- text: Mirar historias
```

# Test source

```ts
  75  |   if (!foreground || !background) return null;
  76  |   const light = Math.max(luminance(foreground), luminance(background));
  77  |   const dark = Math.min(luminance(foreground), luminance(background));
  78  |   return {
  79  |     ratio: Number(((light + 0.05) / (dark + 0.05)).toFixed(2)),
  80  |     fontSize: parseFloat(getComputedStyle(node).fontSize),
  81  |     fontWeight: Number(getComputedStyle(node).fontWeight) || 400,
  82  |   };
  83  | }`;
  84  | 
  85  | async function contrast(page, selector) {
  86  |   return page.evaluate(new Function(`return ${CONTRAST_PROBE}`)(), selector);
  87  | }
  88  | 
  89  | async function openHome(page, { stories = null, viewport = PHONE } = {}) {
  90  |   await page.setViewportSize(viewport);
  91  |   await installBrowserStubs(page);
  92  |   if (stories) {
  93  |     await page.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, stories);
  94  |   }
  95  |   await gotoDemoReset(page, '/?reset=1&demo=1');
  96  |   await page.waitForSelector('[data-view="home"] .home-catalog-card');
  97  | }
  98  | 
  99  | test('el encabezado presenta la identidad real del comercio, no una escrita a mano', async ({ page }) => {
  100 |   const guards = installPageGuards(page);
  101 |   await openHome(page);
  102 | 
  103 |   await expect(page.locator('.brand-hero-welcome')).toHaveText('¡Bienvenido a');
  104 |   await expect(page.getByRole('heading', { name: 'La Taba 2', level: 1 })).toBeVisible();
  105 |   // Rubro y dirección salen de `businessConfig`: la vista sólo los concatena.
  106 |   await expect(page.locator('[data-home-business-place]')).toHaveText('Tienda de bebidas · Mendoza 827, Neuquén');
  107 |   await expect(page.locator('[data-open-status]')).toBeVisible();
  108 |   await expect(page.locator('[data-open-status]')).toHaveText('Pedidos disponibles');
  109 |   // Sin horario publicado no se inventa ninguno.
  110 |   await expect(page.locator('[data-home-business-hours]')).toBeHidden();
  111 |   await guards.assertClean();
  112 | });
  113 | 
  114 | test('sin historias publicadas el logo no se anuncia como botón', async ({ page }) => {
  115 |   await openHome(page);
  116 | 
  117 |   await expect(page.locator('[data-stories-slot]')).toHaveAttribute('data-stories-state', 'empty');
  118 |   await expect(page.locator('.brand-logo-action')).toBeHidden();
  119 |   await expect(page.locator('.brand-stories-cta')).toBeHidden();
  120 |   await expect(page.locator('[data-stories-static]')).toBeVisible();
  121 |   // El aro no se pinta: nada promete contenido inexistente.
  122 |   const ringPainted = await page.locator('[data-stories-static] .brand-logo-ring')
  123 |     .evaluate((node) => getComputedStyle(node).backgroundImage !== 'none');
  124 |   expect(ringPainted).toBe(false);
  125 | });
  126 | 
  127 | test('la caja del logo no se mueve entre estados: sin historias y con historias mide igual', async ({ page }) => {
  128 |   await openHome(page);
  129 |   const empty = await page.locator('[data-stories-slot]').boundingBox();
  130 | 
  131 |   const context = await page.context().browser().newContext({ viewport: PHONE });
  132 |   const withStories = await context.newPage();
  133 |   await installBrowserStubs(withStories);
  134 |   await withStories.addInitScript((fixtures) => { window.TABA2_STORIES = fixtures; }, STORY_FIXTURES);
  135 |   await gotoDemoReset(withStories, '/?reset=1&demo=1');
  136 |   await withStories.waitForSelector('.brand-logo-action:not([hidden])');
  137 |   const filled = await withStories.locator('[data-stories-slot]').boundingBox();
  138 | 
  139 |   expect(Math.round(filled.width)).toBe(Math.round(empty.width));
  140 |   expect(Math.round(filled.height)).toBe(Math.round(empty.height));
  141 |   await context.close();
  142 | });
  143 | 
  144 | test('con historias vigentes el logo es botón, el aro se enciende y el acceso dice cuántas hay', async ({ page }) => {
  145 |   await openHome(page, { stories: STORY_FIXTURES });
  146 | 
  147 |   await expect(page.locator('[data-stories-slot]')).toHaveAttribute('data-stories-state', 'unseen');
  148 |   const logo = page.locator('.brand-logo-action');
  149 |   await expect(logo).toBeVisible();
  150 |   await expect(logo).toHaveAttribute('aria-label', /2 historias nuevas de La Taba 2/);
  151 |   // El estado no viaja sólo en el color del aro.
  152 |   await expect(page.locator('[data-stories-cta-detail]')).toHaveText('2 historias nuevas');
  153 | 
  154 |   await logo.click();
  155 |   const modal = page.locator('[data-stories-modal]');
  156 |   await expect(modal).toBeVisible();
  157 |   await expect(modal.getByRole('heading', { name: 'Combo de la semana' })).toBeVisible();
  158 |   await expect(modal.locator('[data-story-cta]')).toHaveText('Ver categoría');
  159 | 
  160 |   // La CTA usa una acción que ya existe: filtra el catálogo real.
  161 |   await modal.locator('[data-story-cta]').click();
  162 |   await expect(modal).toBeHidden();
  163 |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  164 |   await expect(page.locator('[data-catalog-title]')).toHaveText('Cervezas');
  165 |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  166 | });
  167 | 
  168 | test('las historias vistas atenúan el aro en vez de desaparecer', async ({ page }) => {
  169 |   await openHome(page, { stories: STORY_FIXTURES });
  170 |   await page.locator('.brand-logo-action').click();
  171 |   await page.locator('[data-story-next]').click();
  172 |   await page.locator('[data-close-stories]').click();
  173 | 
  174 |   await expect(page.locator('[data-stories-slot]')).toHaveAttribute('data-stories-state', 'seen');
> 175 |   await expect(page.locator('[data-stories-cta-detail]')).toHaveText('Ver historias');
      |                                                           ^ Error: expect(locator).toHaveText(expected) failed
  176 |   await expect(page.locator('.brand-logo-action')).toBeVisible();
  177 | });
  178 | 
  179 | test('el foco vuelve al logo al cerrar el visor', async ({ page }) => {
  180 |   await openHome(page, { stories: STORY_FIXTURES });
  181 |   const logo = page.locator('.brand-logo-action');
  182 |   await logo.click();
  183 |   await page.locator('[data-close-stories]').click();
  184 |   await expect(logo).toBeFocused();
  185 | });
  186 | 
  187 | test('el buscador ocupa el ancho útil, es táctil y no dispara el zoom de iOS', async ({ page }) => {
  188 |   await openHome(page);
  189 |   const search = page.locator('[data-view="home"] .taba-home-search');
  190 |   const input = search.locator('input');
  191 | 
  192 |   const [box, home] = await Promise.all([search.boundingBox(), page.locator('[data-view="home"]').boundingBox()]);
  193 |   expect(box.width).toBeGreaterThan(home.width * 0.88);
  194 |   expect(box.height).toBeGreaterThanOrEqual(48);
  195 |   expect(await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  196 |   await expect(input).toHaveAttribute('placeholder', 'Buscar bebidas, marcas y ofertas…');
  197 | 
  198 |   await input.fill('coca');
  199 |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  200 |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  201 | });
  202 | 
  203 | test('la fila de categorías sólo ofrece rubros que hoy se pueden comprar', async ({ page }) => {
  204 |   await openHome(page);
  205 |   const chips = page.locator('[data-home-category-strip] [data-category-id]');
  206 |   const ids = await chips.evaluateAll((nodes) => nodes.map((node) => node.dataset.categoryId));
  207 | 
  208 |   expect(ids[0]).toBe('all');
  209 |   expect(ids).toContain('gaseosas');
  210 |   expect(ids).toContain('cervezas');
  211 |   // Sin precio publicado un rubro no puede ser protagonista de la home.
  212 |   expect(ids).not.toContain('whisky');
  213 |   expect(ids).not.toContain('fernet');
  214 | 
  215 |   // Ninguna categoría de la fila lleva a un catálogo vacío.
  216 |   for (const id of ids.filter((candidate) => candidate !== 'all')) {
  217 |     await page.locator(`[data-home-category-strip] [data-category-id="${id}"]`).click();
  218 |     await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  219 |     await page.goBack();
  220 |     await expect(page.locator('[data-view="home"]')).toBeVisible();
  221 |   }
  222 | });
  223 | 
  224 | test('el banner editorial lleva a una categoría real y no afirma un descuento', async ({ page }) => {
  225 |   await openHome(page);
  226 |   const banner = page.locator('.home-brand-banner').first();
  227 |   await expect(banner).toBeVisible();
  228 |   await expect(banner).not.toContainText('%');
  229 |   await expect(banner).not.toContainText('$');
  230 | 
  231 |   const categoryId = await banner.getAttribute('data-category-id');
  232 |   expect(categoryId).toBeTruthy();
  233 |   await banner.click();
  234 |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  235 |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  236 | });
  237 | 
  238 | test('el shell de marca es continuo entre las vistas del cliente', async ({ page }) => {
  239 |   await openHome(page);
  240 |   const leer = () => page.evaluate(() => ({
  241 |     vista: document.body.dataset.activeView,
  242 |     body: getComputedStyle(document.body).backgroundColor,
  243 |     topbar: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
  244 |     nav: getComputedStyle(document.querySelector('.mobile-nav')).backgroundColor,
  245 |   }));
  246 | 
  247 |   const home = await leer();
  248 |   // Fondo de marca oscuro, producto sobre blanco.
  249 |   expect(home.body).toBe('rgb(9, 11, 14)');
  250 |   expect(await page.locator('.home-catalog-card').first().evaluate((n) => getComputedStyle(n).backgroundColor))
  251 |     .toBe('rgb(255, 255, 255)');
  252 | 
  253 |   // Navegar NO puede producir un salto negro → blanco: el shell se conserva.
  254 |   for (const vista of ['catalog', 'cart', 'profile', 'tracking']) {
  255 |     await page.locator(`.mobile-nav [data-nav-view="${vista}"]`).click();
  256 |     await expect(page.locator(`[data-view="${vista}"]`)).toBeVisible();
  257 |     const actual = await leer();
  258 |     expect(actual.vista, `vista ${vista}`).toBe(vista);
  259 |     expect(actual.body, `fondo en ${vista}`).toBe(home.body);
  260 |     expect(actual.topbar, `barra en ${vista}`).toBe(home.topbar);
  261 |     expect(actual.nav, `navegación en ${vista}`).toBe(home.nav);
  262 |   }
  263 | });
  264 | 
  265 | test('el panel operativo conserva su superficie clara', async ({ page }) => {
  266 |   await openHome(page);
  267 |   const home = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  268 |   await page.goto('/?demo=1#business');
  269 |   await expect(page.locator('[data-view="business"]')).toBeVisible();
  270 |   const negocio = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  271 |   expect(negocio).not.toBe(home);
  272 | });
  273 | 
  274 | test('ningún texto de las vistas del cliente queda por debajo de 3:1', async ({ page }) => {
  275 |   await openHome(page);
```