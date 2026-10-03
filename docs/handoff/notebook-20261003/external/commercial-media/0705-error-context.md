# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-commercial-p1-closure.spec.mjs >> P1-2: el contrato aplica a cualquier origen — historia con destino no comprable se apaga, la editorial sin CTA sigue
- Location: tests\e2e\taba2-commercial-p1-closure.spec.mjs:107:1

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
  - button "Ver la historia nueva de La Taba"
  - button "Ver la historia Postal del local de La Taba. Nueva": Postal del local
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
  30  |     try {
  31  |       return JSON.parse(localStorage.getItem(key) || '{}').orders?.length ?? 0;
  32  |     } catch (_) {
  33  |       return -1;
  34  |     }
  35  |   }, STATE_KEY);
  36  | }
  37  | 
  38  | // ── P1-1 ─────────────────────────────────────────────────────────────────────
  39  | 
  40  | test('P1-1: "Ver todos" de Destacados abre el catálogo poblado, nunca "0 productos"', async ({ page }) => {
  41  |   const guards = installPageGuards(page);
  42  |   await openHome(page);
  43  | 
  44  |   const verTodos = page.locator('.home-best-section .home-section-head button[data-category-id]');
  45  |   await expect(verTodos).toHaveText('Ver todos');
  46  |   await verTodos.click();
  47  | 
  48  |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  49  |   // Catálogo real: productos visibles y al menos uno COMPRABLE. Con el destino
  50  |   // anterior (`popular`, sin datos) esta pantalla decía "0 productos en Todos".
  51  |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  52  |   await expect(page.locator('[data-product-grid] [data-add-product]:not([disabled])').first()).toBeVisible();
  53  |   await expect(page.locator('[data-view="catalog"]').getByText('No hay productos disponibles')).toHaveCount(0);
  54  | 
  55  |   // Atrás conserva el contexto: vuelve a la home.
  56  |   await page.goBack();
  57  |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  58  |   await guards.assertClean();
  59  | });
  60  | 
  61  | // ── P1-2 ─────────────────────────────────────────────────────────────────────
  62  | 
  63  | test('P1-2: los banners sólo pintan destinos con producto comprable', async ({ page }) => {
  64  |   const guards = installPageGuards(page);
  65  |   await openHome(page);
  66  | 
  67  |   // Con el catálogo demo actual whisky y fernet no publican precio: sus
  68  |   // banners no se pintan (fail-closed, misma mecánica que Andes Origen).
  69  |   await expect(page.locator('.home-brand-banner[data-category-id="whisky"]')).toHaveCount(0);
  70  |   await expect(page.locator('.home-brand-banner[data-category-id="fernet"]')).toHaveCount(0);
  71  | 
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
> 130 |   await expect(entrada).toHaveAttribute('data-stories-state', 'unseen');
      |                         ^ Error: expect(locator).toHaveAttribute(expected) failed
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
  172 |   await expect(page.locator('[data-floating-cart-count]')).toHaveText('1 producto');
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