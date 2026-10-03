# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: beverage-storefront.spec.mjs >> controles táctiles de la Home alcanzan 44 por 44 y el carrusel sincroniza indicadores
- Location: tests\e2e\beverage-storefront.spec.mjs:249:1

# Error details

```
Error: 390x844

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
      - generic [ref=e15]: ›
    - button "Ver mi pedido" [ref=e17] [cursor=pointer]:
      - img [ref=e19]
  - main [ref=e22]:
    - generic [ref=e24]:
      - region "La Taba 2" [ref=e25]:
        - generic [ref=e31]:
          - paragraph [ref=e32]: ¡Bienvenido a
          - heading "La Taba 2" [level=1] [ref=e33]:
            - generic [ref=e34]: La Taba 2
            - generic [ref=e35]: "!"
          - paragraph [ref=e36]: Tienda de bebidas · Mendoza 827, Neuquén
          - paragraph [ref=e37]:
            - generic [ref=e38]: Pedidos disponibles
      - generic [ref=e39]:
        - img [ref=e40]
        - searchbox "Buscar bebidas, marcas y ofertas" [ref=e43]
      - generic "Categorías de bebidas" [ref=e44]:
        - button "Todas" [ref=e45] [cursor=pointer]:
          - img [ref=e47]
          - generic [ref=e52]: Todas
        - button "Gaseosas" [ref=e53] [cursor=pointer]:
          - img [ref=e55]
          - generic [ref=e57]: Gaseosas
        - button "Cervezas" [ref=e58] [cursor=pointer]:
          - img [ref=e60]
          - generic [ref=e63]: Cervezas
        - button "Energizantes" [ref=e64] [cursor=pointer]:
          - img [ref=e66]
          - generic [ref=e68]: Energizantes
        - button "Mixers" [ref=e69] [cursor=pointer]:
          - img [ref=e71]
          - generic [ref=e73]: Mixers
      - region "Destacados" [ref=e74]:
        - generic [ref=e75]:
          - generic [ref=e76]:
            - heading "Destacados" [level=2] [ref=e77]
            - generic [ref=e78]: Selección del local
          - button "Ver todos" [ref=e79] [cursor=pointer]
        - generic [ref=e80]:
          - article [ref=e81]:
            - button "Ver Coca-Cola Original" [ref=e82] [cursor=pointer]:
              - img "Coca-Cola Original" [ref=e83]
            - generic [ref=e84]:
              - strong [ref=e85]: Coca-Cola Original
              - generic [ref=e86]: Pack x12 · 500 ml
              - generic [ref=e87]: $ 17.100
            - button "Agregar Coca-Cola Original al pedido" [ref=e89] [cursor=pointer]:
              - generic [ref=e90]: Agregar
          - article [ref=e91]:
            - button "Ver Coca-Cola Zero" [ref=e92] [cursor=pointer]:
              - img "Coca-Cola Zero" [ref=e93]
            - generic [ref=e94]:
              - strong [ref=e95]: Coca-Cola Zero
              - generic [ref=e96]: Pack x12 · 500 ml
              - generic [ref=e97]: $ 17.100
            - button "Agregar Coca-Cola Zero al pedido" [ref=e99] [cursor=pointer]:
              - generic [ref=e100]: Agregar
          - article [ref=e101]:
            - button "Ver Sprite" [ref=e102] [cursor=pointer]:
              - img "Sprite" [ref=e103]
            - generic [ref=e104]:
              - strong [ref=e105]: Sprite
              - generic [ref=e106]: Pack x12 · 500 ml
              - generic [ref=e107]: $ 17.100
            - button "Agregar Sprite al pedido" [ref=e109] [cursor=pointer]:
              - generic [ref=e110]: Agregar
      - button "Cervezas bien frías. Ver la categoría Cervezas" [ref=e112] [cursor=pointer]:
        - generic [ref=e113]: Para el finde
        - strong [ref=e114]: Cervezas bien frías
        - generic [ref=e115]:
          - text: Ver cervezas
          - generic [ref=e116]: →
      - generic [ref=e117]:
        - region "Gaseosas" [ref=e118]:
          - generic [ref=e119]:
            - heading "Gaseosas" [level=2] [ref=e121]
            - button "Ver todos" [ref=e122] [cursor=pointer]
          - generic [ref=e123]:
            - article [ref=e124]:
              - button "Guardar Coca-Cola Original de favoritos" [ref=e125] [cursor=pointer]:
                - img [ref=e126]
              - button "Ver Coca-Cola Original" [ref=e128] [cursor=pointer]:
                - img "Coca-Cola Original" [ref=e129]
              - generic [ref=e130]:
                - strong [ref=e131]: Coca-Cola Original
                - generic [ref=e132]: Pack x6 · 1500 ml
                - generic [ref=e133]: $ 19.999
              - button "Agregar Coca-Cola Original al pedido" [ref=e135] [cursor=pointer]:
                - generic [ref=e136]: Agregar
            - article [ref=e137]:
              - button "Guardar Coca-Cola Original de favoritos" [ref=e138] [cursor=pointer]:
                - img [ref=e139]
              - button "Ver Coca-Cola Original" [ref=e141] [cursor=pointer]:
                - img "Coca-Cola Original" [ref=e142]
              - generic [ref=e143]:
                - strong [ref=e144]: Coca-Cola Original
                - generic [ref=e145]: Pack x12 · 500 ml
                - generic [ref=e146]: $ 17.100
              - button "Agregar Coca-Cola Original al pedido" [ref=e148] [cursor=pointer]:
                - generic [ref=e149]: Agregar
            - article [ref=e150]:
              - button "Guardar Coca-Cola Zero de favoritos" [ref=e151] [cursor=pointer]:
                - img [ref=e152]
              - button "Ver Coca-Cola Zero" [ref=e154] [cursor=pointer]:
                - img "Coca-Cola Zero" [ref=e155]
              - generic [ref=e156]:
                - strong [ref=e157]: Coca-Cola Zero
                - generic [ref=e158]: Pack x6 · 1500 ml
                - generic [ref=e159]: $ 19.999
              - button "Agregar Coca-Cola Zero al pedido" [ref=e161] [cursor=pointer]:
                - generic [ref=e162]: Agregar
            - article [ref=e163]:
              - button "Guardar Coca-Cola Zero de favoritos" [ref=e164] [cursor=pointer]:
                - img [ref=e165]
              - button "Ver Coca-Cola Zero" [ref=e167] [cursor=pointer]:
                - img "Coca-Cola Zero" [ref=e168]
              - generic [ref=e169]:
                - strong [ref=e170]: Coca-Cola Zero
                - generic [ref=e171]: Pack x12 · 500 ml
                - generic [ref=e172]: $ 17.100
              - button "Agregar Coca-Cola Zero al pedido" [ref=e174] [cursor=pointer]:
                - generic [ref=e175]: Agregar
            - article [ref=e176]:
              - button "Guardar Sprite de favoritos" [ref=e177] [cursor=pointer]:
                - img [ref=e178]
              - button "Ver Sprite" [ref=e180] [cursor=pointer]:
                - img "Sprite" [ref=e181]
              - generic [ref=e182]:
                - strong [ref=e183]: Sprite
                - generic [ref=e184]: Pack x6 · 1500 ml
                - generic [ref=e185]: $ 19.999
              - button "Agregar Sprite al pedido" [ref=e187] [cursor=pointer]:
                - generic [ref=e188]: Agregar
            - article [ref=e189]:
              - button "Guardar Sprite de favoritos" [ref=e190] [cursor=pointer]:
                - img [ref=e191]
              - button "Ver Sprite" [ref=e193] [cursor=pointer]:
                - img "Sprite" [ref=e194]
              - generic [ref=e195]:
                - strong [ref=e196]: Sprite
                - generic [ref=e197]: Pack x12 · 500 ml
                - generic [ref=e198]: $ 17.100
              - button "Agregar Sprite al pedido" [ref=e200] [cursor=pointer]:
                - generic [ref=e201]: Agregar
            - article [ref=e202]:
              - button "Guardar Fanta Naranja de favoritos" [ref=e203] [cursor=pointer]:
                - img [ref=e204]
              - button "Ver Fanta Naranja" [ref=e206] [cursor=pointer]:
                - img "Fanta Naranja" [ref=e207]
              - generic [ref=e208]:
                - strong [ref=e209]: Fanta Naranja
                - generic [ref=e210]: Pack x6 · 1500 ml
                - generic [ref=e211]: $ 19.999
              - button "Agregar Fanta Naranja al pedido" [ref=e213] [cursor=pointer]:
                - generic [ref=e214]: Agregar
        - region "Cervezas" [ref=e215]:
          - generic [ref=e216]:
            - heading "Cervezas" [level=2] [ref=e218]
            - button "Ver todos" [ref=e219] [cursor=pointer]
          - generic [ref=e220]:
            - article [ref=e221]:
              - button "Guardar Heineken de favoritos" [ref=e222] [cursor=pointer]:
                - img [ref=e223]
              - button "Ver Heineken" [ref=e225] [cursor=pointer]:
                - img "Heineken" [ref=e226]
              - generic [ref=e227]:
                - strong [ref=e228]: Heineken
                - generic [ref=e229]: 473 ml
                - generic [ref=e230]: $ 3.900
              - button "Agregar Heineken al pedido" [ref=e232] [cursor=pointer]:
                - generic [ref=e233]: Agregar
            - article [ref=e234]:
              - button "Guardar Corona Extra de favoritos" [ref=e235] [cursor=pointer]:
                - img [ref=e236]
              - button "Ver Corona Extra" [ref=e238] [cursor=pointer]:
                - img "Corona Extra" [ref=e239]
              - generic [ref=e240]:
                - strong [ref=e241]: Corona Extra
                - generic [ref=e242]: 330 ml
                - generic [ref=e243]: $ 3.600
              - button "Agregar Corona Extra al pedido" [ref=e245] [cursor=pointer]:
                - generic [ref=e246]: Agregar
            - article [ref=e247]:
              - button "Guardar Imperial APA de favoritos" [ref=e248] [cursor=pointer]:
                - img [ref=e249]
              - button "Ver Imperial APA" [ref=e251] [cursor=pointer]:
                - img "Imperial APA" [ref=e252]
              - generic [ref=e253]:
                - strong [ref=e254]: Imperial APA
                - generic [ref=e255]: 473 ml
                - generic [ref=e256]: $ 3.000
              - button "Agregar Imperial APA al pedido" [ref=e258] [cursor=pointer]:
                - generic [ref=e259]: Agregar
            - article [ref=e260]:
              - button "Guardar Imperial Cream Stout de favoritos" [ref=e261] [cursor=pointer]:
                - img [ref=e262]
              - button "Ver Imperial Cream Stout" [ref=e264] [cursor=pointer]:
                - img "Imperial Cream Stout" [ref=e265]
              - generic [ref=e266]:
                - strong [ref=e267]: Imperial Cream Stout
                - generic [ref=e268]: 473 ml
                - generic [ref=e269]: $ 3.000
              - button "Agregar Imperial Cream Stout al pedido" [ref=e271] [cursor=pointer]:
                - generic [ref=e272]: Agregar
            - article [ref=e273]:
              - button "Guardar Imperial Extra Lager de favoritos" [ref=e274] [cursor=pointer]:
                - img [ref=e275]
              - button "Ver Imperial Extra Lager" [ref=e277] [cursor=pointer]:
                - img "Imperial Extra Lager" [ref=e278]
              - generic [ref=e279]:
                - strong [ref=e280]: Imperial Extra Lager
                - generic [ref=e281]: 473 ml
                - generic [ref=e282]: $ 3.000
              - button "Agregar Imperial Extra Lager al pedido" [ref=e284] [cursor=pointer]:
                - generic [ref=e285]: Agregar
            - article [ref=e286]:
              - button "Guardar Imperial Golden de favoritos" [ref=e287] [cursor=pointer]:
                - img [ref=e288]
              - button "Ver Imperial Golden" [ref=e290] [cursor=pointer]:
                - img "Imperial Golden" [ref=e291]
              - generic [ref=e292]:
                - strong [ref=e293]: Imperial Golden
                - generic [ref=e294]: 473 ml
                - generic [ref=e295]: $ 3.000
              - button "Agregar Imperial Golden al pedido" [ref=e297] [cursor=pointer]:
                - generic [ref=e298]: Agregar
            - article [ref=e299]:
              - button "Guardar Schneider Rubia de favoritos" [ref=e300] [cursor=pointer]:
                - img [ref=e301]
              - button "Ver Schneider Rubia" [ref=e303] [cursor=pointer]:
                - img "Schneider Rubia" [ref=e304]
              - generic [ref=e305]:
                - strong [ref=e306]: Schneider Rubia
                - generic [ref=e307]: 710 ml
                - generic [ref=e308]: $ 3.500
              - button "Agregar Schneider Rubia al pedido" [ref=e310] [cursor=pointer]:
                - generic [ref=e311]: Agregar
        - region "Energizantes" [ref=e312]:
          - generic [ref=e313]:
            - heading "Energizantes" [level=2] [ref=e315]
            - button "Ver todos" [ref=e316] [cursor=pointer]
          - generic [ref=e317]:
            - article [ref=e318]:
              - button "Guardar Red Bull Energy Drink de favoritos" [ref=e319] [cursor=pointer]:
                - img [ref=e320]
              - button "Ver Red Bull Energy Drink" [ref=e322] [cursor=pointer]:
                - img "Red Bull Energy Drink" [ref=e323]
              - generic [ref=e324]:
                - strong [ref=e325]: Red Bull Energy Drink
                - generic [ref=e326]: 250 ml
                - generic [ref=e327]: $ 3.576
              - button "Agregar Red Bull Energy Drink al pedido" [ref=e329] [cursor=pointer]:
                - generic [ref=e330]: Agregar
            - article [ref=e331]:
              - button "Guardar Monster Mango Loco de favoritos" [ref=e332] [cursor=pointer]:
                - img [ref=e333]
              - button "Ver Monster Mango Loco" [ref=e335] [cursor=pointer]:
                - img "Monster Mango Loco" [ref=e336]
              - generic [ref=e337]:
                - strong [ref=e338]: Monster Mango Loco
                - generic [ref=e339]: 473 ml
                - generic [ref=e340]: $ 3.390
              - button "Agregar Monster Mango Loco al pedido" [ref=e342] [cursor=pointer]:
                - generic [ref=e343]: Agregar
            - article [ref=e344]:
              - button "Guardar Speed Unlimited de favoritos" [ref=e345] [cursor=pointer]:
                - img [ref=e346]
              - button "Ver Speed Unlimited" [ref=e348] [cursor=pointer]:
                - img "Speed Unlimited" [ref=e349]
              - generic [ref=e350]:
                - strong [ref=e351]: Speed Unlimited
                - generic [ref=e352]: 473 ml
                - generic [ref=e353]: $ 2.925
              - button "Agregar Speed Unlimited al pedido" [ref=e355] [cursor=pointer]:
                - generic [ref=e356]: Agregar
            - article [ref=e357]:
              - button "Guardar Speed Unlimited de favoritos" [ref=e358] [cursor=pointer]:
                - img [ref=e359]
              - button "Ver Speed Unlimited" [ref=e361] [cursor=pointer]:
                - img "Speed Unlimited" [ref=e362]
              - generic [ref=e363]:
                - strong [ref=e364]: Speed Unlimited
                - generic [ref=e365]: 473 ml
                - generic [ref=e366]: $ 2.925
              - button "Agregar Speed Unlimited al pedido" [ref=e368] [cursor=pointer]:
                - generic [ref=e369]: Agregar
        - region "Mixers" [ref=e370]:
          - generic [ref=e371]:
            - heading "Mixers" [level=2] [ref=e373]
            - button "Ver todos" [ref=e374] [cursor=pointer]
          - generic [ref=e375]:
            - article [ref=e376]:
              - button "Guardar Schweppes Citrus de favoritos" [ref=e377] [cursor=pointer]:
                - img [ref=e378]
              - button "Ver Schweppes Citrus" [ref=e380] [cursor=pointer]:
                - img "Schweppes Citrus" [ref=e381]
              - generic [ref=e382]:
                - strong [ref=e383]: Schweppes Citrus
                - generic [ref=e384]: Pack x6 · 1500 ml
                - generic [ref=e385]: $ 19.999
              - button "Agregar Schweppes Citrus al pedido" [ref=e387] [cursor=pointer]:
                - generic [ref=e388]: Agregar
            - article [ref=e389]:
              - button "Guardar Schweppes Tónica de favoritos" [ref=e390] [cursor=pointer]:
                - img [ref=e391]
              - button "Ver Schweppes Tónica" [ref=e393] [cursor=pointer]:
                - img "Schweppes Tónica" [ref=e394]
              - generic [ref=e395]:
                - strong [ref=e396]: Schweppes Tónica
                - generic [ref=e397]: Pack x6 · 1500 ml
                - generic [ref=e398]: $ 19.999
              - button "Agregar Schweppes Tónica al pedido" [ref=e400] [cursor=pointer]:
                - generic [ref=e401]: Agregar
      - button "Ver catálogo completo" [ref=e402] [cursor=pointer]:
        - generic [ref=e403]: Ver catálogo completo
        - generic [ref=e404]: ›
  - navigation "Navegación móvil" [ref=e405]:
    - button "Catálogo" [ref=e406] [cursor=pointer]:
      - generic [ref=e408]: Catálogo
    - button "Seguir" [ref=e409] [cursor=pointer]:
      - generic [ref=e411]: Seguir
    - button "La Taba 2" [ref=e412] [cursor=pointer]:
      - img [ref=e414]
      - generic [ref=e418]: La Taba 2
    - button "Carrito" [ref=e419] [cursor=pointer]:
      - generic [ref=e421]: Carrito
    - button "Perfil" [ref=e422] [cursor=pointer]:
      - generic [ref=e424]: Perfil
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
      |                                                                ^ Error: 390x844
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