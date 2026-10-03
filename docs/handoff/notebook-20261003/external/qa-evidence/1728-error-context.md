# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: honesty-mode.spec.mjs >> cambiar de demo a público invalida pedidos de ejemplo y deja medios honestos
- Location: tests\e2e\honesty-mode.spec.mjs:225:1

# Error details

```
Error: page.goto: Could not connect to server
Call log:
  - navigating to "http://127.0.0.1:38202/?demo=1", waiting until "load"

```

# Test source

```ts
  126 |   await page.getByRole('button', { name: 'Ver mi pedido' }).click();
  127 | 
  128 |   await fillCheckout(page, {
  129 |     name: '',
  130 |     phone: '',
  131 |     addresses: [],
  132 |     payment: 'transfer',
  133 |     deliveryMode: 'delivery',
  134 |   });
  135 |   await expect(page.locator('[data-profile-block="incomplete"]')).toBeVisible();
  136 |   await expect(
  137 |     page.locator('[data-profile-block="incomplete"] [data-profile-checkout-action="edit-profile"]'),
  138 |   ).toBeVisible();
  139 | 
  140 |   await fillCheckout(page, {
  141 |     name: 'Cliente prueba',
  142 |     phone: '2995551234',
  143 |     addresses: [],
  144 |     payment: 'transfer',
  145 |     deliveryMode: 'delivery',
  146 |   });
  147 |   await expect(page.locator('[data-profile-block="no-address"]')).toBeVisible();
  148 |   await expect(
  149 |     page.locator('[data-profile-block="no-address"] [data-profile-checkout-action="add-address"]'),
  150 |   ).toBeVisible();
  151 | 
  152 |   await fillCheckout(page, {
  153 |     name: 'Cliente prueba',
  154 |     phone: '2995551234',
  155 |     street: 'Roca 123',
  156 |     neighborhood: 'Neuquen Capital',
  157 |     reference: 'Porton gris',
  158 |     notes: '',
  159 |     payment: 'transfer',
  160 |     deliveryMode: 'delivery',
  161 |   });
  162 |   const paymentMethod = page.getByLabel('Forma de pago');
  163 |   await expect(paymentMethod).toBeVisible();
  164 |   await expect(paymentMethod.locator('option')).toHaveCount(3);
  165 |   await expect(paymentMethod.locator('option[value="coordinate"]')).toHaveText('A coordinar con el local');
  166 |   await paymentMethod.selectOption('transfer');
  167 |   await expect(paymentMethod).toHaveValue('transfer');
  168 |   await page.locator('[data-checkout-submit]').click();
  169 |   await waitForToast(page, 'Pedido confirmado');
  170 | 
  171 |   const tracking = page.locator('[data-tracking-panel]');
  172 |   await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido fue confirmado');
  173 |   await expect(tracking).not.toContainText(/pedido de muestra|no se envio|presentacion/i);
  174 |   await expect(tracking.locator('[data-delivery-code]')).toHaveCount(0);
  175 |   await expect(tracking.locator('.tracking-help-card')).toHaveCount(0);
  176 |   await expect(tracking.getByRole('link', { name: 'Contactar al local' })).toHaveCount(0);
  177 |   await expect(page.getByRole('button', { name: 'Solicitar por WhatsApp' })).toBeHidden();
  178 | 
  179 |   await page.evaluate(async () => {
  180 |     const { updateBusinessConfig } = await import(new URL('js/state.js', location.href).href);
  181 |     updateBusinessConfig({
  182 |       whatsappNumber: '5492995551234',
  183 |       whatsappVerified: true,
  184 |     });
  185 |   });
  186 |   await expect(tracking.locator('.tracking-help-card')).toBeVisible();
  187 |   await expect(tracking.getByRole('link', { name: 'Contactar al local' }))
  188 |     .toHaveAttribute('href', 'https://wa.me/5492995551234');
  189 | 
  190 |   await page.evaluate(async () => {
  191 |     const { updateBusinessConfig } = await import(new URL('js/state.js', location.href).href);
  192 |     updateBusinessConfig({ whatsappVerified: false });
  193 |   });
  194 |   await expect(tracking.locator('.tracking-help-card')).toHaveCount(0);
  195 | });
  196 | 
  197 | test('estado legacy incompatible y perfil desactualizado se limpian sin reset manual', async ({ page }) => {
  198 |   await page.addInitScript(({ stateKey }) => {
  199 |     localStorage.setItem(stateKey, JSON.stringify({
  200 |       schemaVersion: 1,
  201 |       dataVersion: 'legacy-retail-v1',
  202 |       appMode: 'public',
  203 |       products: [{ id: 'legacy-item-1', name: 'Producto heredado', price: 1000 }],
  204 |       orders: [{ id: 'LEGACY-1', customerName: 'Persona heredada' }],
  205 |     }));
  206 |     localStorage.setItem('la_taba_customer_profile_v1', JSON.stringify({ name: 'Cliente legado' }));
  207 |     localStorage.setItem('la_taba_customer_history_v1', JSON.stringify([{ id: 'LEGACY-1' }]));
  208 |   }, { stateKey: STATE_KEY });
  209 | 
  210 |   await page.goto('/');
  211 |   const persisted = await page.evaluate((key) => ({
  212 |     state: JSON.parse(localStorage.getItem(key)),
  213 |     profile: localStorage.getItem('la_taba_customer_profile_v1'),
  214 |     history: localStorage.getItem('la_taba_customer_history_v1'),
  215 |   }), STATE_KEY);
  216 | 
  217 |   expect(persisted.state.dataVersion).toBe('la-taba-runtime-v3');
  218 |   expect(persisted.state.orders).toHaveLength(0);
  219 |   expect(persisted.state.products.some((product) => /producto heredado/i.test(product.name))).toBe(false);
  220 |   expect(persisted.profile).toBeNull();
  221 |   expect(persisted.history).toBeNull();
  222 |   await expect(page.locator('body')).not.toContainText(/Cliente legado|Producto heredado|Persona heredada/i);
  223 | });
  224 | 
  225 | test('cambiar de demo a público invalida pedidos de ejemplo y deja medios honestos', async ({ page }) => {
> 226 |   await page.goto('/?demo=1');
      |              ^ Error: page.goto: Could not connect to server
  227 |   const demoOrders = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).orders.length, STATE_KEY);
  228 |   expect(demoOrders).toBeGreaterThan(0);
  229 | 
  230 |   await page.goto('/');
  231 |   const publicState = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  232 |   expect(publicState.appMode).toBe('public');
  233 |   expect(publicState.orders).toHaveLength(0);
  234 |   const paymentMethod = page.locator('select[name="paymentMethod"]');
  235 |   await expect(paymentMethod).toHaveCount(1);
  236 |   await expect(paymentMethod.locator('option[value="coordinate"]')).toHaveCount(1);
  237 |   await expect(page.locator('input[name="paymentMethod"]')).toHaveCount(0);
  238 |   await expect(page.locator('[data-coupon-code]')).toHaveCount(0);
  239 |   await expect(page.locator('body')).not.toContainText('TABA10');
  240 | });
  241 | 
  242 | test('Moto g15: no hay overflow horizontal y los controles principales alcanzan 44 px', async ({ browser }) => {
  243 |   const contextOptions = { viewport: { width: 432, height: 815 }, hasTouch: true };
  244 |   if (browser.browserType().name() !== 'firefox') contextOptions.isMobile = true;
  245 |   const context = await browser.newContext(contextOptions);
  246 |   const page = await context.newPage();
  247 |   await page.goto('/?demo=1');
  248 | 
  249 |   const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  250 |   expect(overflow).toBeLessThanOrEqual(1);
  251 |   await expect(page.locator('.mobile-nav')).toBeVisible();
  252 |   await expect(page.locator('.desktop-nav')).toBeHidden();
  253 | 
  254 |   for (const [selector, minimumTarget] of [
  255 |     ['[data-open-cart]', 43.5],
  256 |     ['.mobile-nav button', 43.5],
  257 |     ['.rail-link', 43.5],
  258 |     ['[data-favorite-product]', 43.5],
  259 |     // La acción de una card compacta mantiene un blanco táctil mínimo de 40 px.
  260 |     ['[data-add-product]', 39.5],
  261 |   ]) {
  262 |     const locator = page.locator(selector).filter({ visible: true }).first();
  263 |     if (await locator.count()) {
  264 |       const box = await locator.boundingBox();
  265 |       expect(Math.min(box?.width || 0, box?.height || 0), selector).toBeGreaterThanOrEqual(minimumTarget);
  266 |     }
  267 |   }
  268 |   await context.close();
  269 | });
  270 | 
```