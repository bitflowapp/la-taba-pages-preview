# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: taba2-brand-home.spec.mjs >> ningún texto de las vistas del cliente queda por debajo de 3:1
- Location: tests\e2e\taba2-brand-home.spec.mjs:466:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for locator('.mobile-nav [data-nav-view="cart"]')

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - banner [ref=e3]:
    - button "Ir al inicio del comercio" [ref=e4] [cursor=pointer]:
      - strong [ref=e6]: La Taba
    - button "ENVIAR A Avenida Argentina 450" [ref=e8] [cursor=pointer]:
      - img [ref=e10]
      - generic [ref=e13]:
        - generic [ref=e14]: ENVIAR A
        - strong [ref=e15]: Avenida Argentina 450
      - generic [ref=e16]: ›
    - button "Ver mi pedido" [ref=e18] [cursor=pointer]:
      - generic [ref=e19]:
        - img [ref=e20]
        - generic [ref=e23]: "1"
  - main [ref=e24]:
    - text: Agregado ✓ Agregado ✓
    - generic [ref=e26]:
      - generic [ref=e27]:
        - img [ref=e29]
        - searchbox "Buscar productos o marcas" [ref=e32]
      - generic [ref=e33]:
        - button "Todas" [pressed] [ref=e34] [cursor=pointer]:
          - img [ref=e36]
          - generic [ref=e41]: Todas
        - button "Favoritos" [ref=e42] [cursor=pointer]:
          - img [ref=e44]
          - generic [ref=e46]: Favoritos
        - button "Cervezas" [ref=e47] [cursor=pointer]:
          - img [ref=e49]
          - generic [ref=e52]: Cervezas
        - button "Energizantes" [ref=e53] [cursor=pointer]:
          - img [ref=e55]
          - generic [ref=e57]: Energizantes
        - button "Gaseosas" [ref=e58] [cursor=pointer]:
          - img [ref=e60]
          - generic [ref=e62]: Gaseosas
        - button "Aguas" [ref=e63] [cursor=pointer]:
          - img [ref=e65]
          - generic [ref=e67]: Aguas
        - button "Ver más categorías" [ref=e68] [cursor=pointer]:
          - img [ref=e70]
          - generic [ref=e74]: Más
        - button "Aguas saborizadas" [ref=e75] [cursor=pointer]:
          - img [ref=e77]
          - generic [ref=e79]: Aguas saborizadas
        - button "Isotónicas" [ref=e80] [cursor=pointer]:
          - img [ref=e82]
          - generic [ref=e85]: Isotónicas
        - button "Fernet y amargos" [ref=e86] [cursor=pointer]:
          - img [ref=e88]
          - generic [ref=e90]: Fernet y amargos
        - button "Aperitivos" [ref=e91] [cursor=pointer]:
          - img [ref=e93]
          - generic [ref=e96]: Aperitivos
        - button "Vinos" [ref=e97] [cursor=pointer]:
          - img [ref=e99]
          - generic [ref=e101]: Vinos
        - button "Espumantes y sidras" [ref=e102] [cursor=pointer]:
          - img [ref=e104]
          - generic [ref=e106]: Espumantes y sidras
        - button "Destilados" [ref=e107] [cursor=pointer]:
          - img [ref=e109]
          - generic [ref=e112]: Destilados
        - button "Mixers" [ref=e113] [cursor=pointer]:
          - img [ref=e115]
          - generic [ref=e117]: Mixers
        - button "Hielo" [ref=e118] [cursor=pointer]:
          - img [ref=e120]
          - generic [ref=e123]: Hielo
      - generic [ref=e124]:
        - heading "Todas" [active] [level=1] [ref=e125]
        - paragraph [ref=e126]: 80 productos
      - generic [ref=e127]:
        - group [ref=e128]:
          - generic "Filtros" [ref=e129] [cursor=pointer]:
            - generic [ref=e130]: Filtros
            - generic [ref=e131]: ⌄
          - option "Todas las marcas" [selected]
          - option "7UP"
          - option "Alamos"
          - option "Amstel"
          - option "Aperol"
          - option "Bombay Sapphire"
          - option "Bonaqua"
          - option "Bosque"
          - option "Brahma"
          - option "Britvic"
          - option "Budweiser"
          - option "Buhero"
          - option "Campari"
          - option "Chandon"
          - option "Cinzano"
          - option "Coca-Cola"
          - option "Corona"
          - option "Cristal"
          - option "Eco de los Andes"
          - option "Fanta"
          - option "Fernet Branca"
          - option "Fin del Mundo"
          - option "Gancia"
          - option "Gatorade"
          - option "Glaciar"
          - option "H2OH!"
          - option "Heineken"
          - option "Imperial"
          - option "Ivess"
          - option "Johnnie Walker"
          - option "Levité"
          - option "Manaos"
          - option "Martini"
          - option "Monster"
          - option "Norton"
          - option "Paso de los Toros"
          - option "Patagonia"
          - option "Pepsi"
          - option "Powerade"
          - option "Quilmes"
          - option "Red Bull"
          - option "Rutini"
          - option "Schneider"
          - option "Schweppes"
          - option "Speed"
          - option "Sprite"
          - option "Stella Artois"
          - option "Tanqueray"
          - option "Trapiche"
          - option "Trumpeter"
          - option "Villavicencio"
          - option "Vittone"
          - option "Todas las capacidades" [selected]
          - option "200 ml"
          - option "250 ml"
          - option "310 ml"
          - option "330 ml"
          - option "354 ml"
          - option "355 ml"
          - option "400 ml"
          - option "450 ml"
          - option "473 ml"
          - option "500 ml"
          - option "600 ml"
          - option "700 ml"
          - option "710 ml"
          - option "730 ml"
          - option "750 ml"
          - option "950 ml"
          - option "995 ml"
          - option "1 L"
          - option "1,5 L"
          - option "2 L"
          - option "2,25 L"
          - option "4000 g"
          - option "Todas las presentaciones" [selected]
          - option "Botella"
          - option "Botella PET"
          - option "Lata"
          - option "Unidad"
          - option "Con y sin alcohol" [selected]
          - option "Con alcohol"
          - option "Sin alcohol"
          - option "Toda disponibilidad" [selected]
          - option "Disponible"
          - option "No disponible"
          - option "Todos los precios" [selected]
          - option "Con precio"
          - option "Precio próximamente"
        - generic [ref=e132]:
          - generic [ref=e133]:
            - img [ref=e134]
            - generic [ref=e136]: Recomendados
          - combobox "Ordenar productos" [ref=e138]:
            - option "Recomendados" [selected]
            - option "Menor precio"
            - option "Destacados"
      - generic [ref=e140]:
        - article [ref=e141]:
          - generic [ref=e142]:
            - button "Ver Red Bull Energy Drink" [ref=e143] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Red Bull Energy Drink" [ref=e144]'
            - button "Guardar Red Bull Energy Drink 250 ml · Lata de favoritos" [ref=e145] [cursor=pointer]:
              - img [ref=e146]
          - generic [ref=e148]:
            - heading "Red Bull Energy Drink" [level=3] [ref=e149]
            - paragraph [ref=e150]: 250 ml · Lata
            - generic [ref=e151]:
              - strong [ref=e154]: $ 3.576
              - button "Agregar Red Bull Energy Drink 250 ml · Lata al pedido" [ref=e156] [cursor=pointer]:
                - generic [ref=e157]: +
        - article [ref=e158]:
          - generic [ref=e159]:
            - button "Ver Speed Unlimited Original" [ref=e160] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Speed Unlimited Original" [ref=e161]'
            - button "Guardar Speed Unlimited 473 ml · Lata de favoritos" [ref=e162] [cursor=pointer]:
              - img [ref=e163]
          - generic [ref=e165]:
            - heading "Speed Unlimited" [level=3] [ref=e166]
            - paragraph [ref=e167]: 473 ml · Lata
            - generic [ref=e168]:
              - strong [ref=e171]: $ 2.925
              - button "Agregar Speed Unlimited 473 ml · Lata al pedido" [ref=e173] [cursor=pointer]:
                - generic [ref=e174]: +
        - article [ref=e175]:
          - generic [ref=e176]:
            - button "Ver Speed Unlimited Zero Sugar" [ref=e177] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Speed Unlimited Zero Sugar" [ref=e178]'
            - button "Guardar Speed Unlimited Zero Sugar 473 ml · Lata de favoritos" [ref=e179] [cursor=pointer]:
              - img [ref=e180]
          - generic [ref=e182]:
            - heading "Speed Unlimited Zero Sugar" [level=3] [ref=e183]
            - paragraph [ref=e184]: 473 ml · Lata
            - generic [ref=e185]:
              - strong [ref=e188]: $ 2.925
              - button "Agregar Speed Unlimited Zero Sugar 473 ml · Lata al pedido" [ref=e190] [cursor=pointer]:
                - generic [ref=e191]: +
        - article [ref=e192]:
          - generic [ref=e193]:
            - button "Ver Monster Mango Loco" [ref=e194] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Monster Mango Loco" [ref=e195]'
            - button "Guardar Monster Mango Loco 473 ml · Lata de favoritos" [ref=e196] [cursor=pointer]:
              - img [ref=e197]
          - generic [ref=e199]:
            - heading "Monster Mango Loco" [level=3] [ref=e200]
            - paragraph [ref=e201]: 473 ml · Lata
            - generic [ref=e202]:
              - strong [ref=e205]: $ 3.390
              - button "Agregar Monster Mango Loco 473 ml · Lata al pedido" [ref=e207] [cursor=pointer]:
                - generic [ref=e208]: +
        - article [ref=e209]:
          - generic [ref=e210]:
            - button "Ver Heineken" [ref=e211] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Heineken" [ref=e212]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Heineken 473 ml · Lata de favoritos" [ref=e213] [cursor=pointer]:
              - img [ref=e214]
          - generic [ref=e216]:
            - heading "Heineken" [level=3] [ref=e217]
            - paragraph [ref=e218]: 473 ml · Lata
            - generic [ref=e219]:
              - strong [ref=e222]: $ 3.900
              - generic "Cantidad de Heineken 473 ml · Lata en el pedido" [ref=e224]:
                - button "Quitar Heineken 473 ml · Lata del pedido" [ref=e225] [cursor=pointer]:
                  - img [ref=e226]
                - strong [ref=e228]: "1"
                - button "Sumar uno de Heineken 473 ml · Lata" [ref=e229] [cursor=pointer]:
                  - generic [ref=e230]: +
                - text: Agregado ✓
        - article [ref=e231]:
          - generic [ref=e232]:
            - button "Ver Imperial Golden" [ref=e233] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial Golden" [ref=e234]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial Golden 473 ml · Lata de favoritos" [ref=e235] [cursor=pointer]:
              - img [ref=e236]
          - generic [ref=e238]:
            - heading "Imperial Golden" [level=3] [ref=e239]
            - paragraph [ref=e240]: 473 ml · Lata
            - generic [ref=e241]:
              - strong [ref=e244]: $ 3.000
              - button "Agregar Imperial Golden 473 ml · Lata al pedido" [ref=e246] [cursor=pointer]:
                - generic [ref=e247]: +
        - article [ref=e248]:
          - generic [ref=e249]:
            - button "Ver Imperial Extra Lager" [ref=e250] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial Extra Lager" [ref=e251]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial Extra Lager 473 ml · Lata de favoritos" [ref=e252] [cursor=pointer]:
              - img [ref=e253]
          - generic [ref=e255]:
            - heading "Imperial Extra Lager" [level=3] [ref=e256]
            - paragraph [ref=e257]: 473 ml · Lata
            - generic [ref=e258]:
              - strong [ref=e261]: $ 3.000
              - button "Agregar Imperial Extra Lager 473 ml · Lata al pedido" [ref=e263] [cursor=pointer]:
                - generic [ref=e264]: +
        - article [ref=e265]:
          - generic [ref=e266]:
            - button "Ver Imperial APA" [ref=e267] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial APA" [ref=e268]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial APA 473 ml · Lata de favoritos" [ref=e269] [cursor=pointer]:
              - img [ref=e270]
          - generic [ref=e272]:
            - heading "Imperial APA" [level=3] [ref=e273]
            - paragraph [ref=e274]: 473 ml · Lata
            - generic [ref=e275]:
              - strong [ref=e278]: $ 3.000
              - button "Agregar Imperial APA 473 ml · Lata al pedido" [ref=e280] [cursor=pointer]:
                - generic [ref=e281]: +
        - article [ref=e282]:
          - generic [ref=e283]:
            - button "Ver Imperial Cream Stout" [ref=e284] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial Cream Stout" [ref=e285]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial Cream Stout 473 ml · Lata de favoritos" [ref=e286] [cursor=pointer]:
              - img [ref=e287]
          - generic [ref=e289]:
            - heading "Imperial Cream Stout" [level=3] [ref=e290]
            - paragraph [ref=e291]: 473 ml · Lata
            - generic [ref=e292]:
              - strong [ref=e295]: $ 3.000
              - button "Agregar Imperial Cream Stout 473 ml · Lata al pedido" [ref=e297] [cursor=pointer]:
                - generic [ref=e298]: +
        - article [ref=e299]:
          - generic [ref=e300]:
            - button "Ver Schneider Rubia" [ref=e301] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schneider Rubia" [ref=e302]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Schneider Rubia 710 ml · Lata de favoritos" [ref=e303] [cursor=pointer]:
              - img [ref=e304]
          - generic [ref=e306]:
            - heading "Schneider Rubia" [level=3] [ref=e307]
            - paragraph [ref=e308]: 710 ml · Lata
            - generic [ref=e309]:
              - strong [ref=e312]: $ 3.500
              - button "Agregar Schneider Rubia 710 ml · Lata al pedido" [ref=e314] [cursor=pointer]:
                - generic [ref=e315]: +
        - article [ref=e316]:
          - generic [ref=e317]:
            - button "Ver Corona Extra" [ref=e318] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Corona Extra" [ref=e319]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Corona Extra 330 ml de favoritos" [ref=e320] [cursor=pointer]:
              - img [ref=e321]
          - generic [ref=e323]:
            - heading "Corona Extra" [level=3] [ref=e324]
            - paragraph [ref=e325]: 330 ml
            - generic [ref=e326]:
              - strong [ref=e329]: $ 3.600
              - button "Agregar Corona Extra 330 ml al pedido" [ref=e331] [cursor=pointer]:
                - generic [ref=e332]: +
        - article [ref=e333]:
          - generic [ref=e334]:
            - button "Ver Sprite Sin azúcar" [ref=e335] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Sprite Sin azúcar" [ref=e336]'
            - button "Guardar Sprite Sin azúcar 600 ml de favoritos" [ref=e337] [cursor=pointer]:
              - img [ref=e338]
          - generic [ref=e340]:
            - heading "Sprite Sin azúcar" [level=3] [ref=e341]
            - paragraph [ref=e342]: 600 ml
            - generic [ref=e343]:
              - generic [ref=e344]:
                - strong [ref=e346]: Precio próximamente
                - generic [ref=e347]: Este producto todavía no está disponible para compra.
              - 'button "Sprite Sin azúcar 600 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e349]':
                - generic [ref=e350]: Precio pendiente
        - article [ref=e351]:
          - generic [ref=e352]:
            - button "Ver Fanta Naranja" [ref=e353] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fanta Naranja" [ref=e354]'
            - button "Guardar Fanta Naranja 2,25 L de favoritos" [ref=e355] [cursor=pointer]:
              - img [ref=e356]
          - generic [ref=e358]:
            - heading "Fanta Naranja" [level=3] [ref=e359]
            - paragraph [ref=e360]: 2,25 L
            - generic [ref=e361]:
              - generic [ref=e362]:
                - strong [ref=e364]: Precio próximamente
                - generic [ref=e365]: Este producto todavía no está disponible para compra.
              - 'button "Fanta Naranja 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e367]':
                - generic [ref=e368]: Precio pendiente
        - article [ref=e369]:
          - generic [ref=e370]:
            - button "Ver Pepsi Black" [ref=e371] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Pepsi Black" [ref=e372]'
            - button "Guardar Pepsi Black 1,5 L de favoritos" [ref=e373] [cursor=pointer]:
              - img [ref=e374]
          - generic [ref=e376]:
            - heading "Pepsi Black" [level=3] [ref=e377]
            - paragraph [ref=e378]: 1,5 L
            - generic [ref=e379]:
              - generic [ref=e380]:
                - strong [ref=e382]: Precio próximamente
                - generic [ref=e383]: Este producto todavía no está disponible para compra.
              - 'button "Pepsi Black 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e385]':
                - generic [ref=e386]: Precio pendiente
        - article [ref=e387]:
          - generic [ref=e388]:
            - button "Ver Schweppes Pomelo" [ref=e389] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Pomelo" [ref=e390]'
            - button "Guardar Schweppes Pomelo 2,25 L de favoritos" [ref=e391] [cursor=pointer]:
              - img [ref=e392]
          - generic [ref=e394]:
            - heading "Schweppes Pomelo" [level=3] [ref=e395]
            - paragraph [ref=e396]: 2,25 L
            - generic [ref=e397]:
              - generic [ref=e398]:
                - strong [ref=e400]: Precio próximamente
                - generic [ref=e401]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Pomelo 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e403]':
                - generic [ref=e404]: Precio pendiente
        - article [ref=e405]:
          - generic [ref=e406]:
            - button "Ver Schweppes Ginger Ale" [ref=e407] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Ginger Ale" [ref=e408]'
            - button "Guardar Schweppes Ginger Ale 310 ml de favoritos" [ref=e409] [cursor=pointer]:
              - img [ref=e410]
          - generic [ref=e412]:
            - heading "Schweppes Ginger Ale" [level=3] [ref=e413]
            - paragraph [ref=e414]: 310 ml
            - generic [ref=e415]:
              - generic [ref=e416]:
                - strong [ref=e418]: Precio próximamente
                - generic [ref=e419]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Ginger Ale 310 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e421]':
                - generic [ref=e422]: Precio pendiente
        - article [ref=e423]:
          - generic [ref=e424]:
            - button "Ver Paso de los Toros Pomelo" [ref=e425] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Paso de los Toros Pomelo" [ref=e426]'
            - button "Guardar Paso de los Toros Pomelo 1,5 L de favoritos" [ref=e427] [cursor=pointer]:
              - img [ref=e428]
          - generic [ref=e430]:
            - heading "Paso de los Toros Pomelo" [level=3] [ref=e431]
            - paragraph [ref=e432]: 1,5 L
            - generic [ref=e433]:
              - generic [ref=e434]:
                - strong [ref=e436]: Precio próximamente
                - generic [ref=e437]: Este producto todavía no está disponible para compra.
              - 'button "Paso de los Toros Pomelo 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e439]':
                - generic [ref=e440]: Precio pendiente
        - article [ref=e441]:
          - generic [ref=e442]:
            - button "Ver Paso de los Toros Tónica" [ref=e443] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Paso de los Toros Tónica" [ref=e444]'
            - button "Guardar Paso de los Toros Tónica 1,5 L de favoritos" [ref=e445] [cursor=pointer]:
              - img [ref=e446]
          - generic [ref=e448]:
            - heading "Paso de los Toros Tónica" [level=3] [ref=e449]
            - paragraph [ref=e450]: 1,5 L
            - generic [ref=e451]:
              - generic [ref=e452]:
                - strong [ref=e454]: Precio próximamente
                - generic [ref=e455]: Este producto todavía no está disponible para compra.
              - 'button "Paso de los Toros Tónica 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e457]':
                - generic [ref=e458]: Precio pendiente
        - article [ref=e459]:
          - generic [ref=e460]:
            - button "Ver Soda Ivess" [ref=e461] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Soda Ivess" [ref=e462]'
            - button "Guardar Soda Ivess 1,5 L de favoritos" [ref=e463] [cursor=pointer]:
              - img [ref=e464]
          - generic [ref=e466]:
            - generic [ref=e467]: Ivess
            - heading "Soda Ivess" [level=3] [ref=e468]
            - paragraph [ref=e469]: 1,5 L
            - generic [ref=e470]:
              - generic [ref=e471]:
                - strong [ref=e473]: Precio próximamente
                - generic [ref=e474]: Este producto todavía no está disponible para compra.
              - 'button "Soda Ivess 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e476]':
                - generic [ref=e477]: Precio pendiente
        - article [ref=e478]:
          - generic [ref=e479]:
            - button "Ver Britvic Ginger Beer" [ref=e480] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Britvic Ginger Beer" [ref=e481]'
            - button "Guardar Britvic Ginger Beer 200 ml de favoritos" [ref=e482] [cursor=pointer]:
              - img [ref=e483]
          - generic [ref=e485]:
            - heading "Britvic Ginger Beer" [level=3] [ref=e486]
            - paragraph [ref=e487]: 200 ml
            - generic [ref=e488]:
              - generic [ref=e489]:
                - strong [ref=e491]: Precio próximamente
                - generic [ref=e492]: Este producto todavía no está disponible para compra.
              - 'button "Britvic Ginger Beer 200 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e494]':
                - generic [ref=e495]: Precio pendiente
        - article [ref=e496]:
          - generic [ref=e497]:
            - button "Ver Villavicencio" [ref=e498] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Villavicencio" [ref=e499]'
            - button "Guardar Villavicencio 500 ml de favoritos" [ref=e500] [cursor=pointer]:
              - img [ref=e501]
          - generic [ref=e503]:
            - heading "Villavicencio" [level=3] [ref=e504]
            - paragraph [ref=e505]: 500 ml
            - generic [ref=e506]:
              - generic [ref=e507]:
                - strong [ref=e509]: Precio próximamente
                - generic [ref=e510]: Este producto todavía no está disponible para compra.
              - 'button "Villavicencio 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e512]':
                - generic [ref=e513]: Precio pendiente
        - article [ref=e514]:
          - generic [ref=e515]:
            - button "Ver Eco de los Andes" [ref=e516] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Eco de los Andes" [ref=e517]'
            - button "Guardar Eco de los Andes 2 L de favoritos" [ref=e518] [cursor=pointer]:
              - img [ref=e519]
          - generic [ref=e521]:
            - heading "Eco de los Andes" [level=3] [ref=e522]
            - paragraph [ref=e523]: 2 L
            - generic [ref=e524]:
              - generic [ref=e525]:
                - strong [ref=e527]: Precio próximamente
                - generic [ref=e528]: Este producto todavía no está disponible para compra.
              - 'button "Eco de los Andes 2 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e530]':
                - generic [ref=e531]: Precio pendiente
        - article [ref=e532]:
          - generic [ref=e533]:
            - button "Ver Glaciar Sin gas, baja en sodio" [ref=e534] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Glaciar Sin gas, baja en sodio" [ref=e535]'
            - button "Guardar Glaciar Sin gas, baja en sodio 1,5 L de favoritos" [ref=e536] [cursor=pointer]:
              - img [ref=e537]
          - generic [ref=e539]:
            - heading "Glaciar Sin gas, baja en sodio" [level=3] [ref=e540]
            - paragraph [ref=e541]: 1,5 L
            - generic [ref=e542]:
              - generic [ref=e543]:
                - strong [ref=e545]: Precio próximamente
                - generic [ref=e546]: Este producto todavía no está disponible para compra.
              - 'button "Glaciar Sin gas, baja en sodio 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e548]':
                - generic [ref=e549]: Precio pendiente
        - article [ref=e550]:
          - generic [ref=e551]:
            - button "Ver Glaciar Con gas, baja en sodio" [ref=e552] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Glaciar Con gas, baja en sodio" [ref=e553]'
            - button "Guardar Glaciar Con gas, baja en sodio 1,5 L de favoritos" [ref=e554] [cursor=pointer]:
              - img [ref=e555]
          - generic [ref=e557]:
            - heading "Glaciar Con gas, baja en sodio" [level=3] [ref=e558]
            - paragraph [ref=e559]: 1,5 L
            - generic [ref=e560]:
              - generic [ref=e561]:
                - strong [ref=e563]: Precio próximamente
                - generic [ref=e564]: Este producto todavía no está disponible para compra.
              - 'button "Glaciar Con gas, baja en sodio 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e566]':
                - generic [ref=e567]: Precio pendiente
        - article [ref=e568]:
          - generic [ref=e569]:
            - button "Ver H2OH!" [ref=e570] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: H2OH!" [ref=e571]'
            - button "Guardar H2OH! 1,5 L de favoritos" [ref=e572] [cursor=pointer]:
              - img [ref=e573]
          - generic [ref=e575]:
            - heading "H2OH!" [level=3] [ref=e576]
            - paragraph [ref=e577]: 1,5 L
            - generic [ref=e578]:
              - generic [ref=e579]:
                - strong [ref=e581]: Precio próximamente
                - generic [ref=e582]: Este producto todavía no está disponible para compra.
              - 'button "H2OH! 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e584]':
                - generic [ref=e585]: Precio pendiente
        - article [ref=e586]:
          - generic [ref=e587]:
            - button "Ver Red Bull Energy Drink" [ref=e588] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Red Bull Energy Drink" [ref=e589]'
            - button "Guardar Red Bull Energy Drink 355 ml de favoritos" [ref=e590] [cursor=pointer]:
              - img [ref=e591]
          - generic [ref=e593]:
            - heading "Red Bull Energy Drink" [level=3] [ref=e594]
            - paragraph [ref=e595]: 355 ml
            - generic [ref=e596]:
              - generic [ref=e597]:
                - strong [ref=e599]: Precio próximamente
                - generic [ref=e600]: Este producto todavía no está disponible para compra.
              - 'button "Red Bull Energy Drink 355 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e602]':
                - generic [ref=e603]: Precio pendiente
        - article [ref=e604]:
          - generic [ref=e605]:
            - button "Ver Monster Mango Loco" [ref=e606] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Monster Mango Loco" [ref=e607]'
            - button "Guardar Monster Mango Loco 473 ml de favoritos" [ref=e608] [cursor=pointer]:
              - img [ref=e609]
          - generic [ref=e611]:
            - heading "Monster Mango Loco" [level=3] [ref=e612]
            - paragraph [ref=e613]: 473 ml
            - generic [ref=e614]:
              - generic [ref=e615]:
                - strong [ref=e617]: Precio próximamente
                - generic [ref=e618]: Este producto todavía no está disponible para compra.
              - 'button "Monster Mango Loco 473 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e620]':
                - generic [ref=e621]: Precio pendiente
        - article [ref=e622]:
          - generic [ref=e623]:
            - button "Ver Speed Zero" [ref=e624] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Speed Zero" [ref=e625]'
            - button "Guardar Speed Zero 473 ml de favoritos" [ref=e626] [cursor=pointer]:
              - img [ref=e627]
          - generic [ref=e629]:
            - heading "Speed Zero" [level=3] [ref=e630]
            - paragraph [ref=e631]: 473 ml
            - generic [ref=e632]:
              - generic [ref=e633]:
                - strong [ref=e635]: Precio próximamente
                - generic [ref=e636]: Este producto todavía no está disponible para compra.
              - 'button "Speed Zero 473 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e638]':
                - generic [ref=e639]: Precio pendiente
        - article [ref=e640]:
          - generic [ref=e641]:
            - button "Ver Gatorade Zero" [ref=e642] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Gatorade Zero" [ref=e643]'
            - button "Guardar Gatorade Zero 400 ml de favoritos" [ref=e644] [cursor=pointer]:
              - img [ref=e645]
          - generic [ref=e647]:
            - heading "Gatorade Zero" [level=3] [ref=e648]
            - paragraph [ref=e649]: 400 ml
            - generic [ref=e650]:
              - generic [ref=e651]:
                - strong [ref=e653]: Precio próximamente
                - generic [ref=e654]: Este producto todavía no está disponible para compra.
              - 'button "Gatorade Zero 400 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e656]':
                - generic [ref=e657]: Precio pendiente
        - article [ref=e658]:
          - generic [ref=e659]:
            - button "Ver Powerade" [ref=e660] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Powerade" [ref=e661]'
            - button "Guardar Powerade 995 ml de favoritos" [ref=e662] [cursor=pointer]:
              - img [ref=e663]
          - generic [ref=e665]:
            - heading "Powerade" [level=3] [ref=e666]
            - paragraph [ref=e667]: 995 ml
            - generic [ref=e668]:
              - generic [ref=e669]:
                - strong [ref=e671]: Precio próximamente
                - generic [ref=e672]: Este producto todavía no está disponible para compra.
              - 'button "Powerade 995 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e674]':
                - generic [ref=e675]: Precio pendiente
        - article [ref=e676]:
          - generic [ref=e677]:
            - button "Ver Buhero Negro" [ref=e678] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Buhero Negro" [ref=e679]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Buhero Negro 450 ml de favoritos" [ref=e680] [cursor=pointer]:
              - img [ref=e681]
          - generic [ref=e683]:
            - heading "Buhero Negro" [level=3] [ref=e684]
            - paragraph [ref=e685]: 450 ml
            - generic [ref=e686]:
              - generic [ref=e687]:
                - strong [ref=e689]: Precio próximamente
                - generic [ref=e690]: Este producto todavía no está disponible para compra.
              - 'button "Buhero Negro 450 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e692]':
                - generic [ref=e693]: Precio pendiente
        - article [ref=e694]:
          - generic [ref=e695]:
            - button "Ver Cinzano Rosso" [ref=e696] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Cinzano Rosso" [ref=e697]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Cinzano Rosso 950 ml de favoritos" [ref=e698] [cursor=pointer]:
              - img [ref=e699]
          - generic [ref=e701]:
            - heading "Cinzano Rosso" [level=3] [ref=e702]
            - paragraph [ref=e703]: 950 ml
            - generic [ref=e704]:
              - generic [ref=e705]:
                - strong [ref=e707]: Precio próximamente
                - generic [ref=e708]: Este producto todavía no está disponible para compra.
              - 'button "Cinzano Rosso 950 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e710]':
                - generic [ref=e711]: Precio pendiente
        - article [ref=e712]:
          - generic [ref=e713]:
            - button "Ver Campari Bitter" [ref=e714] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Campari Bitter" [ref=e715]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Campari Bitter 750 ml de favoritos" [ref=e716] [cursor=pointer]:
              - img [ref=e717]
          - generic [ref=e719]:
            - heading "Campari Bitter" [level=3] [ref=e720]
            - paragraph [ref=e721]: 750 ml
            - generic [ref=e722]:
              - generic [ref=e723]:
                - strong [ref=e725]: Precio próximamente
                - generic [ref=e726]: Este producto todavía no está disponible para compra.
              - 'button "Campari Bitter 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e728]':
                - generic [ref=e729]: Precio pendiente
        - article [ref=e730]:
          - generic [ref=e731]:
            - button "Ver Aperol" [ref=e732] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Aperol" [ref=e733]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Aperol 750 ml de favoritos" [ref=e734] [cursor=pointer]:
              - img [ref=e735]
          - generic [ref=e737]:
            - heading "Aperol" [level=3] [ref=e738]
            - paragraph [ref=e739]: 750 ml
            - generic [ref=e740]:
              - generic [ref=e741]:
                - strong [ref=e743]: Precio próximamente
                - generic [ref=e744]: Este producto todavía no está disponible para compra.
              - 'button "Aperol 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e746]':
                - generic [ref=e747]: Precio pendiente
        - article [ref=e748]:
          - generic [ref=e749]:
            - button "Ver Quilmes Clásica" [ref=e750] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Quilmes Clásica" [ref=e751]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Quilmes Clásica 710 ml de favoritos" [ref=e752] [cursor=pointer]:
              - img [ref=e753]
          - generic [ref=e755]:
            - heading "Quilmes Clásica" [level=3] [ref=e756]
            - paragraph [ref=e757]: 710 ml
            - generic [ref=e758]:
              - generic [ref=e759]:
                - strong [ref=e761]: Precio próximamente
                - generic [ref=e762]: Este producto todavía no está disponible para compra.
              - 'button "Quilmes Clásica 710 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e764]':
                - generic [ref=e765]: Precio pendiente
        - article [ref=e766]:
          - generic [ref=e767]:
            - button "Ver Patagonia Lager del Sur" [ref=e768] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Patagonia Lager del Sur" [ref=e769]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Patagonia Lager del Sur 730 ml de favoritos" [ref=e770] [cursor=pointer]:
              - img [ref=e771]
          - generic [ref=e773]:
            - heading "Patagonia Lager del Sur" [level=3] [ref=e774]
            - paragraph [ref=e775]: 730 ml
            - generic [ref=e776]:
              - generic [ref=e777]:
                - strong [ref=e779]: Precio próximamente
                - generic [ref=e780]: Este producto todavía no está disponible para compra.
              - 'button "Patagonia Lager del Sur 730 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e782]':
                - generic [ref=e783]: Precio pendiente
        - article [ref=e784]:
          - generic [ref=e785]:
            - button "Ver Heineken" [ref=e786] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Heineken" [ref=e787]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Heineken 710 ml de favoritos" [ref=e788] [cursor=pointer]:
              - img [ref=e789]
          - generic [ref=e791]:
            - heading "Heineken" [level=3] [ref=e792]
            - paragraph [ref=e793]: 710 ml
            - generic [ref=e794]:
              - generic [ref=e795]:
                - strong [ref=e797]: Precio próximamente
                - generic [ref=e798]: Este producto todavía no está disponible para compra.
              - 'button "Heineken 710 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e800]':
                - generic [ref=e801]: Precio pendiente
        - article [ref=e802]:
          - generic [ref=e803]:
            - button "Ver Stella Artois" [ref=e804] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Stella Artois" [ref=e805]'
            - button "Guardar Stella Artois 330 ml de favoritos" [ref=e806] [cursor=pointer]:
              - img [ref=e807]
          - generic [ref=e809]:
            - heading "Stella Artois" [level=3] [ref=e810]
            - paragraph [ref=e811]: 330 ml
            - generic [ref=e812]:
              - generic [ref=e813]:
                - strong [ref=e815]: Precio próximamente
                - generic [ref=e816]: Este producto todavía no está disponible para compra.
              - 'button "Stella Artois 330 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e818]':
                - generic [ref=e819]: Precio pendiente
        - article [ref=e820]:
          - generic [ref=e821]:
            - button "Ver Corona Extra" [ref=e822] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Corona Extra" [ref=e823]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Corona Extra 330 ml de favoritos" [ref=e824] [cursor=pointer]:
              - img [ref=e825]
          - generic [ref=e827]:
            - heading "Corona Extra" [level=3] [ref=e828]
            - paragraph [ref=e829]: 330 ml
            - generic [ref=e830]:
              - generic [ref=e831]:
                - strong [ref=e833]: Precio próximamente
                - generic [ref=e834]: Este producto todavía no está disponible para compra.
              - 'button "Corona Extra 330 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e836]':
                - generic [ref=e837]: Precio pendiente
        - article [ref=e838]:
          - generic [ref=e839]:
            - button "Ver Imperial Golden" [ref=e840] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Imperial Golden" [ref=e841]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Imperial Golden 473 ml de favoritos" [ref=e842] [cursor=pointer]:
              - img [ref=e843]
          - generic [ref=e845]:
            - heading "Imperial Golden" [level=3] [ref=e846]
            - paragraph [ref=e847]: 473 ml
            - generic [ref=e848]:
              - generic [ref=e849]:
                - strong [ref=e851]: Precio próximamente
                - generic [ref=e852]: Este producto todavía no está disponible para compra.
              - 'button "Imperial Golden 473 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e854]':
                - generic [ref=e855]: Precio pendiente
        - article [ref=e856]:
          - generic [ref=e857]:
            - button "Ver Brahma Chopp" [ref=e858] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Brahma Chopp" [ref=e859]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Brahma Chopp 1 L de favoritos" [ref=e860] [cursor=pointer]:
              - img [ref=e861]
          - generic [ref=e863]:
            - heading "Brahma Chopp" [level=3] [ref=e864]
            - paragraph [ref=e865]: 1 L
            - generic [ref=e866]:
              - generic [ref=e867]:
                - strong [ref=e869]: Precio próximamente
                - generic [ref=e870]: Este producto todavía no está disponible para compra.
              - 'button "Brahma Chopp 1 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e872]':
                - generic [ref=e873]: Precio pendiente
        - article [ref=e874]:
          - generic [ref=e875]:
            - button "Ver Amstel Lager" [ref=e876] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Amstel Lager" [ref=e877]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Amstel Lager 473 ml de favoritos" [ref=e878] [cursor=pointer]:
              - img [ref=e879]
          - generic [ref=e881]:
            - heading "Amstel Lager" [level=3] [ref=e882]
            - paragraph [ref=e883]: 473 ml
            - generic [ref=e884]:
              - generic [ref=e885]:
                - strong [ref=e887]: Precio próximamente
                - generic [ref=e888]: Este producto todavía no está disponible para compra.
              - 'button "Amstel Lager 473 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e890]':
                - generic [ref=e891]: Precio pendiente
        - article [ref=e892]:
          - generic [ref=e893]:
            - button "Ver Rutini Malbec" [ref=e894] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Rutini Malbec" [ref=e895]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Rutini Malbec 750 ml de favoritos" [ref=e896] [cursor=pointer]:
              - img [ref=e897]
          - generic [ref=e899]:
            - heading "Rutini Malbec" [level=3] [ref=e900]
            - paragraph [ref=e901]: 750 ml
            - generic [ref=e902]:
              - generic [ref=e903]:
                - strong [ref=e905]: Precio próximamente
                - generic [ref=e906]: Este producto todavía no está disponible para compra.
              - 'button "Rutini Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e908]':
                - generic [ref=e909]: Precio pendiente
        - article [ref=e910]:
          - generic [ref=e911]:
            - button "Ver Trapiche Reserva Malbec" [ref=e912] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Trapiche Reserva Malbec" [ref=e913]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Trapiche Reserva Malbec 750 ml de favoritos" [ref=e914] [cursor=pointer]:
              - img [ref=e915]
          - generic [ref=e917]:
            - heading "Trapiche Reserva Malbec" [level=3] [ref=e918]
            - paragraph [ref=e919]: 750 ml
            - generic [ref=e920]:
              - generic [ref=e921]:
                - strong [ref=e923]: Precio próximamente
                - generic [ref=e924]: Este producto todavía no está disponible para compra.
              - 'button "Trapiche Reserva Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e926]':
                - generic [ref=e927]: Precio pendiente
        - article [ref=e928]:
          - generic [ref=e929]:
            - button "Ver Fin del Mundo" [ref=e930] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fin del Mundo" [ref=e931]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Fin del Mundo 750 ml de favoritos" [ref=e932] [cursor=pointer]:
              - img [ref=e933]
          - generic [ref=e935]:
            - heading "Fin del Mundo" [level=3] [ref=e936]
            - paragraph [ref=e937]: 750 ml
            - generic [ref=e938]:
              - generic [ref=e939]:
                - strong [ref=e941]: Precio próximamente
                - generic [ref=e942]: Este producto todavía no está disponible para compra.
              - 'button "Fin del Mundo 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e944]':
                - generic [ref=e945]: Precio pendiente
        - article [ref=e946]:
          - generic [ref=e947]:
            - button "Ver Chandon Délice" [ref=e948] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Chandon Délice" [ref=e949]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Chandon Délice 750 ml de favoritos" [ref=e950] [cursor=pointer]:
              - img [ref=e951]
          - generic [ref=e953]:
            - heading "Chandon Délice" [level=3] [ref=e954]
            - paragraph [ref=e955]: 750 ml
            - generic [ref=e956]:
              - generic [ref=e957]:
                - strong [ref=e959]: Precio próximamente
                - generic [ref=e960]: Este producto todavía no está disponible para compra.
              - 'button "Chandon Délice 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e962]':
                - generic [ref=e963]: Precio pendiente
        - article [ref=e964]:
          - generic [ref=e965]:
            - button "Ver Tanqueray Dry" [ref=e966] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Tanqueray Dry" [ref=e967]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Tanqueray Dry 700 ml de favoritos" [ref=e968] [cursor=pointer]:
              - img [ref=e969]
          - generic [ref=e971]:
            - heading "Tanqueray Dry" [level=3] [ref=e972]
            - paragraph [ref=e973]: 700 ml
            - generic [ref=e974]:
              - generic [ref=e975]:
                - strong [ref=e977]: Precio próximamente
                - generic [ref=e978]: Este producto todavía no está disponible para compra.
              - 'button "Tanqueray Dry 700 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e980]':
                - generic [ref=e981]: Precio pendiente
        - article [ref=e982]:
          - generic [ref=e983]:
            - button "Ver Bombay Sapphire" [ref=e984] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Bombay Sapphire" [ref=e985]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Bombay Sapphire 750 ml de favoritos" [ref=e986] [cursor=pointer]:
              - img [ref=e987]
          - generic [ref=e989]:
            - heading "Bombay Sapphire" [level=3] [ref=e990]
            - paragraph [ref=e991]: 750 ml
            - generic [ref=e992]:
              - generic [ref=e993]:
                - strong [ref=e995]: Precio próximamente
                - generic [ref=e996]: Este producto todavía no está disponible para compra.
              - 'button "Bombay Sapphire 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e998]':
                - generic [ref=e999]: Precio pendiente
        - article [ref=e1000]:
          - generic [ref=e1001]:
            - button "Ver Bosque Nativo" [ref=e1002] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Bosque Nativo" [ref=e1003]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Bosque Nativo 500 ml de favoritos" [ref=e1004] [cursor=pointer]:
              - img [ref=e1005]
          - generic [ref=e1007]:
            - heading "Bosque Nativo" [level=3] [ref=e1008]
            - paragraph [ref=e1009]: 500 ml
            - generic [ref=e1010]:
              - generic [ref=e1011]:
                - strong [ref=e1013]: Precio próximamente
                - generic [ref=e1014]: Este producto todavía no está disponible para compra.
              - 'button "Bosque Nativo 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1016]':
                - generic [ref=e1017]: Precio pendiente
        - article [ref=e1018]:
          - generic [ref=e1019]:
            - button "Ver Johnnie Walker Red Label" [ref=e1020] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Johnnie Walker Red Label" [ref=e1021]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Johnnie Walker Red Label 750 ml de favoritos" [ref=e1022] [cursor=pointer]:
              - img [ref=e1023]
          - generic [ref=e1025]:
            - heading "Johnnie Walker Red Label" [level=3] [ref=e1026]
            - paragraph [ref=e1027]: 750 ml
            - generic [ref=e1028]:
              - generic [ref=e1029]:
                - strong [ref=e1031]: Precio próximamente
                - generic [ref=e1032]: Este producto todavía no está disponible para compra.
              - 'button "Johnnie Walker Red Label 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1034]':
                - generic [ref=e1035]: Precio pendiente
        - article [ref=e1036]:
          - generic [ref=e1037]:
            - button "Ver Hielo Cristal" [ref=e1038] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Hielo Cristal" [ref=e1039]'
            - button "Guardar Hielo Cristal 4000 g de favoritos" [ref=e1040] [cursor=pointer]:
              - img [ref=e1041]
          - generic [ref=e1043]:
            - generic [ref=e1044]: Cristal
            - heading "Hielo Cristal" [level=3] [ref=e1045]
            - paragraph [ref=e1046]: 4000 g
            - generic [ref=e1047]:
              - generic [ref=e1048]:
                - strong [ref=e1050]: Precio próximamente
                - generic [ref=e1051]: Este producto todavía no está disponible para compra.
              - 'button "Hielo Cristal 4000 g: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1053]':
                - generic [ref=e1054]: Precio pendiente
        - article [ref=e1055]:
          - generic [ref=e1056]:
            - button "Ver Coca-Cola Sabor Original" [ref=e1057] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Sabor Original" [ref=e1058]'
            - button "Guardar Coca-Cola Sabor 2,25 L de favoritos" [ref=e1059] [cursor=pointer]:
              - img [ref=e1060]
          - generic [ref=e1062]:
            - heading "Coca-Cola Sabor" [level=3] [ref=e1063]
            - paragraph [ref=e1064]: 2,25 L
            - generic [ref=e1065]:
              - generic [ref=e1066]:
                - strong [ref=e1068]: Precio próximamente
                - generic [ref=e1069]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola Sabor 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1071]':
                - generic [ref=e1072]: Precio pendiente
        - article [ref=e1073]:
          - generic [ref=e1074]:
            - button "Ver Coca-Cola Sin Azúcar" [ref=e1075] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Sin Azúcar" [ref=e1076]'
            - button "Guardar Coca-Cola Sin Azúcar 2,25 L de favoritos" [ref=e1077] [cursor=pointer]:
              - img [ref=e1078]
          - generic [ref=e1080]:
            - heading "Coca-Cola Sin Azúcar" [level=3] [ref=e1081]
            - paragraph [ref=e1082]: 2,25 L
            - generic [ref=e1083]:
              - generic [ref=e1084]:
                - strong [ref=e1086]: Precio próximamente
                - generic [ref=e1087]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola Sin Azúcar 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1089]':
                - generic [ref=e1090]: Precio pendiente
        - article [ref=e1091]:
          - generic [ref=e1092]:
            - button "Ver Sprite Sin azúcar" [ref=e1093] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Sprite Sin azúcar" [ref=e1094]'
            - button "Guardar Sprite Sin azúcar 2,25 L de favoritos" [ref=e1095] [cursor=pointer]:
              - img [ref=e1096]
          - generic [ref=e1098]:
            - heading "Sprite Sin azúcar" [level=3] [ref=e1099]
            - paragraph [ref=e1100]: 2,25 L
            - generic [ref=e1101]:
              - generic [ref=e1102]:
                - strong [ref=e1104]: Precio próximamente
                - generic [ref=e1105]: Este producto todavía no está disponible para compra.
              - 'button "Sprite Sin azúcar 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1107]':
                - generic [ref=e1108]: Precio pendiente
        - article [ref=e1109]:
          - generic [ref=e1110]:
            - button "Ver 7UP" [ref=e1111] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: 7UP" [ref=e1112]'
            - button "Guardar 7UP 2 L de favoritos" [ref=e1113] [cursor=pointer]:
              - img [ref=e1114]
          - generic [ref=e1116]:
            - heading "7UP" [level=3] [ref=e1117]
            - paragraph [ref=e1118]: 2 L
            - generic [ref=e1119]:
              - generic [ref=e1120]:
                - strong [ref=e1122]: Precio próximamente
                - generic [ref=e1123]: Este producto todavía no está disponible para compra.
              - 'button "7UP 2 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1125]':
                - generic [ref=e1126]: Precio pendiente
        - article [ref=e1127]:
          - generic [ref=e1128]:
            - button "Ver Bonaqua" [ref=e1129] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Bonaqua" [ref=e1130]'
            - button "Guardar Bonaqua 2,25 L de favoritos" [ref=e1131] [cursor=pointer]:
              - img [ref=e1132]
          - generic [ref=e1134]:
            - heading "Bonaqua" [level=3] [ref=e1135]
            - paragraph [ref=e1136]: 2,25 L
            - generic [ref=e1137]:
              - generic [ref=e1138]:
                - strong [ref=e1140]: Precio próximamente
                - generic [ref=e1141]: Este producto todavía no está disponible para compra.
              - 'button "Bonaqua 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1143]':
                - generic [ref=e1144]: Precio pendiente
        - article [ref=e1145]:
          - generic [ref=e1146]:
            - button "Ver Manaos Lima limón" [ref=e1147] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Manaos Lima limón" [ref=e1148]'
            - button "Guardar Manaos Lima limón 2,25 L de favoritos" [ref=e1149] [cursor=pointer]:
              - img [ref=e1150]
          - generic [ref=e1152]:
            - heading "Manaos Lima limón" [level=3] [ref=e1153]
            - paragraph [ref=e1154]: 2,25 L
            - generic [ref=e1155]:
              - generic [ref=e1156]:
                - strong [ref=e1158]: Precio próximamente
                - generic [ref=e1159]: Este producto todavía no está disponible para compra.
              - 'button "Manaos Lima limón 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1161]':
                - generic [ref=e1162]: Precio pendiente
        - article [ref=e1163]:
          - generic [ref=e1164]:
            - button "Ver Manaos Naranja" [ref=e1165] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Manaos Naranja" [ref=e1166]'
            - button "Guardar Manaos Naranja 2,25 L de favoritos" [ref=e1167] [cursor=pointer]:
              - img [ref=e1168]
          - generic [ref=e1170]:
            - heading "Manaos Naranja" [level=3] [ref=e1171]
            - paragraph [ref=e1172]: 2,25 L
            - generic [ref=e1173]:
              - generic [ref=e1174]:
                - strong [ref=e1176]: Precio próximamente
                - generic [ref=e1177]: Este producto todavía no está disponible para compra.
              - 'button "Manaos Naranja 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1179]':
                - generic [ref=e1180]: Precio pendiente
        - article [ref=e1181]:
          - generic [ref=e1182]:
            - button "Ver Pepsi Black" [ref=e1183] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Pepsi Black" [ref=e1184]'
            - button "Guardar Pepsi Black 2,25 L de favoritos" [ref=e1185] [cursor=pointer]:
              - img [ref=e1186]
          - generic [ref=e1188]:
            - heading "Pepsi Black" [level=3] [ref=e1189]
            - paragraph [ref=e1190]: 2,25 L
            - generic [ref=e1191]:
              - generic [ref=e1192]:
                - strong [ref=e1194]: Precio próximamente
                - generic [ref=e1195]: Este producto todavía no está disponible para compra.
              - 'button "Pepsi Black 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1197]':
                - generic [ref=e1198]: Precio pendiente
        - article [ref=e1199]:
          - generic [ref=e1200]:
            - button "Ver Schweppes Tónica" [ref=e1201] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Tónica" [ref=e1202]'
            - button "Guardar Schweppes Tónica 354 ml · Lata de favoritos" [ref=e1203] [cursor=pointer]:
              - img [ref=e1204]
          - generic [ref=e1206]:
            - heading "Schweppes Tónica" [level=3] [ref=e1207]
            - paragraph [ref=e1208]: 354 ml · Lata
            - generic [ref=e1209]:
              - generic [ref=e1210]:
                - strong [ref=e1212]: Precio próximamente
                - generic [ref=e1213]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Tónica 354 ml · Lata: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1215]':
                - generic [ref=e1216]: Precio pendiente
        - article [ref=e1217]:
          - generic [ref=e1218]:
            - button "Ver Levité" [ref=e1219] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Levité" [ref=e1220]'
            - button "Guardar Levité 2,25 L de favoritos" [ref=e1221] [cursor=pointer]:
              - img [ref=e1222]
          - generic [ref=e1224]:
            - heading "Levité" [level=3] [ref=e1225]
            - paragraph [ref=e1226]: 2,25 L
            - generic [ref=e1227]:
              - generic [ref=e1228]:
                - strong [ref=e1230]: Precio próximamente
                - generic [ref=e1231]: Este producto todavía no está disponible para compra.
              - 'button "Levité 2,25 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1233]':
                - generic [ref=e1234]: Precio pendiente
        - article [ref=e1235]:
          - generic [ref=e1236]:
            - button "Ver Gancia" [ref=e1237] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Gancia" [ref=e1238]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Gancia 950 ml de favoritos" [ref=e1239] [cursor=pointer]:
              - img [ref=e1240]
          - generic [ref=e1242]:
            - heading "Gancia" [level=3] [ref=e1243]
            - paragraph [ref=e1244]: 950 ml
            - generic [ref=e1245]:
              - generic [ref=e1246]:
                - strong [ref=e1248]: Precio próximamente
                - generic [ref=e1249]: Este producto todavía no está disponible para compra.
              - 'button "Gancia 950 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1251]':
                - generic [ref=e1252]: Precio pendiente
        - article [ref=e1253]:
          - generic [ref=e1254]:
            - button "Ver Martini Bianco" [ref=e1255] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Martini Bianco" [ref=e1256]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Martini Bianco 1 L de favoritos" [ref=e1257] [cursor=pointer]:
              - img [ref=e1258]
          - generic [ref=e1260]:
            - heading "Martini Bianco" [level=3] [ref=e1261]
            - paragraph [ref=e1262]: 1 L
            - generic [ref=e1263]:
              - generic [ref=e1264]:
                - strong [ref=e1266]: Precio próximamente
                - generic [ref=e1267]: Este producto todavía no está disponible para compra.
              - 'button "Martini Bianco 1 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1269]':
                - generic [ref=e1270]: Precio pendiente
        - article [ref=e1271]:
          - generic [ref=e1272]:
            - button "Ver Monster Ultra" [ref=e1273] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Monster Ultra" [ref=e1274]'
            - button "Guardar Monster Ultra 473 ml · Lata de favoritos" [ref=e1275] [cursor=pointer]:
              - img [ref=e1276]
          - generic [ref=e1278]:
            - heading "Monster Ultra" [level=3] [ref=e1279]
            - paragraph [ref=e1280]: 473 ml · Lata
            - generic [ref=e1281]:
              - generic [ref=e1282]:
                - strong [ref=e1284]: Precio próximamente
                - generic [ref=e1285]: Este producto todavía no está disponible para compra.
              - 'button "Monster Ultra 473 ml · Lata: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1287]':
                - generic [ref=e1288]: Precio pendiente
        - article [ref=e1289]:
          - generic [ref=e1290]:
            - button "Ver Fernet Branca Edición Mundial" [ref=e1291] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fernet Branca Edición Mundial" [ref=e1292]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Fernet Branca Edición Mundial 750 ml de favoritos" [ref=e1293] [cursor=pointer]:
              - img [ref=e1294]
          - generic [ref=e1296]:
            - heading "Fernet Branca Edición Mundial" [level=3] [ref=e1297]
            - paragraph [ref=e1298]: 750 ml
            - generic [ref=e1299]:
              - generic [ref=e1300]:
                - strong [ref=e1302]: Precio próximamente
                - generic [ref=e1303]: Este producto todavía no está disponible para compra.
              - 'button "Fernet Branca Edición Mundial 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1305]':
                - generic [ref=e1306]: Precio pendiente
        - article [ref=e1307]:
          - generic [ref=e1308]:
            - button "Ver Fernet Vittone" [ref=e1309] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fernet Vittone" [ref=e1310]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Fernet Vittone 1 L de favoritos" [ref=e1311] [cursor=pointer]:
              - img [ref=e1312]
          - generic [ref=e1314]:
            - generic [ref=e1315]: Vittone
            - heading "Fernet Vittone" [level=3] [ref=e1316]
            - paragraph [ref=e1317]: 1 L
            - generic [ref=e1318]:
              - generic [ref=e1319]:
                - strong [ref=e1321]: Precio próximamente
                - generic [ref=e1322]: Este producto todavía no está disponible para compra.
              - 'button "Fernet Vittone 1 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1324]':
                - generic [ref=e1325]: Precio pendiente
        - article [ref=e1326]:
          - generic [ref=e1327]:
            - button "Ver Budweiser" [ref=e1328] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Budweiser" [ref=e1329]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Budweiser 473 ml · Lata de favoritos" [ref=e1330] [cursor=pointer]:
              - img [ref=e1331]
          - generic [ref=e1333]:
            - heading "Budweiser" [level=3] [ref=e1334]
            - paragraph [ref=e1335]: 473 ml · Lata
            - generic [ref=e1336]:
              - generic [ref=e1337]:
                - strong [ref=e1339]: Precio próximamente
                - generic [ref=e1340]: Este producto todavía no está disponible para compra.
              - 'button "Budweiser 473 ml · Lata: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1342]':
                - generic [ref=e1343]: Precio pendiente
        - article [ref=e1344]:
          - generic [ref=e1345]:
            - button "Ver Alamos Malbec" [ref=e1346] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Alamos Malbec" [ref=e1347]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Alamos Malbec 750 ml de favoritos" [ref=e1348] [cursor=pointer]:
              - img [ref=e1349]
          - generic [ref=e1351]:
            - heading "Alamos Malbec" [level=3] [ref=e1352]
            - paragraph [ref=e1353]: 750 ml
            - generic [ref=e1354]:
              - generic [ref=e1355]:
                - strong [ref=e1357]: Precio próximamente
                - generic [ref=e1358]: Este producto todavía no está disponible para compra.
              - 'button "Alamos Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1360]':
                - generic [ref=e1361]: Precio pendiente
        - article [ref=e1362]:
          - generic [ref=e1363]:
            - button "Ver Norton Malbec" [ref=e1364] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Norton Malbec" [ref=e1365]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Norton Malbec 750 ml de favoritos" [ref=e1366] [cursor=pointer]:
              - img [ref=e1367]
          - generic [ref=e1369]:
            - heading "Norton Malbec" [level=3] [ref=e1370]
            - paragraph [ref=e1371]: 750 ml
            - generic [ref=e1372]:
              - generic [ref=e1373]:
                - strong [ref=e1375]: Precio próximamente
                - generic [ref=e1376]: Este producto todavía no está disponible para compra.
              - 'button "Norton Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1378]':
                - generic [ref=e1379]: Precio pendiente
        - article [ref=e1380]:
          - generic [ref=e1381]:
            - button "Ver Rutini" [ref=e1382] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Rutini" [ref=e1383]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Rutini 750 ml de favoritos" [ref=e1384] [cursor=pointer]:
              - img [ref=e1385]
          - generic [ref=e1387]:
            - heading "Rutini" [level=3] [ref=e1388]
            - paragraph [ref=e1389]: 750 ml
            - generic [ref=e1390]:
              - generic [ref=e1391]:
                - strong [ref=e1393]: Precio próximamente
                - generic [ref=e1394]: Este producto todavía no está disponible para compra.
              - 'button "Rutini 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1396]':
                - generic [ref=e1397]: Precio pendiente
        - article [ref=e1398]:
          - generic [ref=e1399]:
            - button "Ver Trumpeter Malbec" [ref=e1400] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Trumpeter Malbec" [ref=e1401]'
            - generic:
              - generic: "+18"
              - generic: Venta exclusiva a mayores de 18 años
            - button "Guardar Trumpeter Malbec 750 ml de favoritos" [ref=e1402] [cursor=pointer]:
              - img [ref=e1403]
          - generic [ref=e1405]:
            - heading "Trumpeter Malbec" [level=3] [ref=e1406]
            - paragraph [ref=e1407]: 750 ml
            - generic [ref=e1408]:
              - generic [ref=e1409]:
                - strong [ref=e1411]: Precio próximamente
                - generic [ref=e1412]: Este producto todavía no está disponible para compra.
              - 'button "Trumpeter Malbec 750 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1414]':
                - generic [ref=e1415]: Precio pendiente
        - article [ref=e1416]:
          - generic [ref=e1417]:
            - button "Ver Coca-Cola Original" [ref=e1418] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Original" [ref=e1419]'
            - button "Guardar Coca-Cola 500 ml de favoritos" [ref=e1420] [cursor=pointer]:
              - img [ref=e1421]
          - generic [ref=e1423]:
            - heading "Coca-Cola" [level=3] [ref=e1424]
            - paragraph [ref=e1425]: 500 ml
            - generic [ref=e1426]:
              - generic [ref=e1427]:
                - strong [ref=e1429]: Precio próximamente
                - generic [ref=e1430]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1432]':
                - generic [ref=e1433]: Precio pendiente
        - article [ref=e1434]:
          - generic [ref=e1435]:
            - button "Ver Coca-Cola Zero" [ref=e1436] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Zero" [ref=e1437]'
            - button "Guardar Coca-Cola Zero 500 ml de favoritos" [ref=e1438] [cursor=pointer]:
              - img [ref=e1439]
          - generic [ref=e1441]:
            - heading "Coca-Cola Zero" [level=3] [ref=e1442]
            - paragraph [ref=e1443]: 500 ml
            - generic [ref=e1444]:
              - generic [ref=e1445]:
                - strong [ref=e1447]: Precio próximamente
                - generic [ref=e1448]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola Zero 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1450]':
                - generic [ref=e1451]: Precio pendiente
        - article [ref=e1452]:
          - generic [ref=e1453]:
            - button "Ver Sprite Original" [ref=e1454] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Sprite Original" [ref=e1455]'
            - button "Guardar Sprite 500 ml de favoritos" [ref=e1456] [cursor=pointer]:
              - img [ref=e1457]
          - generic [ref=e1459]:
            - heading "Sprite" [level=3] [ref=e1460]
            - paragraph [ref=e1461]: 500 ml
            - generic [ref=e1462]:
              - generic [ref=e1463]:
                - strong [ref=e1465]: Precio próximamente
                - generic [ref=e1466]: Este producto todavía no está disponible para compra.
              - 'button "Sprite 500 ml: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1468]':
                - generic [ref=e1469]: Precio pendiente
        - article [ref=e1470]:
          - generic [ref=e1471]:
            - button "Ver Coca-Cola Original" [ref=e1472] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Original" [ref=e1473]'
            - button "Guardar Coca-Cola 1,5 L de favoritos" [ref=e1474] [cursor=pointer]:
              - img [ref=e1475]
          - generic [ref=e1477]:
            - heading "Coca-Cola" [level=3] [ref=e1478]
            - paragraph [ref=e1479]: 1,5 L
            - generic [ref=e1480]:
              - generic [ref=e1481]:
                - strong [ref=e1483]: Precio próximamente
                - generic [ref=e1484]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1486]':
                - generic [ref=e1487]: Precio pendiente
        - article [ref=e1488]:
          - generic [ref=e1489]:
            - button "Ver Coca-Cola Zero" [ref=e1490] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Coca-Cola Zero" [ref=e1491]'
            - button "Guardar Coca-Cola Zero 1,5 L de favoritos" [ref=e1492] [cursor=pointer]:
              - img [ref=e1493]
          - generic [ref=e1495]:
            - heading "Coca-Cola Zero" [level=3] [ref=e1496]
            - paragraph [ref=e1497]: 1,5 L
            - generic [ref=e1498]:
              - generic [ref=e1499]:
                - strong [ref=e1501]: Precio próximamente
                - generic [ref=e1502]: Este producto todavía no está disponible para compra.
              - 'button "Coca-Cola Zero 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1504]':
                - generic [ref=e1505]: Precio pendiente
        - article [ref=e1506]:
          - generic [ref=e1507]:
            - button "Ver Sprite Original" [ref=e1508] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Sprite Original" [ref=e1509]'
            - button "Guardar Sprite 1,5 L de favoritos" [ref=e1510] [cursor=pointer]:
              - img [ref=e1511]
          - generic [ref=e1513]:
            - heading "Sprite" [level=3] [ref=e1514]
            - paragraph [ref=e1515]: 1,5 L
            - generic [ref=e1516]:
              - generic [ref=e1517]:
                - strong [ref=e1519]: Precio próximamente
                - generic [ref=e1520]: Este producto todavía no está disponible para compra.
              - 'button "Sprite 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1522]':
                - generic [ref=e1523]: Precio pendiente
        - article [ref=e1524]:
          - generic [ref=e1525]:
            - button "Ver Fanta Naranja" [ref=e1526] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Fanta Naranja" [ref=e1527]'
            - button "Guardar Fanta Naranja 1,5 L de favoritos" [ref=e1528] [cursor=pointer]:
              - img [ref=e1529]
          - generic [ref=e1531]:
            - heading "Fanta Naranja" [level=3] [ref=e1532]
            - paragraph [ref=e1533]: 1,5 L
            - generic [ref=e1534]:
              - generic [ref=e1535]:
                - strong [ref=e1537]: Precio próximamente
                - generic [ref=e1538]: Este producto todavía no está disponible para compra.
              - 'button "Fanta Naranja 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1540]':
                - generic [ref=e1541]: Precio pendiente
        - article [ref=e1542]:
          - generic [ref=e1543]:
            - button "Ver Schweppes Tónica" [ref=e1544] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Tónica" [ref=e1545]'
            - button "Guardar Schweppes Tónica 1,5 L de favoritos" [ref=e1546] [cursor=pointer]:
              - img [ref=e1547]
          - generic [ref=e1549]:
            - heading "Schweppes Tónica" [level=3] [ref=e1550]
            - paragraph [ref=e1551]: 1,5 L
            - generic [ref=e1552]:
              - generic [ref=e1553]:
                - strong [ref=e1555]: Precio próximamente
                - generic [ref=e1556]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Tónica 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1558]':
                - generic [ref=e1559]: Precio pendiente
        - article [ref=e1560]:
          - generic [ref=e1561]:
            - button "Ver Schweppes Citrus" [ref=e1562] [cursor=pointer]:
              - 'img "Producto sin imagen oficial: Schweppes Citrus" [ref=e1563]'
            - button "Guardar Schweppes Citrus 1,5 L de favoritos" [ref=e1564] [cursor=pointer]:
              - img [ref=e1565]
          - generic [ref=e1567]:
            - heading "Schweppes Citrus" [level=3] [ref=e1568]
            - paragraph [ref=e1569]: 1,5 L
            - generic [ref=e1570]:
              - generic [ref=e1571]:
                - strong [ref=e1573]: Precio próximamente
                - generic [ref=e1574]: Este producto todavía no está disponible para compra.
              - 'button "Schweppes Citrus 1,5 L: precio próximamente; este producto todavía no está disponible para compra." [disabled] [ref=e1576]':
                - generic [ref=e1577]: Precio pendiente
  - button "Ver carrito · $ 3.900. Ver pedido." [ref=e1578] [cursor=pointer]:
    - generic [ref=e1579]:
      - generic [ref=e1580]: Ver carrito
      - generic [ref=e1582]: 1 producto
    - strong [ref=e1583]: $ 3.900
  - navigation "Navegación móvil" [ref=e1584]:
    - button "Inicio" [ref=e1585] [cursor=pointer]:
      - generic [ref=e1586]: ⌂
      - generic [ref=e1587]: Inicio
    - button "Catálogo" [ref=e1588] [cursor=pointer]:
      - generic [ref=e1590]: Catálogo
    - button "Mis pedidos" [ref=e1591] [cursor=pointer]:
      - generic [ref=e1593]: Mis pedidos
    - button "Perfil" [ref=e1594] [cursor=pointer]:
      - generic [ref=e1596]: Perfil
