# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: delivery-proof.spec.mjs >> Delivery proof photo: rider adjunta foto y negocio ve comprobante local/demo
- Location: tests\e2e\delivery-proof.spec.mjs:9:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: locator('[data-delivery-panel]')
Timeout: 5000ms
- Expected substring  -  1
+ Received string     + 23

- LT-0002
+
+       
+         
+           
+           
+     
+       En servicio
+       
+         Negocio
+         Salir
+       
+     
+           
+             Sin entregas disponibles
+             Cuando haya un pedido listo para repartir, aparecerá acá con sus acciones operativas.
+             
+               Ir al panel del negocio
+             
+           
+           
+           
+         
+       

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for locator('[data-delivery-panel]')
    13 × locator resolved to <div data-delivery-panel="">…</div>
       - unexpected value "
      
        
          
          
    
      En servicio
      
        Negocio
        Salir
      
    
          
            Sin entregas disponibles
            Cuando haya un pedido listo para repartir, aparecerá acá con sus acciones operativas.
            
              Ir al panel del negocio
            
          
          
          
        
      "

```

```yaml
- banner:
  - button "Ir al inicio del comercio":
    - strong: La Taba 2
  - text: REPARTO
  - strong: Cola al día
  - button "Sólo este equipo"
  - button "Activar aviso sonoro"
- main:
  - paragraph: Repartidor
  - heading "Ingresá para ver entregas" [level=1]
  - paragraph: Vista operativa para salida del local, llegada al domicilio y entrega final.
  - button "Ingresar código"
  - button "Volver al perfil"
