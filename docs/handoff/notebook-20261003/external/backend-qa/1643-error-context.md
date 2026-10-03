# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: beverage-storefront.spec.mjs >> controles táctiles de la Home alcanzan 44 por 44 y el carrusel sincroniza indicadores
- Location: tests\e2e\beverage-storefront.spec.mjs:249:1

# Error details

```
Error: 320x812

expect(received).toEqual(expected) // deep equality

- Expected  -   1
+ Received  + 237

- Array []
+ Array [
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"coca-cola-original-pet-500ml-pack-12\" aria-label=\"Agrega",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"coca-cola-zero-pet-500ml-pack-12\" aria-label=\"Agregar Co",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"sprite-original-pet-500ml-pack-12\" aria-label=\"Agregar S",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button type=\"button\" data-category-id=\"gaseosas\">Ver todos</button>",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"coca-cola-original-pet-1500ml-pack-6\" aria-pre",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"coca-cola-original-pet-1500ml-pack-6\" aria-label=\"Agrega",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"coca-cola-original-pet-500ml-pack-12\" aria-pre",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"coca-cola-original-pet-500ml-pack-12\" aria-label=\"Agrega",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"coca-cola-zero-pet-1500ml-pack-6\" aria-pressed",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"coca-cola-zero-pet-1500ml-pack-6\" aria-label=\"Agregar Co",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"coca-cola-zero-pet-500ml-pack-12\" aria-pressed",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"coca-cola-zero-pet-500ml-pack-12\" aria-label=\"Agregar Co",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"sprite-original-pet-1500ml-pack-6\" aria-presse",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"sprite-original-pet-1500ml-pack-6\" aria-label=\"Agregar S",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"sprite-original-pet-500ml-pack-12\" aria-presse",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"sprite-original-pet-500ml-pack-12\" aria-label=\"Agregar S",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"fanta-naranja-pet-1500ml-pack-6\" aria-pressed=",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"fanta-naranja-pet-1500ml-pack-6\" aria-label=\"Agregar Fan",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button type=\"button\" data-category-id=\"cervezas\">Ver todos</button>",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"heineken-original-lata-473ml\" aria-pressed=\"fa",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"heineken-original-lata-473ml\" aria-label=\"Agregar Heinek",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"corona-extra-botella-330ml\" aria-pressed=\"fals",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"corona-extra-botella-330ml\" aria-label=\"Agregar Corona E",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"imperial-apa-lata-473ml\" aria-pressed=\"false\" ",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"imperial-apa-lata-473ml\" aria-label=\"Agregar Imperial AP",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"imperial-cream-stout-lata-473ml\" aria-pressed=",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"imperial-cream-stout-lata-473ml\" aria-label=\"Agregar Imp",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"imperial-extra-lager-lata-473ml\" aria-pressed=",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"imperial-extra-lager-lata-473ml\" aria-label=\"Agregar Imp",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"imperial-golden-lata-473ml\" aria-pressed=\"fals",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"imperial-golden-lata-473ml\" aria-label=\"Agregar Imperial",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"schneider-rubia-lata-710ml\" aria-pressed=\"fals",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"schneider-rubia-lata-710ml\" aria-label=\"Agregar Schneide",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button type=\"button\" data-category-id=\"energizantes\">Ver todos</button>",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"red-bull-original-lata-250ml\" aria-pressed=\"fa",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"red-bull-original-lata-250ml\" aria-label=\"Agregar Red Bu",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"monster-mango-loco-lata-473ml\" aria-pressed=\"f",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"monster-mango-loco-lata-473ml\" aria-label=\"Agregar Monst",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"speed-original-lata-473ml\" aria-pressed=\"false",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"speed-original-lata-473ml\" aria-label=\"Agregar Speed Unl",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"speed-zero-lata-473ml\" aria-pressed=\"false\" ar",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"speed-zero-lata-473ml\" aria-label=\"Agregar Speed Unlimit",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button type=\"button\" data-category-id=\"mixers\">Ver todos</button>",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"schweppes-citrus-pet-1500ml-pack-6\" aria-press",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"schweppes-citrus-pet-1500ml-pack-6\" aria-label=\"Agregar ",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-favorite-button \" type=\"button\" data-favorite-toggle=\"schweppes-tonica-pet-1500ml-pack-6\" aria-press",
+     "width": 0,
+   },
+   Object {
+     "height": 0,
+     "selector": "<button class=\"home-add-button\" type=\"button\" data-add-product=\"schweppes-tonica-pet-1500ml-pack-6\" aria-label=\"Agregar ",
+     "width": 0,
+   },
+ ]
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - button "Ir al inicio del comercio" [ref=e4] [cursor=pointer]:
      - strong [ref=e6]: La Taba 2
    - button "Elegí tu dirección" [ref=e8] [cursor=pointer]:
      - img [ref=e10]
      - strong [ref=e14]: Elegí tu dirección
    - button "Ver mi pedido" [ref=e16] [cursor=pointer]:
      - img [ref=e18]
  - main [ref=e21]:
    - generic [ref=e23]:
      - region "La Taba 2" [ref=e24]:
        - generic [ref=e30]:
          - paragraph [ref=e31]: ¡Bienvenido a
          - heading "La Taba 2" [level=1] [ref=e32]:
            - generic [ref=e33]: La Taba 2
            - generic [ref=e34]: "!"
          - paragraph [ref=e35]: Tienda de bebidas · Mendoza 827, Neuquén
          - paragraph [ref=e36]:
            - generic [ref=e37]: Pedidos disponibles
      - generic [ref=e38]:
        - img [ref=e39]
        - searchbox "Buscar bebidas, marcas y ofertas" [ref=e42]
      - generic "Categorías de bebidas" [ref=e43]:
        - button "Todas" [ref=e44] [cursor=pointer]:
          - img [ref=e46]
          - generic [ref=e51]: Todas
        - button "Gaseosas" [ref=e52] [cursor=pointer]:
          - img [ref=e54]
          - generic [ref=e56]: Gaseosas
        - button "Cervezas" [ref=e57] [cursor=pointer]:
          - img [ref=e59]
          - generic [ref=e62]: Cervezas
        - button "Energizantes" [ref=e63] [cursor=pointer]:
          - img [ref=e65]
          - generic [ref=e67]: Energizantes
        - button "Mixers" [ref=e68] [cursor=pointer]:
          - img [ref=e70]
          - generic [ref=e72]: Mixers
      - region "Destacados" [ref=e73]:
        - generic [ref=e74]:
          - generic [ref=e75]:
            - heading "Destacados" [level=2] [ref=e76]
            - generic [ref=e77]: Selección del local
          - button "Ver todos" [ref=e78] [cursor=pointer]
        - generic [ref=e79]:
          - article [ref=e80]:
            - button "Ver Coca-Cola Original" [ref=e81] [cursor=pointer]:
              - img "Coca-Cola Original" [ref=e82]
            - generic [ref=e83]:
              - strong [ref=e84]: Coca-Cola Original
              - generic [ref=e85]: Pack x12 · 500 ml
              - generic [ref=e86]: $ 17.100
            - button "Agregar Coca-Cola Original al pedido" [ref=e88] [cursor=pointer]:
              - generic [ref=e89]: Agregar
          - article [ref=e90]:
            - button "Ver Coca-Cola Zero" [ref=e91] [cursor=pointer]:
              - img "Coca-Cola Zero" [ref=e92]
            - generic [ref=e93]:
              - strong [ref=e94]: Coca-Cola Zero
              - generic [ref=e95]: Pack x12 · 500 ml
              - generic [ref=e96]: $ 17.100
            - button "Agregar Coca-Cola Zero al pedido" [ref=e98] [cursor=pointer]:
              - generic [ref=e99]: Agregar
          - article [ref=e100]:
            - button "Ver Sprite" [ref=e101] [cursor=pointer]:
              - img "Sprite" [ref=e102]
            - generic [ref=e103]:
              - strong [ref=e104]: Sprite
              - generic [ref=e105]: Pack x12 · 500 ml
              - generic [ref=e106]: $ 17.100
            - button "Agregar Sprite al pedido" [ref=e108] [cursor=pointer]:
              - generic [ref=e109]: Agregar
      - button "Cervezas bien frías. Ver la categoría Cervezas" [ref=e111] [cursor=pointer]:
        - generic [ref=e112]: Para el finde
        - strong [ref=e113]: Cervezas bien frías
        - generic [ref=e114]:
          - text: Ver cervezas
          - generic [ref=e115]: →
      - generic [ref=e116]:
        - region "Gaseosas" [ref=e117]:
          - generic [ref=e118]:
            - heading "Gaseosas" [level=2] [ref=e120]
            - button "Ver todos" [ref=e121] [cursor=pointer]
          - generic [ref=e122]:
            - article [ref=e123]:
              - button "Guardar Coca-Cola Original de favoritos" [ref=e124] [cursor=pointer]:
                - img [ref=e125]
              - button "Ver Coca-Cola Original" [ref=e127] [cursor=pointer]:
                - img "Coca-Cola Original" [ref=e128]
              - generic [ref=e129]:
                - strong [ref=e130]: Coca-Cola Original
                - generic [ref=e131]: Pack x6 · 1500 ml
                - generic [ref=e132]: $ 19.999
              - button "Agregar Coca-Cola Original al pedido" [ref=e134] [cursor=pointer]:
                - generic [ref=e135]: Agregar
            - article [ref=e136]:
              - button "Guardar Coca-Cola Original de favoritos" [ref=e137] [cursor=pointer]:
                - img [ref=e138]
              - button "Ver Coca-Cola Original" [ref=e140] [cursor=pointer]:
                - img "Coca-Cola Original" [ref=e141]
              - generic [ref=e142]:
                - strong [ref=e143]: Coca-Cola Original
                - generic [ref=e144]: Pack x12 · 500 ml
                - generic [ref=e145]: $ 17.100
              - button "Agregar Coca-Cola Original al pedido" [ref=e147] [cursor=pointer]:
                - generic [ref=e148]: Agregar
            - article [ref=e149]:
              - button "Guardar Coca-Cola Zero de favoritos" [ref=e150] [cursor=pointer]:
                - img [ref=e151]
              - button "Ver Coca-Cola Zero" [ref=e153] [cursor=pointer]:
                - img "Coca-Cola Zero" [ref=e154]
              - generic [ref=e155]:
                - strong [ref=e156]: Coca-Cola Zero
                - generic [ref=e157]: Pack x6 · 1500 ml
                - generic [ref=e158]: $ 19.999
              - button "Agregar Coca-Cola Zero al pedido" [ref=e160] [cursor=pointer]:
                - generic [ref=e161]: Agregar
            - article [ref=e162]:
              - button "Guardar Coca-Cola Zero de favoritos" [ref=e163] [cursor=pointer]:
                - img [ref=e164]
              - button "Ver Coca-Cola Zero" [ref=e166] [cursor=pointer]:
                - img "Coca-Cola Zero" [ref=e167]
              - generic [ref=e168]:
                - strong [ref=e169]: Coca-Cola Zero
                - generic [ref=e170]: Pack x12 · 500 ml
                - generic [ref=e171]: $ 17.100
              - button "Agregar Coca-Cola Zero al pedido" [ref=e173] [cursor=pointer]:
                - generic [ref=e174]: Agregar
            - article [ref=e175]:
              - button "Guardar Sprite de favoritos" [ref=e176] [cursor=pointer]:
                - img [ref=e177]
              - button "Ver Sprite" [ref=e179] [cursor=pointer]:
                - img "Sprite" [ref=e180]
              - generic [ref=e181]:
                - strong [ref=e182]: Sprite
                - generic [ref=e183]: Pack x6 · 1500 ml
                - generic [ref=e184]: $ 19.999
              - button "Agregar Sprite al pedido" [ref=e186] [cursor=pointer]:
                - generic [ref=e187]: Agregar
            - article [ref=e188]:
              - button "Guardar Sprite de favoritos" [ref=e189] [cursor=pointer]:
                - img [ref=e190]
              - button "Ver Sprite" [ref=e192] [cursor=pointer]:
                - img "Sprite" [ref=e193]
              - generic [ref=e194]:
                - strong [ref=e195]: Sprite
                - generic [ref=e196]: Pack x12 · 500 ml
                - generic [ref=e197]: $ 17.100
              - button "Agregar Sprite al pedido" [ref=e199] [cursor=pointer]:
                - generic [ref=e200]: Agregar
            - article [ref=e201]:
              - button "Guardar Fanta Naranja de favoritos" [ref=e202] [cursor=pointer]:
                - img [ref=e203]
              - button "Ver Fanta Naranja" [ref=e205] [cursor=pointer]:
                - img "Fanta Naranja" [ref=e206]
              - generic [ref=e207]:
                - strong [ref=e208]: Fanta Naranja
                - generic [ref=e209]: Pack x6 · 1500 ml
                - generic [ref=e210]: $ 19.999
              - button "Agregar Fanta Naranja al pedido" [ref=e212] [cursor=pointer]:
                - generic [ref=e213]: Agregar
        - region "Cervezas" [ref=e214]:
          - generic [ref=e215]:
            - heading "Cervezas" [level=2] [ref=e217]
            - button "Ver todos" [ref=e218] [cursor=pointer]
          - generic [ref=e219]:
            - article [ref=e220]:
              - button "Guardar Heineken de favoritos" [ref=e221] [cursor=pointer]:
                - img [ref=e222]
              - button "Ver Heineken" [ref=e224] [cursor=pointer]:
                - img "Heineken" [ref=e225]
              - generic [ref=e226]:
                - strong [ref=e227]: Heineken
                - generic [ref=e228]: 473 ml
                - generic [ref=e229]: $ 3.900
              - button "Agregar Heineken al pedido" [ref=e231] [cursor=pointer]:
                - generic [ref=e232]: Agregar
            - article [ref=e233]:
              - button "Guardar Corona Extra de favoritos" [ref=e234] [cursor=pointer]:
                - img [ref=e235]
              - button "Ver Corona Extra" [ref=e237] [cursor=pointer]:
                - img "Corona Extra" [ref=e238]
              - generic [ref=e239]:
                - strong [ref=e240]: Corona Extra
                - generic [ref=e241]: 330 ml
                - generic [ref=e242]: $ 3.600
              - button "Agregar Corona Extra al pedido" [ref=e244] [cursor=pointer]:
                - generic [ref=e245]: Agregar
            - article [ref=e246]:
              - button "Guardar Imperial APA de favoritos" [ref=e247] [cursor=pointer]:
                - img [ref=e248]
              - button "Ver Imperial APA" [ref=e250] [cursor=pointer]:
                - img "Imperial APA" [ref=e251]
              - generic [ref=e252]:
                - strong [ref=e253]: Imperial APA
                - generic [ref=e254]: 473 ml
                - generic [ref=e255]: $ 3.000
              - button "Agregar Imperial APA al pedido" [ref=e257] [cursor=pointer]:
                - generic [ref=e258]: Agregar
            - article [ref=e259]:
              - button "Guardar Imperial Cream Stout de favoritos" [ref=e260] [cursor=pointer]:
                - img [ref=e261]
              - button "Ver Imperial Cream Stout" [ref=e263] [cursor=pointer]:
                - img "Imperial Cream Stout" [ref=e264]
              - generic [ref=e265]:
                - strong [ref=e266]: Imperial Cream Stout
                - generic [ref=e267]: 473 ml
                - generic [ref=e268]: $ 3.000
              - button "Agregar Imperial Cream Stout al pedido" [ref=e270] [cursor=pointer]:
                - generic [ref=e271]: Agregar
            - article [ref=e272]:
              - button "Guardar Imperial Extra Lager de favoritos" [ref=e273] [cursor=pointer]:
                - img [ref=e274]
              - button "Ver Imperial Extra Lager" [ref=e276] [cursor=pointer]:
                - img "Imperial Extra Lager" [ref=e277]
              - generic [ref=e278]:
                - strong [ref=e279]: Imperial Extra Lager
                - generic [ref=e280]: 473 ml
                - generic [ref=e281]: $ 3.000
              - button "Agregar Imperial Extra Lager al pedido" [ref=e283] [cursor=pointer]:
                - generic [ref=e284]: Agregar
            - article [ref=e285]:
              - button "Guardar Imperial Golden de favoritos" [ref=e286] [cursor=pointer]:
                - img [ref=e287]
              - button "Ver Imperial Golden" [ref=e289] [cursor=pointer]:
                - img "Imperial Golden" [ref=e290]
              - generic [ref=e291]:
                - strong [ref=e292]: Imperial Golden
                - generic [ref=e293]: 473 ml
                - generic [ref=e294]: $ 3.000
              - button "Agregar Imperial Golden al pedido" [ref=e296] [cursor=pointer]:
                - generic [ref=e297]: Agregar
            - article [ref=e298]:
              - button "Guardar Schneider Rubia de favoritos" [ref=e299] [cursor=pointer]:
                - img [ref=e300]
              - button "Ver Schneider Rubia" [ref=e302] [cursor=pointer]:
                - img "Schneider Rubia" [ref=e303]
              - generic [ref=e304]:
                - strong [ref=e305]: Schneider Rubia
                - generic [ref=e306]: 710 ml
                - generic [ref=e307]: $ 3.500
              - button "Agregar Schneider Rubia al pedido" [ref=e309] [cursor=pointer]:
                - generic [ref=e310]: Agregar
        - region "Energizantes" [ref=e311]:
          - generic [ref=e312]:
            - heading "Energizantes" [level=2] [ref=e314]
            - button "Ver todos" [ref=e315] [cursor=pointer]
          - generic [ref=e316]:
            - article [ref=e317]:
              - button "Guardar Red Bull Energy Drink de favoritos" [ref=e318] [cursor=pointer]:
                - img [ref=e319]
              - button "Ver Red Bull Energy Drink" [ref=e321] [cursor=pointer]:
                - img "Red Bull Energy Drink" [ref=e322]
              - generic [ref=e323]:
                - strong [ref=e324]: Red Bull Energy Drink
                - generic [ref=e325]: 250 ml
                - generic [ref=e326]: $ 3.576
              - button "Agregar Red Bull Energy Drink al pedido" [ref=e328] [cursor=pointer]:
                - generic [ref=e329]: Agregar
            - article [ref=e330]:
              - button "Guardar Monster Mango Loco de favoritos" [ref=e331] [cursor=pointer]:
                - img [ref=e332]
              - button "Ver Monster Mango Loco" [ref=e334] [cursor=pointer]:
                - img "Monster Mango Loco" [ref=e335]
              - generic [ref=e336]:
                - strong [ref=e337]: Monster Mango Loco
                - generic [ref=e338]: 473 ml
                - generic [ref=e339]: $ 3.390
              - button "Agregar Monster Mango Loco al pedido" [ref=e341] [cursor=pointer]:
                - generic [ref=e342]: Agregar
            - article [ref=e343]:
              - button "Guardar Speed Unlimited de favoritos" [ref=e344] [cursor=pointer]:
                - img [ref=e345]
              - button "Ver Speed Unlimited" [ref=e347] [cursor=pointer]:
                - img "Speed Unlimited" [ref=e348]
              - generic [ref=e349]:
                - strong [ref=e350]: Speed Unlimited
                - generic [ref=e351]: 473 ml
                - generic [ref=e352]: $ 2.925
              - button "Agregar Speed Unlimited al pedido" [ref=e354] [cursor=pointer]:
                - generic [ref=e355]: Agregar
            - article [ref=e356]:
              - button "Guardar Speed Unlimited de favoritos" [ref=e357] [cursor=pointer]:
                - img [ref=e358]
              - button "Ver Speed Unlimited" [ref=e360] [cursor=pointer]:
                - img "Speed Unlimited" [ref=e361]
              - generic [ref=e362]:
                - strong [ref=e363]: Speed Unlimited
                - generic [ref=e364]: 473 ml
                - generic [ref=e365]: $ 2.925
              - button "Agregar Speed Unlimited al pedido" [ref=e367] [cursor=pointer]:
                - generic [ref=e368]: Agregar
        - region "Mixers" [ref=e369]:
          - generic [ref=e370]:
            - heading "Mixers" [level=2] [ref=e372]
            - button "Ver todos" [ref=e373] [cursor=pointer]
          - generic [ref=e374]:
            - article [ref=e375]:
              - button "Guardar Schweppes Citrus de favoritos" [ref=e376] [cursor=pointer]:
                - img [ref=e377]
              - button "Ver Schweppes Citrus" [ref=e379] [cursor=pointer]:
                - img "Schweppes Citrus" [ref=e380]
              - generic [ref=e381]:
                - strong [ref=e382]: Schweppes Citrus
                - generic [ref=e383]: Pack x6 · 1500 ml
                - generic [ref=e384]: $ 19.999
              - button "Agregar Schweppes Citrus al pedido" [ref=e386] [cursor=pointer]:
                - generic [ref=e387]: Agregar
            - article [ref=e388]:
              - button "Guardar Schweppes Tónica de favoritos" [ref=e389] [cursor=pointer]:
                - img [ref=e390]
              - button "Ver Schweppes Tónica" [ref=e392] [cursor=pointer]:
                - img "Schweppes Tónica" [ref=e393]
              - generic [ref=e394]:
                - strong [ref=e395]: Schweppes Tónica
                - generic [ref=e396]: Pack x6 · 1500 ml
                - generic [ref=e397]: $ 19.999
              - button "Agregar Schweppes Tónica al pedido" [ref=e399] [cursor=pointer]:
                - generic [ref=e400]: Agregar
      - button "Ver catálogo completo" [ref=e401] [cursor=pointer]:
        - generic [ref=e402]: Ver catálogo completo
        - generic [ref=e403]: ›
  - navigation "Navegación móvil" [ref=e404]:
    - button "Catálogo" [ref=e405] [cursor=pointer]:
      - generic [ref=e407]: Catálogo
    - button "Seguir" [ref=e408] [cursor=pointer]:
      - generic [ref=e410]: Seguir
    - button "La Taba 2" [ref=e411] [cursor=pointer]:
      - img [ref=e413]
      - generic [ref=e417]: La Taba 2
    - button "Carrito" [ref=e418] [cursor=pointer]:
      - generic [ref=e420]: Carrito
    - button "Perfil" [ref=e421] [cursor=pointer]:
      - generic [ref=e423]: Perfil
```