```

# Test source

```ts
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
  435 | test('la superficie de contenido es la misma en toda la app del cliente', async ({ page }) => {
  436 |   await openHome(page);
  437 |   const superficie = async (selector) => page.locator(selector).first()
  438 |     .evaluate((node) => getComputedStyle(node).backgroundColor);
  439 | 
  440 |   expect(await superficie('.home-best-card'), 'tarjeta de la home').toBe(GONDOLA);
  441 | 
  442 |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  443 |   await expect(page.locator('[data-product-grid] .product-card').first()).toBeVisible();
  444 |   expect(await superficie('[data-product-grid] .product-card'), 'tarjeta del catálogo').toBe(GONDOLA);
  445 | 
  446 |   await page.locator('[data-product-grid] [data-add-product]:not([disabled])').first().click();
  447 |   await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  448 |   await expect(page.locator('[data-view="cart"] .cart-card')).toBeVisible();
  449 |   expect(await superficie('[data-view="cart"] .cart-card'), 'tarjeta del carrito').toBe(GONDOLA);
  450 |   expect(await superficie('[data-view="cart"] .checkout-form'), 'formulario del checkout').toBe(GONDOLA);
  451 | 
  452 |   await page.locator('.mobile-nav [data-nav-view="profile"]').click();
  453 |   await expect(page.locator('[data-view="profile"] .profile-card').first()).toBeVisible();
  454 |   expect(await superficie('[data-view="profile"] .profile-card'), 'tarjeta del perfil').toBe(GONDOLA);
  455 | });
  456 | 
  457 | test('el panel operativo conserva su superficie clara', async ({ page }) => {
  458 |   await openHome(page);
  459 |   const home = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  460 |   await page.goto('/?demo=1#business');
  461 |   await expect(page.locator('[data-view="business"]')).toBeVisible();
  462 |   const negocio = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  463 |   expect(negocio).not.toBe(home);
  464 | });
  465 | 
  466 | test('ningún texto de las vistas del cliente queda por debajo de 3:1', async ({ page }) => {
  467 |   await openHome(page);
  468 |   await page.locator('[data-home-sections] [data-add-product]:not([disabled])').first().click();
  469 | 
  470 |   for (const vista of ['home', 'catalog', 'cart', 'profile', 'tracking']) {
> 471 |     await page.locator(`.mobile-nav [data-nav-view="${vista}"]`).click();
      |                                                                  ^ Error: locator.click: Test timeout of 45000ms exceeded.
  472 |     await expect(page.locator(`[data-view="${vista}"]`)).toBeVisible();
  473 |     await page.waitForTimeout(250);
  474 |     const malos = await page.evaluate(() => {
  475 |       const parse = (v) => {
  476 |         const p = String(v).match(/[\d.]+/g);
  477 |         if (!p) return null;
  478 |         const [r, g, b, a = '1'] = p.map(Number);
  479 |         return { r, g, b, a };
  480 |       };
  481 |       const lum = ({ r, g, b }) => {
  482 |         const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  483 |         return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  484 |       };
  485 |       const out = [];
  486 |       for (const node of document.querySelectorAll('.app-view:not([hidden]) *')) {
  487 |         if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
  488 |         const rect = node.getBoundingClientRect();
  489 |         if (rect.width < 2 || rect.height < 2) continue;
  490 |         const cs = getComputedStyle(node);
  491 |         if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.15) continue;
  492 |         const fg = parse(cs.color);
  493 |         if (!fg || fg.a < 0.15) continue;
  494 |         let bg = null;
  495 |         for (let c = node; c; c = c.parentElement) {
  496 |           const cand = parse(getComputedStyle(c).backgroundColor);
  497 |           if (cand && cand.a >= 0.9) { bg = cand; break; }
  498 |         }
  499 |         if (!bg) continue;
  500 |         const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
  501 |         if (ratio < 3) out.push(`${ratio.toFixed(2)}:1 <${node.tagName.toLowerCase()}> "${node.textContent.trim().slice(0, 40)}"`);
  502 |       }
  503 |       return out;
  504 |     });
  505 |     expect(malos, `contraste en ${vista}`).toEqual([]);
  506 |   }
  507 | });
  508 | 
  509 | // Los estados VACÍOS son los que ningún recorrido feliz visita, y por eso
  510 | // acumulan deuda: el estado "todavía no guardaste favoritos" tenía su título en
  511 | // 1,09:1 —invisible— desde antes de esta tarea, porque el bloque no lleva
  512 | // `.card` y su tinta, calibrada para papel, caía directo sobre el grafito.
  513 | test('los estados vacíos del cliente se apoyan en la superficie de contenido', async ({ page }) => {
  514 |   await openHome(page);
  515 |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  516 |   await page.locator('[data-category-strip] [data-category-id="favorites"]').click();
  517 |   const vacio = page.locator('[data-product-grid] .empty-state');
  518 |   await expect(vacio).toBeVisible();
  519 |   expect(await vacio.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(GONDOLA);
  520 | 
  521 |   const flojos = await page.evaluate(() => {
  522 |     const parse = (v) => {
  523 |       const p = String(v).match(/[\d.]+/g);
  524 |       if (!p) return null;
  525 |       const [r, g, b, a = '1'] = p.map(Number);
  526 |       return { r, g, b, a };
  527 |     };
  528 |     const lum = ({ r, g, b }) => {
  529 |       const c = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  530 |       return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  531 |     };
  532 |     const out = [];
  533 |     for (const node of document.querySelectorAll('[data-product-grid] .empty-state *')) {
  534 |       if (![...node.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
  535 |       const cs = getComputedStyle(node);
  536 |       const fg = parse(cs.color);
  537 |       if (!fg) continue;
  538 |       let bg = null;
  539 |       for (let c = node; c; c = c.parentElement) {
  540 |         const cand = parse(getComputedStyle(c).backgroundColor);
  541 |         if (cand && cand.a >= 0.9) { bg = cand; break; }
  542 |       }
  543 |       if (!bg) continue;
  544 |       const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
  545 |       if (ratio < 4.5) out.push(`${ratio.toFixed(2)}:1 "${node.textContent.trim().slice(0, 40)}"`);
  546 |     }
  547 |     return out;
  548 |   });
  549 |   expect(flojos, 'texto del estado vacío por debajo de 4,5:1').toEqual([]);
  550 | });
  551 | 
  552 | // Seguimiento CON pedido, que es el estado que el test de arriba no alcanza:
  553 | // sin pedido la vista es una tarjeta vacía y todo su texto vive adentro. Con
  554 | // pedido aparecen el titular, su bajada y las etiquetas de la línea de tiempo
  555 | // DIRECTAMENTE sobre el shell, y esos tres estaban calibrados para el fondo
  556 | // claro que la vista pintaba antes: al soltarlo, el titular quedó en 1,11:1.
  557 | // Un texto invisible no es un detalle de color, así que acá se mide.
  558 | test('el seguimiento con pedido activo se lee sobre el shell oscuro', async ({ page }) => {
  559 |   await openHome(page);
  560 |   await page.locator('.mobile-nav [data-nav-view="catalog"]').click();
  561 |   await seedCartAboveMinimum(page);
  562 |   await page.locator('.mobile-nav [data-nav-view="cart"]').click();
  563 | 
  564 |   const direccion = page.locator('[data-profile-checkout] input[type="radio"]').first();
  565 |   if (await direccion.count()) await direccion.check();
  566 |   await page.locator('[data-checkout-submit]').click();
  567 |   await expect(page.locator('[data-view="tracking"] [data-tracking-title]')).toBeVisible();
  568 | 
  569 |   const flojos = await page.evaluate(() => {
  570 |     const parse = (v) => {
  571 |       const p = String(v).match(/[\d.]+/g);
```