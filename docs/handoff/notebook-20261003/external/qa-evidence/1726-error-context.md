# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: honest-map.spec.mjs >> el local no inventa una dirección todavía no verificada
- Location: tests\e2e\honest-map.spec.mjs:117:1

# Error details

```
Error: page.goto: Could not connect to server
Call log:
  - navigating to "http://127.0.0.1:38202/?demo=1#profile", waiting until "load"

```

# Test source

```ts
  20  |   const page = await context.newPage();
  21  |   const guards = installPageGuards(page);
  22  |   await installBrowserStubs(page);
  23  | 
  24  |   await gotoDemoReset(page, '/?reset=1&demo=1');
  25  |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  26  |   await clickAfterScrollSettles(
  27  |     page,
  28  |     page.locator('[data-product-grid] [data-add-product]:not([disabled])').first(),
  29  |   );
  30  |   await expect(page.locator('.topbar .cart-button-count')).toHaveText('1');
  31  |   await page.locator('[data-floating-cart]:visible, .topbar [data-open-cart]:visible').first().click();
  32  |   await fillCheckout(page, {
  33  |     name: 'Cliente Honesto',
  34  |     phone: '2995550000',
  35  |     street: 'Mendoza 851',
  36  |     neighborhood: 'Centro',
  37  |     reference: 'Casa azul',
  38  |     notes: 'Tocar timbre',
  39  |     payment: 'cash',
  40  |     deliveryMode: 'delivery',
  41  |   });
  42  |   await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  43  |   await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  44  |   await expect(page.locator('[data-view="tracking"]')).toBeVisible();
  45  | 
  46  |   const tracking = page.locator('[data-tracking-panel]');
  47  | 
  48  |   // Dirección textual real cargada por el cliente.
  49  |   await expect(tracking).toContainText('Mendoza 851, Centro');
  50  |   await expect(tracking).toContainText('Casa azul');
  51  | 
  52  |   // La confirmación inicial usa copy comercial sin afirmar una recepción remota.
  53  |   await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido fue confirmado');
  54  |   await expect(tracking).not.toContainText(/pedido de muestra|no se envió|presentación/i);
  55  |   await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText(TRACKING_GPS_NOTE);
  56  |   await expect(tracking).not.toContainText('En vivo');
  57  | 
  58  |   // No hay mapa montado, fallback en inglés, manija, marcadores falsos (LT/CL) ni ruta sin GPS real.
  59  |   await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  60  |   await expect(tracking.locator('.map-marker')).toHaveCount(0);
  61  |   await expect(tracking.locator('.lt-rider-marker')).toHaveCount(0);
  62  |   await expect(tracking.locator('.map-route')).toHaveCount(0);
  63  |   await expect(tracking.locator('.sheet-handle')).toHaveCount(0);
  64  |   await expect(tracking).not.toContainText(/\bMap\b/);
  65  | 
  66  |   // Una muestra recién creada no afirma que el local la recibió.
  67  |   await expect(tracking).not.toContainText('Recibido');
  68  |   await expect(tracking.locator('.sheet-head .status-chip')).toHaveCount(0);
  69  | 
  70  |   // No hay kilómetros ni ETA inventados. El tiempo estimado textual puede existir si el pedido lo trae.
  71  |   const text = await tracking.innerText();
  72  |   expect(text).not.toMatch(/\d+([.,]\d+)?\s*km/i);
  73  |   expect(text).not.toMatch(/\bETA\b/i);
  74  | 
  75  |   // En camino sin GPS: header y hero comerciales, política GPS sólo en la nota única.
  76  |   await page.evaluate(async () => {
  77  |     const { updateState } = await import('/js/state.js');
  78  |     updateState((draft) => {
  79  |       const order = draft.orders?.find((candidate) => candidate.id === draft.lastOrderId) || draft.orders?.[0];
  80  |       if (!order) return;
  81  |       const now = new Date().toISOString();
  82  |       order.status = 'on_the_way';
  83  |       order.statusHistory = [...(order.statusHistory || []), { status: 'on_the_way', at: now }];
  84  |       order.delivery = {
  85  |         ...(order.delivery || {}),
  86  |         currentLocationLabel: 'El pedido salió del local',
  87  |         estimatedMinutes: 18,
  88  |       };
  89  |       delete order.tracking;
  90  |       draft.simulation = null;
  91  |     });
  92  |   });
  93  | 
  94  |   await expect(tracking.locator('.tracking-brand-row > strong')).toHaveText('TABA2');
  95  |   await expect(tracking.getByRole('button', { name: 'Abrir menú' })).toBeVisible();
  96  |   await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido está en camino');
  97  |   await expect(tracking.locator('.tracking-hero')).not.toContainText(/GPS|mapa|no mostramos/i);
  98  |   await expect(tracking.locator('.customer-progress .track-step')).toHaveCount(4);
  99  |   await expect(tracking.locator('.customer-progress')).toContainText('Confirmado');
  100 |   await expect(tracking.locator('.customer-progress')).toContainText('Preparando');
  101 |   await expect(tracking.locator('.customer-progress')).toContainText('En camino');
  102 |   await expect(tracking.locator('.customer-progress')).toContainText('Entregado');
  103 |   await expect(tracking.locator('[data-tracking-gps-note]')).toHaveCount(1);
  104 |   await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText(OUT_FOR_DELIVERY_GPS_NOTE);
  105 |   await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  106 |   await expect(tracking.locator('[data-delivery-code-card]')).toHaveCount(0);
  107 |   await expect(tracking.locator('.sheet-handle')).toHaveCount(0);
  108 | 
  109 |   // No hay overflow horizontal en 390x844.
  110 |   const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  111 |   expect(noOverflow).toBeTruthy();
  112 | 
  113 |   await guards.assertClean();
  114 |   await context.close();
  115 | });
  116 | 
  117 | test('el local no inventa una dirección todavía no verificada', async ({ page }) => {
  118 |   await installBrowserStubs(page);
  119 |   const guards = installPageGuards(page);
> 120 |   await page.goto('/?demo=1#profile');
      |              ^ Error: page.goto: Could not connect to server
  121 |   await expect(page.locator('[data-view="profile"]')).toBeVisible();
  122 |   await expect(page.locator('[data-business-address]').first()).toContainText('Dirección a confirmar con el local');
  123 |   await guards.assertClean();
  124 | });
  125 | 
```