```

# Test source

```ts
  1   | import { expect, test } from '@playwright/test';
  2   | import { fillCheckout, gotoDemoReset, installBrowserStubs, installPageGuards, waitForToast } from './helpers.mjs';
  3   | 
  4   | const PROOF_PNG = Buffer.from(
  5   |   'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAEElEQVR4nGP8ywACLGCSAQANEQED1LYyQAAAAABJRU5ErkJggg==',
  6   |   'base64',
  7   | );
  8   | 
  9   | test('Delivery proof photo: rider adjunta foto y negocio ve comprobante local/demo', async ({ browser }) => {
  10  |   const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  11  |   const page = await context.newPage();
  12  |   const guards = installPageGuards(page);
  13  |   await installBrowserStubs(page);
  14  | 
  15  |   await gotoDemoReset(page, '/?reset=1&demo=1');
  16  | 
  17  |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  18  |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  19  |   await page.locator('[data-floating-cart]').click();
  20  |   await fillCheckout(page, {
  21  |     name: 'Cliente Foto',
  22  |     phone: '2995557777',
  23  |     street: 'Roca 123',
  24  |     neighborhood: 'Centro',
  25  |     reference: 'Casa verde',
  26  |     notes: 'Dejar en porton',
  27  |     payment: 'cash',
  28  |     deliveryMode: 'delivery',
  29  |   });
  30  |   await page.getByRole('button', { name: /Confirmar pedido/i }).click();
  31  |   await waitForToast(page, 'Pedido confirmado. Seguilo en Seguimiento.');
  32  | 
  33  |   await page.goto('/?demo=1#business');
  34  |   await expect(page.locator('[data-view="business"]')).toBeVisible();
  35  |   await page.locator('[data-open-pin][data-admin-target="business"]').click();
  36  |   await page.locator('[data-pin-form] input[name="pin"]').fill('1234');
  37  |   await page.locator('[data-pin-form]').press('Enter');
  38  |   await expect(page.locator('[data-view="business"]')).toBeVisible();
  39  |   await expect(page.locator('[data-inbox-order="LT-0002"]')).toBeVisible();
  40  | 
  41  |   await page.locator('[data-inbox-order="LT-0002"] [data-prep-minutes]').selectOption('20');
  42  |   await page.locator('[data-order-advance="LT-0002"]').click();
  43  |   await waitForToast(page, 'Estado del pedido actualizado.');
  44  |   await page.locator('[data-order-advance="LT-0002"]').click();
  45  |   await waitForToast(page, 'Estado del pedido actualizado.');
  46  | 
  47  |   await page.goto('/?demo=1#rider');
  48  |   await page.locator('[data-rider-accept="LT-0002"]').click();
  49  |   await waitForToast(page, 'Entrega aceptada. Ya podés ver los datos del pedido.');
  50  |   await page.locator('[data-delivery-leave="LT-0002"]').click();
  51  |   await waitForToast(page, 'Pedido marcado como en camino.');
  52  | 
  53  |   await page.goto('/?demo=1#tracking');
  54  |   const tracking = page.locator('[data-tracking-panel]');
  55  |   await expect(tracking.locator('.tracking-hero h1')).toHaveText('Tu pedido está en camino');
  56  |   await expect(tracking.locator('[data-tracking-map-placeholder]')).toContainText('Ubicación no disponible');
  57  |   await expect(tracking.locator('[data-tracking-gps-note]')).toHaveText(
  58  |     'El rider está en camino. La ubicación aparecerá cuando esté disponible.',
  59  |   );
  60  |   await expect(tracking.locator('[data-real-map]')).toHaveCount(0);
  61  |   await expect(tracking.locator('.lt-rider-marker')).toHaveCount(0);
  62  | 
  63  |   await page.goto('/?demo=1#rider');
  64  |   const riderPanel = page.locator('[data-delivery-panel]');
  65  |   await expect(riderPanel).toContainText('LT-0002');
  66  |   await riderPanel.locator('[data-delivery-arrive="LT-0002"]').click();
  67  |   await waitForToast(page, 'Llegada al domicilio registrada.');
  68  |   await expect(riderPanel).toContainText('Foto de entrega');
  69  | 
  70  |   await riderPanel.locator('[data-delivery-proof-input="LT-0002"]').setInputFiles({
  71  |     name: 'proof.png',
  72  |     mimeType: 'image/png',
  73  |     buffer: PROOF_PNG,
  74  |   });
  75  |   await waitForToast(page, 'Foto de entrega adjunta.');
  76  |   await expect(riderPanel.locator('[data-delivery-proof-preview]')).toBeVisible();
  77  |   await expect(riderPanel).toContainText('Comprobante tomado');
  78  | 
  79  |   await riderPanel.locator('[data-delivery-proof-remove="LT-0002"]').click();
  80  |   await waitForToast(page, 'Foto de entrega quitada.');
  81  |   await expect(riderPanel.locator('[data-delivery-proof-preview]')).toHaveCount(0);
  82  | 
  83  |   const businessNoProofPage = await context.newPage();
  84  |   await businessNoProofPage.goto('/?demo=1#business');
  85  |   await expect(businessNoProofPage.locator('[data-view="business"]')).toBeVisible();
  86  |   await businessNoProofPage.locator('[data-open-pin][data-admin-target="business"]').click();
  87  |   await businessNoProofPage.locator('[data-pin-form] input[name="pin"]').fill('1234');
  88  |   await businessNoProofPage.locator('[data-pin-form]').press('Enter');
  89  |   await expect(businessNoProofPage.locator('[data-view="business"]')).toBeVisible();
  90  |   await expect(businessNoProofPage.locator('[data-inbox-order="LT-0002"] [data-delivery-proof-summary]')).toHaveCount(0);
  91  |   await businessNoProofPage.close();
  92  | 
  93  |   await page.goto('/?demo=1#rider');
> 94  |   await expect(page.locator('[data-delivery-panel]')).toContainText('LT-0002');
      |                                                       ^ Error: expect(locator).toContainText(expected) failed
  95  |   await page.locator('[data-delivery-proof-input="LT-0002"]').setInputFiles({
  96  |     name: 'proof-2.png',
  97  |     mimeType: 'image/png',
  98  |     buffer: PROOF_PNG,
  99  |   });
  100 |   await waitForToast(page, 'Foto de entrega adjunta.');
  101 |   await expect(page.locator('[data-delivery-panel] [data-delivery-proof-preview]')).toBeVisible();
  102 | 
  103 |   await page.goto('/?demo=1#tracking');
  104 |   const code = await page.locator('[data-delivery-code]').getAttribute('data-delivery-code');
  105 |   expect(code).toMatch(/^\d{4}$/);
  106 |   await page.goto('/?demo=1#rider');
  107 |   await page.locator('[data-delivery-code-input="LT-0002"]').fill(code);
  108 |   await page.locator('[data-delivery-code-confirm="LT-0002"]').click();
  109 |   await waitForToast(page, 'Código de entrega confirmado.');
  110 |   await riderPanel.locator('[data-delivery-done="LT-0002"]').click();
  111 |   await waitForToast(page, 'Pedido marcado como entregado.');
  112 | 
  113 |   const businessWithProofPage = await context.newPage();
  114 |   await businessWithProofPage.goto('/?demo=1#business');
  115 |   await expect(businessWithProofPage.locator('[data-view="business"]')).toBeVisible();
  116 |   await businessWithProofPage.locator('[data-open-pin][data-admin-target="business"]').click();
  117 |   await businessWithProofPage.locator('[data-pin-form] input[name="pin"]').fill('1234');
  118 |   await businessWithProofPage.locator('[data-pin-form]').press('Enter');
  119 |   await expect(businessWithProofPage.locator('[data-view="business"]')).toBeVisible();
  120 |   await businessWithProofPage.locator('[data-order-filter="done"]').click();
  121 |   const proof = businessWithProofPage.locator('[data-delivery-proof-summary="LT-0002"]');
  122 |   await expect(proof).toBeVisible();
  123 |   await expect(proof).toContainText('Foto de entrega');
  124 |   await expect(proof.locator('[data-delivery-proof-thumb]')).toBeVisible();
  125 |   await expect(businessWithProofPage.locator('[data-order-inbox]')).toContainText('Entregado');
  126 | 
  127 |   await proof.locator('[data-order-proof="LT-0002"]').click();
  128 |   await expect(businessWithProofPage.locator('[data-delivery-proof-modal]')).toBeVisible();
  129 |   await expect(businessWithProofPage.locator('[data-delivery-proof-modal]')).toContainText('Comprobante tomado');
  130 |   await expect(businessWithProofPage.locator('[data-delivery-proof-modal-image]')).toBeVisible();
  131 |   await businessWithProofPage.locator('[data-close-modal]').click();
  132 |   await businessWithProofPage.close();
  133 | 
  134 |   const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  135 |   expect(noOverflow).toBeTruthy();
  136 | 
  137 |   await guards.assertClean();
  138 |   await context.close();
  139 | });
  140 | 
```