# Test source

```ts
  180 |     ]);
  181 |     expect(finalCardBox).not.toBeNull();
  182 |     expect(navBox).not.toBeNull();
  183 |     expect(finalCardBox.y + finalCardBox.height).toBeLessThanOrEqual(navBox.y + 1);
  184 |   });
  185 | }
  186 | 
  187 | test('confirmación de edad aparece y es obligatoria sólo con alcohol', async ({ page }) => {
  188 |   await installBrowserStubs(page);
  189 | 
  190 |   await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  191 |   await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();
  192 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  193 |   await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  194 |   await expect(page.locator('[data-age-confirmation]')).toBeHidden();
  195 |   await expect(page.locator('[name="ageConfirmed"]')).not.toHaveAttribute('required');
  196 | 
  197 |   await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  198 |   await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();
  199 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  200 |   await page.locator('.desktop-nav [data-nav-view="cart"]').click();
  201 |   await expect(page.locator('[data-age-confirmation]')).toBeVisible();
  202 |   await expect(page.locator('[name="ageConfirmed"]')).toHaveAttribute('required', '');
  203 | });
  204 | 
  205 | test('el detalle comparte el control rápido de cantidad del carrito', async ({ page }) => {
  206 |   await installBrowserStubs(page);
  207 |   await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  208 |   await page.locator('[data-view="catalog"] [data-category-id="cervezas"]').click();
  209 | 
  210 |   const card = page.locator('[data-product-grid] .product-card').first();
  211 |   await card.locator('[data-product-detail]').click();
  212 |   const modal = page.locator('[data-product-modal]');
  213 |   await expect(modal.locator('.modal-cart-control[data-add-product]')).toBeVisible();
  214 | 
  215 |   await modal.locator('.modal-cart-control[data-add-product]').click();
  216 |   await expect(modal).toBeHidden();
  217 |   await card.locator('[data-product-detail]').click();
  218 |   await expect(modal.locator('.modal-cart-control [data-cart-dec] svg')).toBeVisible();
  219 |   await expect(modal.locator('.modal-cart-control strong')).toHaveText('1');
  220 | 
  221 |   await modal.locator('.modal-cart-control [data-cart-inc]').click();
  222 |   await expect(modal.locator('.modal-cart-control strong')).toHaveText('2');
  223 |   await page.waitForTimeout(140);
  224 |   await modal.locator('.modal-cart-control [data-cart-dec]').click();
  225 |   await expect(modal.locator('.modal-cart-control strong')).toHaveText('1');
  226 |   await page.waitForTimeout(140);
  227 |   await modal.locator('.modal-cart-control [data-cart-dec]').click();
  228 |   await expect(modal.locator('.modal-cart-control[data-add-product]')).toBeVisible();
  229 | });
  230 | 
  231 | test('Los filtros conservan el catálogo real y no fabrican promociones', async ({ page }) => {
  232 |   const guards = installPageGuards(page);
  233 |   await installBrowserStubs(page);
  234 |   await page.goto('/?demo=1&home=v37');
  235 | 
  236 |   await page.locator('[data-home-category-strip] [data-category-id="gaseosas"]').click();
  237 |   await expect(page.locator('[data-view="catalog"]')).toBeVisible();
  238 |   await expect(page.locator('[data-catalog-title]')).toHaveText('Gaseosas');
  239 |   await expect(page.locator('[data-product-grid] [data-add-product]')).not.toHaveCount(0);
  240 | 
  241 |   await page.goBack();
  242 |   await expect(page.locator('[data-view="home"]')).toBeVisible();
  243 | 
  244 |   await expect(page.locator('[data-home-promotions] [data-add-product]')).toHaveCount(0);
  245 |   await expect(page.locator('[data-view="catalog"] [data-category-id="promos"]')).toHaveCount(0);
  246 |   await guards.assertClean();
  247 | });
  248 | 
  249 | test('controles táctiles de la Home alcanzan 44 por 44 y el carrusel sincroniza indicadores', async ({ page }) => {
  250 |   await installBrowserStubs(page);
  251 |   await page.setViewportSize({ width: 390, height: 844 });
  252 |   await page.goto('/?demo=1&home=v37');
  253 | 
  254 |   const controlSelector = [
  255 |     '.home-merch-section:not([hidden]) .home-section-head button',
  256 |     '[data-home-promotions] .home-add-button',
  257 |     '[data-home-best-sellers] .home-add-button',
  258 |     '[data-home-sections] .home-add-button',
  259 |     '[data-home-sections] .home-favorite-button',
  260 |   ].join(', ');
  261 |   for (const viewport of [
  262 |     { width: 320, height: 812 },
  263 |     { width: 390, height: 844 },
  264 |     { width: 430, height: 932 },
  265 |   ]) {
  266 |     await page.setViewportSize(viewport);
  267 |     const controls = page.locator(controlSelector);
  268 |     // El conteo exacto describía la composición vieja (una grilla de 4 tarjetas).
  269 |     // Con carruseles por sección la cantidad depende del catálogo, así que el
  270 |     // contrato pasa a ser el que importa y no se relaja: TODO control táctil de
  271 |     // la home mide 44x44, sea cual sea el número. Se exige un piso para que un
  272 |     // render vacío no haga pasar la prueba por ausencia de controles.
  273 |     expect(await controls.count(), `${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(12);
  274 |     const undersized = await controls.evaluateAll((nodes) => nodes
  275 |       .map((node) => {
  276 |         const rect = node.getBoundingClientRect();
  277 |         return { selector: node.outerHTML.slice(0, 120), width: rect.width, height: rect.height };
  278 |       })
  279 |       .filter(({ width, height }) => width < 44 || height < 44));
> 280 |     expect(undersized, `${viewport.width}x${viewport.height}`).toEqual([]);
      |                                                                ^ Error: 320x812
  281 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  282 |   }
  283 | 
  284 |   await page.setViewportSize({ width: 390, height: 844 });
  285 |   const dots = page.locator('[data-home-paging-dots] span');
  286 |   await expect(dots).toHaveCount(1);
  287 |   await expect(dots.first()).toHaveClass(/is-active/);
  288 |   await page.setViewportSize({ width: 1280, height: 900 });
  289 |   await expect(page.locator('[data-home-paging-dots]')).toBeHidden();
  290 | });
  291 | 
  292 | test('la imagen de un producto real se reutiliza en Home, catálogo, modal y carrito', async ({ page }) => {
  293 |   await installBrowserStubs(page);
  294 |   await page.setViewportSize({ width: 390, height: 844 });
  295 |   await page.goto('/?demo=1&home=v37');
  296 |   const homeCard = page.locator('[data-home-sections] .home-best-card').first();
  297 |   const productId = await homeCard.locator('[data-product-detail]').getAttribute('data-product-detail');
  298 |   const source = await homeCard.locator('img').getAttribute('src');
  299 |   expect(productId).toBeTruthy();
  300 |   expect(source).toBeTruthy();
  301 | 
  302 |   await homeCard.locator('[data-product-detail]').click();
  303 |   await expect(page.locator(`dialog[open] [data-modal-product-id="${productId}"] img`)).toHaveAttribute('src', source);
  304 |   await page.locator('dialog[open] .modal-close').click();
  305 | 
  306 |   await homeCard.locator('[data-add-product]').click();
  307 |   await page.locator('[data-open-cart]').first().click();
  308 |   await expect(page.locator(`[data-view="cart"] img[src="${source}"]`)).toBeVisible();
  309 | 
  310 |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  311 |   await expect(page.locator(`[data-product-grid] [data-product-detail="${productId}"] img`)).toHaveAttribute('src', source);
  312 | });
  313 | 
  314 | test('la card de la home declara el pack cuando el precio es del pack completo', async ({ page }) => {
  315 |   await installBrowserStubs(page);
  316 |   await page.setViewportSize({ width: 390, height: 844 });
  317 |   await page.goto('/?demo=1&home=v37');
  318 | 
  319 |   // El precio que la card muestra al lado es el del pack entero. Si la línea de
  320 |   // unidad dice sólo la capacidad de una botella, la home afirma un precio
  321 |   // unitario inexistente. Este contrato se ancla en el catálogo, que ya declara
  322 |   // el pack, y exige que la home diga lo mismo.
  323 |   const packCard = page.locator('[data-home-sections] .home-best-card', {
  324 |     has: page.locator('[data-product-detail*="pack"]'),
  325 |   }).first();
  326 |   await expect(packCard).toBeVisible();
  327 | 
  328 |   const productId = await packCard.locator('[data-product-detail]').getAttribute('data-product-detail');
  329 |   const perPack = Number(/pack-(\d+)$/.exec(productId || '')?.[1]);
  330 |   expect(perPack, `${productId} debe declarar unidades por pack`).toBeGreaterThan(1);
  331 | 
  332 |   await expect(packCard.locator('.home-best-copy small')).toHaveText(new RegExp(`Pack x${perPack}\\b`));
  333 | 
  334 |   // La honestidad no puede costar el layout: la home sigue sin overflow.
  335 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  336 | });
  337 | 
  338 | test('la CTA móvil compacta reserva espacio real sobre la navegación', async ({ page }) => {
  339 |   await installBrowserStubs(page);
  340 | 
  341 |   for (const viewport of [
  342 |     { width: 320, height: 812 },
  343 |     { width: 360, height: 800 },
  344 |     { width: 390, height: 844 },
  345 |     { width: 430, height: 932 },
  346 |   ]) {
  347 |     await page.setViewportSize(viewport);
  348 |     await gotoDemoReset(page, '/?reset=1&demo=1#catalog');
  349 |     await page.locator('[data-view="catalog"] [data-category-id="gaseosas"]').click();
  350 | 
  351 |     const main = page.locator('main[data-app-main]');
  352 |     const emptyPadding = await main.evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom));
  353 |     await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  354 | 
  355 |     const floatingCart = page.locator('[data-floating-cart]');
  356 |     const mobileNav = page.locator('.mobile-nav');
  357 |     await expect(floatingCart).toBeVisible();
  358 |     await expect(floatingCart.locator('[data-floating-cart-label]')).toHaveText('Ver carrito');
  359 |     await expect(floatingCart.locator('[data-floating-cart-count]')).toHaveText('1 producto');
  360 |     await expect(floatingCart.locator('[data-floating-cart-summary]')).toContainText(/^\$/);
  361 |     await expect(mobileNav).toBeVisible();
  362 | 
  363 |     const [floatingBox, navBox, visiblePadding] = await Promise.all([
  364 |       floatingCart.boundingBox(),
  365 |       mobileNav.boundingBox(),
  366 |       main.evaluate((node) => parseFloat(getComputedStyle(node).paddingBottom)),
  367 |     ]);
  368 |     expect(floatingBox).not.toBeNull();
  369 |     expect(navBox).not.toBeNull();
  370 |     expect(floatingBox.height, `${viewport.width}px tactile height`).toBeGreaterThanOrEqual(44);
  371 |     expect(floatingBox.height, `${viewport.width}px compact height`).toBeLessThanOrEqual(54);
  372 |     expect(navBox.y - (floatingBox.y + floatingBox.height), `${viewport.width}px visual separation`).toBeGreaterThanOrEqual(10);
  373 |     expect(visiblePadding, `${viewport.width}px dynamic reserve`).toBeGreaterThan(emptyPadding);
  374 |     expect(visiblePadding, `${viewport.width}px reserve behind both bars`).toBeGreaterThanOrEqual(
  375 |       navBox.height + floatingBox.height + 8,
  376 |     );
  377 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  378 | 
  379 |     const lastCard = page.locator('[data-product-grid] .product-card').last();
  380 |     await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
```