# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: honesty-mode.spec.mjs >> runtime completo habilita modo producción sin catálogo demo ni PIN
- Location: tests\e2e\honesty-mode.spec.mjs:49:1

# Error details

```
Error: page.goto: Could not connect to server
Call log:
  - navigating to "http://127.0.0.1:38202/#business", waiting until "load"

```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { fillCheckout, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';
  3   | 
  4   | const STATE_KEY = 'la_taba_mvp_v4_state';
  5   | 
  6   | test('modo público oculta roles, PIN y datos sembrados, incluso con hash operativo', async ({ page }) => {
  7   |   await installPageGuards(page);
  8   |   await page.goto('/');
  9   | 
  10  |   await expect(page.locator('[data-demo-mode-banner]')).toBeHidden();
  11  |   await expect(page.locator('[data-admin-toggle]')).toHaveCount(0);
  12  |   await expect(page.locator('.role-intro')).toBeHidden();
  13  |   await expect(page.locator('body')).not.toContainText('1234');
  14  | 
  15  |   const state = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STATE_KEY);
  16  |   expect(state.appMode).toBe('public');
  17  |   expect(state.orders).toHaveLength(0);
  18  | 
  19  |   await page.goto('/#business');
  20  |   await expect(page.locator('[data-view="home"]')).toHaveClass(/is-active/);
  21  |   await expect(page.locator('[data-view="business"]')).toBeHidden();
  22  | });
  23  | 
  24  | test('preview privado mantiene la identidad interna fuera de la experiencia cliente', async ({ page }) => {
  25  |   await installPageGuards(page);
  26  |   await page.goto('/?demo=1');
  27  | 
  28  |   await expect(page.locator('[data-demo-mode-banner]')).toHaveCount(0);
  29  |   await expect(page.locator('[data-view="home"] .role-intro')).toHaveCount(0);
  30  |   await expect(page.locator('[data-view="home"]')).not.toContainText('1234');
  31  |   await expect(page.locator('[data-view="home"]')).not.toContainText(/\b(?:Demo|QA|fixture|técnico)\b/i);
  32  |   await expect(page.locator('.topbar [data-admin-toggle]')).toHaveCount(0);
  33  | 
  34  |   await page.goto('/?demo=1#profile');
  35  |   await expect(page.locator('[data-view="profile"] [data-open-admin-view]')).toHaveCount(0);
  36  | 
  37  |   // La operación sigue disponible sólo mediante una ruta privada explícita.
  38  |   await page.goto('/?demo=1#business');
  39  |   await page.locator('[data-open-pin][data-admin-target="business"]').click();
  40  |   await page.getByLabel('Código del modo negocio').fill('1234');
  41  |   await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  42  |   const dashboard = page.locator('[data-business-dashboard]');
  43  |   await expect(dashboard).toBeVisible();
  44  |   await expect(dashboard.locator('[data-business-view="orders"]')).toHaveAttribute('aria-pressed', 'true');
  45  |   await expect(dashboard.locator('[data-business-workspace="orders"]')).toBeVisible();
  46  |   await expect(dashboard).not.toContainText(/Datos de ejemplo|Vista de operación|LT-0001/);
  47  | });
  48  | 
  49  | test('runtime completo habilita modo producción sin catálogo demo ni PIN', async ({ page }) => {
  50  |   await page.route('https://taba-test.supabase.co/**', async (route) => {
  51  |     await route.fulfill({
  52  |       status: 200,
  53  |       contentType: 'application/json',
  54  |       headers: { 'content-range': '0-0/0' },
  55  |       body: '[]',
  56  |     });
  57  |   });
  58  |   await page.addInitScript(({ stateKey }) => {
  59  |     globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
  60  |       mode: 'production',
  61  |       repository: {
  62  |         provider: 'supabase',
  63  |         supabaseUrl: 'https://taba-test.supabase.co',
  64  |         publishableKey: 'sb_publishable_test_key',
  65  |         businessId: '00000000-0000-4000-8000-000000000001',
  66  |       },
  67  |     };
  68  |     localStorage.setItem(stateKey, JSON.stringify({
  69  |       schemaVersion: 3,
  70  |       dataVersion: 'la-taba-runtime-v2',
  71  |       appMode: 'production',
  72  |       products: [],
  73  |       cart: [],
  74  |       orders: [{
  75  |         id: 'PII-CACHED',
  76  |         customerName: 'Cliente cacheado',
  77  |         customerPhone: '2995559999',
  78  |       }],
  79  |     }));
  80  |   }, { stateKey: STATE_KEY });
> 81  |   await page.goto('/#business');
      |              ^ Error: page.goto: Could not connect to server
  82  | 
  83  |   await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'production');
  84  |   await expect(page.locator('[data-view="business"]')).toBeVisible();
  85  |   await expect(page.locator('[data-production-auth-card="business"]')).toBeVisible();
  86  |   await expect(page.locator('[data-production-workspace="business"]')).toBeHidden();
  87  |   await expect(page.locator('[data-view="business"] [data-open-pin]')).toBeHidden();
  88  |   await expect(page.locator('[data-view="business"] [data-admin-unlocked]')).toBeHidden();
  89  | 
  90  |   await page.locator('[data-nav-view="home"]').first().click();
  91  |   await expect(page.locator('[data-view="home"] [data-production-catalog-gate]')).toBeVisible();
  92  |   await expect(page.locator('[data-view="home"] [data-catalog-dependent]')).toBeHidden();
  93  |   await expect(page.locator('[data-view="home"]')).not.toContainText(/pedido de muestra|no se envió|1234/i);
  94  |   await expect(page.locator('body')).not.toContainText('Cliente cacheado');
  95  |   expect(await page.evaluate((key) => localStorage.getItem(key), STATE_KEY)).toBeNull();
  96  | });
  97  | 
  98  | test('runtime productivo incompleto falla cerrado y no cae a preview/demo', async ({ page }) => {
  99  |   await page.addInitScript(() => {
  100 |     globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
  101 |       mode: 'production',
  102 |       repository: {
  103 |         provider: 'supabase',
  104 |         supabaseUrl: 'http://orders.example.test',
  105 |         publishableKey: 'sb_publishable_test_key',
  106 |         businessId: '00000000-0000-4000-8000-000000000001',
  107 |       },
  108 |     };
  109 |   });
  110 |   await page.goto('/#catalog');
  111 | 
  112 |   await expect(page.locator('body')).toHaveAttribute('data-app-mode', 'unavailable');
  113 |   await expect(page.locator('[data-view="catalog"]')).toHaveClass(/is-active/);
  114 |   await expect(page.locator('[data-view="catalog"] [data-production-catalog-gate]')).toBeVisible();
  115 |   await expect(page.locator('[data-view="catalog"] [data-production-catalog-message]')).toContainText('configuración productiva está incompleta');
  116 |   await expect(page.locator('[data-view="catalog"] [data-catalog-dependent]')).toBeHidden();
  117 |   await expect(page.locator('[data-admin-toggle]')).toHaveCount(0);
  118 |   await expect(page.locator('.topbar [data-production-only]')).toBeHidden();
  119 | });
  120 | 
  121 | test('checkout del preview valida contrato de Perfil y mantiene copy comercial', async ({ page }) => {
  122 |   await installPageGuards(page);
  123 |   await installBrowserStubs(page);
  124 |   await page.goto('/?demo=1#catalog');
  125 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
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
```